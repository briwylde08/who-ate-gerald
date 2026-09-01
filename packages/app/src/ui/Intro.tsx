import { useEffect, useRef, useState } from "react";

import { CHARACTERS, saveProfile, type Profile } from "../lib/profile";
import { CharEmoji } from "./CharIcon";
import { fetchLobbies, fetchPublicView, loadGameId, saveGameId, type OpenLobby } from "../lib/player";
import { GeraldStory } from "./Story";

/**
 * The intro, three pages: the story of Gerald, then choose a game (join one
 * off the notice-board, start a new one, or type a private id), then name +
 * villager. Characters are cosmetic — flavor for the table, not roles.
 */

/** A fresh game gets a village name, not a UUID. */
const MOODS = ["grim", "mossy", "foggy", "bleak", "quiet", "dour", "salted", "hollow"];
const PLACES = ["fen", "glen", "moor", "ford", "dell", "cross", "gate", "hollow"];
function newGameId(): string {
  const pick = (a: string[]) => a[Math.floor(Math.random() * a.length)]!;
  return `${pick(MOODS)}-${pick(PLACES)}-${Math.floor(10 + Math.random() * 90)}`;
}

/** Game ids travel in URLs: letters, numbers, dashes, underscores, ≤64. */
function tameGameName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 64);
}
export function Intro({
  onDone,
  address,
  onConnect,
  startAt,
}: {
  onDone: (p: Profile) => void;
  /** The connected wallet, when there is one — so your own seat isn't
      mistaken for someone else's claim. */
  address?: string;
  /** Wake Freighter — offered when a seat might be yours but we can't tell. */
  onConnect?: () => void;
  /** "identity" jumps straight to the villager picker (Change villager). */
  startAt?: "story" | "game" | "identity";
}) {
  // Survive a refresh: a mid-signup player dumped back to the story lost
  // their place for no reason. Session-scoped, so a NEW tab still gets the
  // story; an explicit startAt (change game / change villager) still wins.
  const [page, setPageRaw] = useState<"story" | "game" | "identity">(() => {
    if (startAt && startAt !== "story") return startAt;
    const stored = sessionStorage.getItem("gerald:intro-page");
    return stored === "game" || stored === "identity" ? stored : (startAt ?? "story");
  });
  const setPage = (p: "story" | "game" | "identity") => {
    sessionStorage.setItem("gerald:intro-page", p);
    setPageRaw(p);
  };
  const [lobbies, setLobbies] = useState<OpenLobby[]>([]);
  const [manualId, setManualId] = useState("");
  const [newName, setNewName] = useState("");
  const [chosenGame, setChosenGame] = useState<string | null>(null);
  useEffect(() => {
    if (page !== "game") return;
    const pull = () => void fetchLobbies().then(setLobbies).catch(() => undefined);
    pull();
    const t = setInterval(pull, 10_000);
    return () => clearInterval(t);
  }, [page]);
  /** Whatever game this browser last pointed at — may have no seats yet. */
  const current = loadGameId();
  /** What that game actually IS right now: an ended game must never be
   *  offered as a way back in ("game1 is still in the lobby" — Bri, after
   *  we ended game1 and this row kept advertising it). */
  const [currentState, setCurrentState] = useState<{
    phase: string;
    seated: boolean;
  } | null>(null);
  useEffect(() => {
    if (page !== "game" || !current) return;
    let stale = false;
    const pull = () =>
      void fetchPublicView(current)
        .then((v) => {
          if (stale) return;
          setCurrentState({
            phase: v.phase,
            seated: !!address && v.players.some((pl) => pl.address === address),
          });
        })
        .catch(() => !stale && setCurrentState({ phase: "lobby", seated: false }));
    pull();
    const t = setInterval(pull, 10_000);
    return () => {
      stale = true;
      clearInterval(t);
    };
  }, [page, current, address]);
  const chooseGame = (id: string) => {
    saveGameId(id);
    setChosenGame(id);
    setPage("identity");
  };
  const [name, setName] = useState("");
  const [characterId, setCharacterId] = useState<string | null>(null);
  const [taken, setTaken] = useState<Set<string>>(new Set());
  const [seated, setSeated] = useState<{ name: string; character?: string | null } | null>(null);
  const [seatCount, setSeatCount] = useState(0);
  const [gameDealt, setGameDealt] = useState(false);

  // One face per game: grey out characters claimed by OTHER players. Your own
  // seat stays open — locking it left returning players with nothing to pick
  // and a dead button.
  useEffect(() => {
    // LIVE, not once: two players on the picker at the same time each saw a
    // stale taken-set, and both walked away believing they had the same face
    // (Ardness and Slim Shady both "had" the gravedigger). The server still
    // refuses the second claim — this keeps the picker from lying first.
    const pull = () =>
      fetchPublicView(loadGameId())
      .then((v) => {
        const mine = address ? v.players.find((p) => p.address === address) : undefined;
        setTaken(
          new Set(
            v.players
              .filter((p) => p.address !== address)
              .map((p) => p.character)
              .filter((c): c is string => !!c),
          ),
        );
        setSeated(mine ? { name: mine.name, character: mine.character } : null);
        setSeatCount(v.players.length);
        setGameDealt(v.dealt === true);
        // Already seated in this game? Offer that identity back, pre-filled.
        if (mine) {
          setName((n) => n || mine.name);
          setCharacterId((c) => c ?? mine.character ?? null);
        }
      })
      .catch(() => setTaken(new Set())); // no game yet — all faces free
    pull();
    const t = setInterval(pull, 5_000);
    return () => clearInterval(t);
  }, [page, address]);

  // Recognized seat + connected wallet = nothing left to choose: go straight
  // in (Bri: skip the character screen). EXCEPT when the player came via
  // "Change villager" (startAt === "identity"), where standing on the picker
  // while holding a seat is the whole point.
  useEffect(() => {
    if (page !== "identity" || startAt === "identity") return;
    if (!address || !seated?.character) return;
    const p = { name: seated.name, characterId: seated.character };
    saveProfile(p);
    onDone(p);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, address, seated?.character]);

  const nameRef = useRef<HTMLInputElement>(null);
  const named = name.trim().length > 0;
  const ready = named && characterId !== null;
  // A picked face with no name used to dead-end here: the name field is above
  // eight big portraits, so it scrolls out of sight and the button gave no
  // clue which half was missing. Now it says so, and takes you there.
  const needsName = !named && characterId !== null;
  const chosenTitle = CHARACTERS.find((c) => c.id === characterId)?.title ?? null;
  const cta = ready
    ? `Claim the ${chosenTitle}`
    : needsName
      ? "Type your name to continue"
      : characterId === null && named
        ? "Pick a villager"
        : "Name yourself and pick a villager";

  if (page === "story") {
    // The front page is the STORY and one button, nothing else (Bri's call).
    return (
      <div className="panel story">
        <GeraldStory />
        <div className="row">
          <button className="primary" onClick={() => setPage("game")} autoFocus>
            Play Who Ate Gerald?
          </button>
        </div>
      </div>
    );
  }

  if (page === "game") {
    return (
      <div>
        <div className="row">
          <button className="back" onClick={() => setPage("story")}>
            ← Back
          </button>
        </div>

        {/* The game this browser is already pointed at. Without this row a
            player who made a game but never took a seat had NO way forward:
            the board only lists games somebody has already joined, so their
            own empty lobby was invisible and the screen was a dead end. */}
        {current &&
          !lobbies.some((l) => l.id === current) &&
          currentState !== null &&
          currentState.phase !== "ended" &&
          (currentState.phase === "lobby" || currentState.seated) && (
            <>
              <h2>Carry on where you were</h2>
              <div className="panel">
                <div className="lobby-row">
                  <span className="lobby-id">{current}</span>
                  <span className="dim">
                    {currentState.phase === "lobby"
                      ? "the game you were last in"
                      : "in progress — your seat is waiting"}
                  </span>
                  <button className="primary" onClick={() => chooseGame(current)}>
                    Continue
                  </button>
                </div>
              </div>
            </>
          )}

        <h2>Join an existing game</h2>
        {lobbies.length === 0 ? (
          <div className="panel">
            <p className="dim">No games in progress yet.</p>
          </div>
        ) : (
          <div className="panel">
            <div className="lobby-board">
              {lobbies.map((l) => (
                <div key={l.id} className="lobby-row">
                  <span className="lobby-id">{l.id}</span>
                  <span className="dim">
                    {l.seated}/{CHARACTERS.length} players in game
                  </span>
                  <button className="primary" onClick={() => chooseGame(l.id)}>
                    Join
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <h2>Start a new game</h2>
        <div className="panel">
          <p className="dim">
            Name your game, or leave it blank for a random one. It appears on the board the
            moment you take a seat, so others can find it without being told the name.
          </p>
          <div className="row">
            <input
              type="text"
              maxLength={64}
              placeholder="name the game (optional)"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <button
              className="primary"
              onClick={() => chooseGame(tameGameName(newName) || newGameId())}
            >
              Start a new game
            </button>
          </div>
          {tameGameName(newName) !== "" && tameGameName(newName) !== newName.trim() && (
            <p className="dim">Will be called: <b className="mono">{tameGameName(newName)}</b></p>
          )}
          <p className="dim">
            Start the name with “private” to keep it off the board.
          </p>
        </div>

        <details>
          <summary>Enter a private game id</summary>
          <div className="row" style={{ marginTop: "8px" }}>
            <input
              type="text"
              placeholder="the game's id"
              value={manualId}
              onChange={(e) => setManualId(e.target.value)}
            />
            <button
              disabled={manualId.trim() === ""}
              onClick={() => chooseGame(manualId.trim())}
            >
              Use this game
            </button>
          </div>
        </details>
      </div>
    );
  }

  return (
    <div>
      <div className="row">
        <button className="back" onClick={() => setPage("game")}>
          ← Back
        </button>
      </div>
      {chosenGame && (
        <p className="dim">
          Game: <b className="mono">{chosenGame}</b>
        </p>
      )}

      {/* Without a wallet, the picker can't recognize a returning player: it
          greys their OWN face as "claimed" and asks them to be somebody new
          ("it tries to have me pick a new character..." — Bri, locked out of
          her own midwife). If seats exist and we can't see an address, offer
          the connect BEFORE the picker misleads anyone. */}
      {/* Connected but unrecognized: say so — a vanished card read as
          "I connected and nothing happened" (Bri). */}
      {address && seatCount > 0 && !seated && (
        <div className="panel reclaim-card">
          <p>
            This wallet doesn't hold a seat in <b>{chosenGame ?? loadGameId()}</b> — pick a
            villager below to join.
          </p>
        </div>
      )}

      {!address && seatCount > 0 && onConnect && (
        <div className="panel reclaim-card">
          <p>
            If you're a current player in <b>{chosenGame ?? loadGameId()}</b>, connect your
            Freighter wallet to continue. Your character is recognized by your wallet address.
          </p>
          <div className="row">
            <button className="primary" onClick={onConnect}>
              Connect Freighter
            </button>
            <span className="dim">New here? Just pick a villager below.</span>
          </div>
        </div>
      )}

      <div className="panel">
        <p>
          The village needs to know who you are — or at least, who you claim to be.
        </p>
        <div className="row">
          <label className="dim">your name</label>
          <input
            ref={nameRef}
            type="text"
            maxLength={24}
            placeholder="what do they call you?"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </div>
      </div>

      <h2>Pick your villager</h2>
      <p className="dim">
        Your face is just a face. Whether you are a werebear or a villager is dealt in secret
        once all eight seats are full and everyone has readied up.
      </p>
      {seated && (
        <div className="answer-card">
          <b>This wallet already holds a seat in this game as {seated.name}.</b>{" "}
          {gameDealt
            ? "The game is underway — your face is set, and it cannot be changed."
            : "Continue as them, or pick a different face while the lobby is still open."}
          <div className="row">
            <button
              className="primary"
              onClick={() => {
                const p = {
                  name: seated.name,
                  characterId: seated.character ?? characterId ?? "",
                };
                if (!p.characterId) return;
                saveProfile(p);
                onDone(p);
              }}
            >
              Continue as {seated.name}
            </button>
          </div>
        </div>
      )}
      <div className="characters picker">
        {CHARACTERS.map((c) => {
          const isTaken = taken.has(c.id);
          return (
            <div key={c.id} className="char-wrap">
            <button
              className={`character ${characterId === c.id ? "selected" : ""}`}
              disabled={isTaken || (gameDealt && seated !== null && c.id !== seated.character)}
              onClick={() => setCharacterId(c.id)}
            >
              <span className="portrait-wrap">
                <img className="portrait" src={c.image} alt={c.title} loading="lazy" />
                {isTaken && (
                  <span className="claimed-banner" aria-hidden="true">
                    CLAIMED
                  </span>
                )}
              </span>
              <span>
                <CharEmoji c={c} /> {c.title}
                {isTaken ? " — claimed" : ""}
              </span>
              <span className="dim blurb">{isTaken ? "Somebody already wears this face." : c.blurb}</span>
            </button>
            {/* The Claim chip rides the chosen card itself (Bri, 2026-08-18). */}
            {characterId === c.id && !isTaken && (ready || needsName) && (
              <button
                className="primary claim-chip"
                onClick={() => {
                  if (needsName) {
                    nameRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
                    nameRef.current?.focus();
                    return;
                  }
                  const p = { name: name.trim(), characterId: c.id };
                  saveProfile(p);
                  onDone(p);
                }}
              >
                {needsName ? "Claim — pick a name first" : `Claim the ${c.title} →`}
              </button>
            )}
            </div>
          );
        })}
      </div>

      <div className="row">
        <button
          className="primary"
          disabled={!ready && !needsName}
          onClick={() => {
            if (needsName) {
              nameRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
              nameRef.current?.focus();
              return;
            }
            const p = { name: name.trim(), characterId: characterId! };
            saveProfile(p);
            onDone(p);
          }}
        >
          {cta}
        </button>
        {needsName && (
          <span className="dim">
            {CHARACTERS.find((c) => c.id === characterId)?.title} is yours — the village just
            needs a name for you.
          </span>
        )}
      </div>

      {/* The spectator entrance (Bri, 2026-09-01): a full or dealt game has no
          free face to claim, which locked observers out of the town entirely —
          the picker was the only door. This saves a LOCAL profile and opens the
          view; it takes no seat and touches no server. Watching is free; a seat
          only ever comes from the explicit "Join as…" button in the square. */}
      <div className="row">
        <button
          className="link"
          onClick={() => {
            const p = { name: "Observer", characterId: CHARACTERS[0]!.id };
            saveProfile(p);
            onDone(p);
          }}
        >
          Just watching? Skip the picker →
        </button>
        <span className="dim">
          Spectators don't need a face. You'll see the town, the mornings, and the films —
          you won't hold a seat unless you click Join.
        </span>
      </div>
    </div>
  );
}
