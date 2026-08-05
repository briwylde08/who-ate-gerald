import { useCallback, useEffect, useState } from "react";

import type { VillagerWallet, TxPhase } from "../lib/wallet";
import {
  playerApi,
  fetchPublicView,
  fetchGraph,
  fetchLobbies,
  hasCachedAuth,
  saveGameId,
  type OpenLobby,
  type PublicView,
} from "../lib/player";
import { CHARACTERS, loadProfile } from "../lib/profile";
import { BearIcon, CharEmoji, ToteIcon } from "./CharIcon";
import { loadHistory } from "../lib/history";
import { DAILY_INCOME_XLM } from "../lib/catalog";

const CHAR_BY_ID = new Map(CHARACTERS.map((c) => [c.id, c]));

/**
 */

/**
 * The town square: your role (fetched privately), the day's income, the
 * vote, the werebear's hunt, and every morning's report.
 */

interface Props {
  wallet: VillagerWallet;
  gameId: string;
  onPhase: (p: TxPhase) => void;
  setBusy: (b: string | null) => void;
  setError: (e: string | null) => void;
  refresh: () => Promise<void>;
  /** Jump to the shop floor — the start note points there. */
  onGoShops: () => void;
  /** Jump to Maude — the market-closed notice points there. */
  onGoMaude: () => void;
}

type Role = "villager" | "werebear";


export function Town({ wallet, gameId, onPhase, setBusy, setError, refresh, onGoShops, onGoMaude }: Props) {
  void setBusy;
  void refresh;
  void onPhase;
  const [view, setView] = useState<PublicView | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [roleShown, setRoleShown] = useState(false);
  const [copiedId, setCopiedId] = useState(false);
  /** The notice-board: other games seating players right now. */
  const [lobbies, setLobbies] = useState<OpenLobby[]>([]);
  useEffect(() => {
    const pull = () => void fetchLobbies().then(setLobbies).catch(() => undefined);
    pull();
    const t = setInterval(pull, 15_000);
    return () => clearInterval(t);
  }, []);
  const switchGame = (id: string) => {
    saveGameId(id);
    window.location.reload(); // gameId threads through everything — cleanest reset
  };

  const loadView = useCallback(async () => {
    try {
      setView(await fetchPublicView(gameId));
    } catch {
      setView(null); // game may not exist yet — quiet
    }
  }, [gameId]);
  const load = loadView; // the sightings graph moved to Maude's parlor

  useEffect(() => {
    void load();
    // Game state is a cheap in-memory read — poll it fast so lobbies and
    // votes feel live across browsers. Tab focus refreshes immediately.
    const fast = setInterval(() => void loadView(), 4_000);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(fast);
      window.removeEventListener("focus", onFocus);
    };
  }, [load, loadView]);

  const me = view?.players.find((p) => p.address === wallet.address);

  const round = view?.round;

  // The fate notification: once roles are dealt, fetch yours automatically
  // when the auth signature is already cached (no Freighter popup) — but
  // never DISPLAY it without a click, in case someone is screen-sharing.
  useEffect(() => {
    if (view?.dealt && me && role === null && hasCachedAuth(wallet, gameId)) {
      playerApi
        .myRole(wallet, gameId)
        .then((r) => setRole(r.role))
        .catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view?.dealt, me?.address]);



  // Share our cosmetic character with the village once we're seated.
  useEffect(() => {
    const prof = loadProfile();
    if (me && !me.character && prof) {
      playerApi
        .claimCharacter(wallet, gameId, prof.characterId)
        .then(() => void load())
        .catch(() => undefined); // not seated yet, or user declined the popup
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.address, me?.character]);

  const fetchRole = async () => {
    setError(null);
    try {
      const r = await playerApi.myRole(wallet, gameId);
      if (!r.dealt) {
        setError("Roles haven't been dealt yet — wait for the town crier.");
        return;
      }
      setRole(r.role);
      setRoleShown(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const noticeBoard = (heading: string) =>
    lobbies.filter((l) => l.id !== gameId).length > 0 && (
      <div className="panel">
        <h2>{heading}</h2>
        <div className="lobby-board">
          {lobbies
            .filter((l) => l.id !== gameId)
            .map((l) => (
              <div key={l.id} className="lobby-row">
                <span className="lobby-id">{l.id}</span>
                <span className="dim">
                  {l.seated}/{CHARACTERS.length} players in game
                </span>
                <button onClick={() => switchGame(l.id)}>Join</button>
              </div>
            ))}
        </div>
      </div>
    );

  if (!view) {
    return (
      <div>
        <div className="panel">
          <p className="dim">
            No word from the town crier yet — either the game “{gameId}” hasn't been seated, or
            the record-keeper is asleep. (Set the game id in the banner.)
          </p>
        </div>
        {noticeBoard("Games awaiting players")}
      </div>
    );
  }

  const minPlayers = view.minPlayers ?? 3;
  const readyCount = view.readyCount ?? 0;
  const seats = Math.max(minPlayers, view.players.length);
  const seatsNeeded = Math.max(0, minPlayers - view.players.length);
  const phaseLabel =
    view.round >= 1 && view.maxDays ? `Day ${view.round} of ${view.maxDays}` : `Day ${view.round}`;
  const phaseTitle = view.winner
    ? "The Reckoning"
    : !view.dealt
      ? "The Village Assembles"
      : view.marketClosed
        ? "The Square Fills"
        : "The Market Is Open";

  return (
    <div>
      <div className="panel lobby">
        <div className="phase-head">
          <div className="phase-label">{phaseLabel}</div>
          {view.round >= 1 && view.maxDays && !view.winner && (
            <span className="deadline-note">
              If the werebear survives to day {view.maxDays}, it wins.
            </span>
          )}
        </div>
        <h2 className="phase-title">{phaseTitle}</h2>

        {/* The one instruction that matters the moment the game starts:
            shopping happens on another tab, and nothing proceeds until
            everybody has finished. */}
        {view.round >= 1 && !view.winner && me?.alive && !me.doneToday && (
          <div className="start-note">
            <b>The game has begun.</b> Go to{" "}
            <button className="link inline" onClick={onGoShops}>
              The Shops
            </button>{" "}
            to make your purchases for the day, then press <b>Done buying for today</b>.
          </div>
        )}
        {me && !me.alive && me.ghostVoter && !view.winner && (
          <div className="answer-card">
            👻 <b>The Order honoured your coin.</b> You are dead, but your ghost keeps its vote —
            scroll down to <b>The trial</b> and cast it. The living can hear you in the square,
            too.
          </div>
        )}
        {view.marketClosed && view.round >= 1 && !view.winner && me?.alive && (
          <div className="answer-card">
            <b>The market has closed.</b>{" "}
            {me.askedToday
              ? "Say your piece in the square below, then cast your vote."
              : "Maude's office is open — you have one question today. Then argue it out in the square and vote."}
          </div>
        )}
        {view.winner && view.bear && (
          <div className="answer-card" style={{ fontSize: "1.1rem" }}>
            <BearIcon /> <b>{view.bear} was the werebear.</b>{" "}
            {view.calledOff
              ? "The Order called the hunt off before the village found them."
              : view.winner === "werebear"
                ? "They shopped beside you, voted beside you, and outlasted you all."
                : "The village sleeps safe — and owes some apologies to the wrongly banished."}
          </div>
        )}

        {/* The lobby's whole job: say what we're waiting for and give one
            obvious thing to press. */}
        {!view.dealt && (
          <div className="lobby-state">
            <h3>Waiting for villagers</h3>
            <div className="seat-dots" role="img" aria-label={`${readyCount} of ${seats} ready`}>
              {Array.from({ length: seats }).map((_, i) => (
                <span key={i} className={`dot${i < readyCount ? " on" : ""}`} aria-hidden="true" />
              ))}
              <span className="seat-count">
                {readyCount} of {seats} ready
              </span>
            </div>
            <p className="dim">
              The game begins automatically when {minPlayers} players are seated and
              everyone is ready.
            </p>
            {me && (
              <div className="ready-row">
                <button
                  className={`ready-btn${me.ready ? " is-ready" : ""}`}
                  aria-pressed={me.ready === true}
                  onClick={() => {
                    playerApi
                      .ready(wallet, gameId, !me.ready)
                      .then(() => void load())
                      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
                  }}
                >
                  {me.ready ? "Ready ✓" : "I'm Ready"}
                </button>
                <span className="dim">You can change your mind until the game begins.</span>
              </div>
            )}
          </div>
        )}

        {!me && !view.dealt && (
          <div className="join-card">
            {/* Just the button and, beneath it, what the popup will be and
                why it's nothing to fear. No headline, no styling flourishes
                (Bri's call — the answer-card border and italics are Maude's). */}
            <div className="row">
              <button
                className="primary"
                onClick={() => {
                  const prof = loadProfile();
                  if (!prof) {
                    setError(
                      "Pick a name and villager first — use Log out in the top bar to start over.",
                    );
                    return;
                  }
                  playerApi
                    .join(wallet, gameId, prof.name, prof.characterId)
                    .then(() => void load())
                    .catch((e) => setError(e instanceof Error ? e.message : String(e)));
                }}
              >
                Join as {loadProfile()?.name ?? "your villager"}
              </button>
            </div>
            <span className="dim">
              When you click, Freighter will pop up once and ask you to <b>sign a message</b> —
              it's not a payment and costs nothing. Your signature proves this wallet is yours,
              so nobody else can ever act as you in the game.
            </span>
          </div>
        )}
        {!me && view.dealt && (
          <p className="dim">
            This game is already underway — you can spectate, or join the next one.
          </p>
        )}

        {me && view.dealt && !roleShown && (
          <div className="answer-card">
            <b>📜 Your fate has been dealt.</b>{" "}
            {role
              ? "It waits, sealed. Open it when nobody is looking over your shoulder."
              : "Receiving it will ask Freighter for one signature — that's you proving your seat."}
            <div className="row">
              <button className="primary" onClick={() => (role ? setRoleShown(true) : void fetchRole())}>
                {role ? "Are you a werebear or a villager?" : "Receive your fate (private)"}
              </button>
            </div>
          </div>
        )}
        {roleShown && role && (
          <div className="answer-card">
            {role === "werebear" ? (
              <>
                <BearIcon /> <b>You are the werebear.</b> Gerald was delicious. Shop and vote like any
                villager and each day, pick someone to eat.
              </>
            ) : (
              <>
                🏡 <b>You are a villager.</b> Find the werebear before it finds you.
              </>
            )}
            <div className="row">
              <button onClick={() => setRoleShown(false)}>hide</button>
            </div>
          </div>
        )}

        {/* The headcount belongs with the faces it is counting. */}
        {view.dealt && (
          <p className="dim headcount">
            {view.players.filter((p) => p.alive).length}/{view.players.length} still alive
            {me ? (me.alive ? "" : " · you are among the departed") : ""}
          </p>
        )}

        {/* The village itself: portraits, not a roster line. */}
        <div className="villagers">
          {view.players.map((p) => {
            const c = p.character ? CHAR_BY_ID.get(p.character) : null;
            const isYou = p.address === wallet.address;
            // The reckoning, visible on the faces: the bear outlined in
            // blood, the winners in gold. Village win = the survivors;
            // bear win = the bear alone.
            const isBear = view.winner !== null && view.bear === p.name;
            const isWinner =
              view.winner === "village"
                ? p.alive
                : view.winner === "werebear"
                  ? isBear
                  : false;
            const dayParts: React.ReactNode[] = [
              p.doneToday ? (
                <span key="done">
                  <ToteIcon /> Done
                </span>
              ) : null,
              p.askedToday ? "🔮 Asked" : null,
              p.drunkToday ? "🍺 Asleep" : null,
            ].filter(Boolean);
            // The mornings remember HOW everyone died — say so, with the day.
            const fate = (() => {
              const b = view.mornings.find((m) => m.banished === p.name);
              if (b) return `⚖ Banished on day ${b.round}`;
              const e = view.mornings.find((m) => m.eaten === p.name);
              if (e) return `🍽 Eaten on day ${e.round}`;
              return "Dead";
            })();
            const status: React.ReactNode = !p.alive ? (
              p.ghostVoter ? (
                `👻 ${fate} — still votes`
              ) : (
                fate
              )
            ) : !view.dealt ? (
              p.ready ? (
                "Ready ✓"
              ) : (
                "Waiting…"
              )
            ) : dayParts.length === 0 ? (
              "In the square"
            ) : (
              dayParts.map((part, i) => (
                <span key={i}>
                  {i > 0 && " · "}
                  {part}
                </span>
              ))
            );
            return (
              <div
                key={p.seat}
                className={`villager-card${p.alive ? "" : " dead"}${isYou ? " you" : ""}${
                  isBear ? " bear-seat" : ""
                }${isWinner ? " winner-seat" : ""}`}
              >
                <div className="v-portrait">
                  {c?.image ? (
                    <img src={c.image} alt="" loading="lazy" />
                  ) : (
                    <span className="v-fallback" aria-hidden="true">
                      <CharEmoji c={c} />
                    </span>
                  )}
                  {!p.alive && (
                    <span className="v-tomb" aria-hidden="true">
                      🪦
                    </span>
                  )}
                  {isYou && <span className="you-badge">You</span>}
                  {isBear && (
                    <span className="verdict-badge bear-badge">
                      <BearIcon /> the werebear
                    </span>
                  )}
                  {isWinner && !isBear && <span className="verdict-badge winner-badge">👑 winner</span>}
                </div>
                <div className="v-name">{p.name}</div>
                <div className="v-role">{c?.title ?? "new in town"}</div>
                {c?.blurb && <p className="v-blurb">“{c.blurb}”</p>}
                <div className={`v-status${p.alive && p.ready && !view.dealt ? " ok" : ""}`}>
                  {status}
                </div>
              </div>
            );
          })}

          {/* Empty seats, so a thin lobby still looks deliberate. */}
          {!view.dealt &&
            Array.from({ length: seatsNeeded }).map((_, i) => (
              <div key={`seat-${i}`} className="villager-card empty">
                <div className="v-portrait empty-frame" aria-hidden="true" />
                <div className="v-name">Empty seat</div>
              </div>
            ))}
        </div>

        {!view.dealt && (
          <div className="invite-row">
            <span className="dim">
              Others join by entering the game id <b>{gameId}</b> in the game lobby.
            </span>
            <button
              className="link"
              onClick={() => {
                void navigator.clipboard.writeText(gameId);
                setCopiedId(true);
                window.setTimeout(() => setCopiedId(false), 1500);
              }}
            >
              {copiedId ? "Copied ✓" : "Copy game id"}
            </button>
          </div>
        )}

      </div>

      <div className="info-grid">
        <div className="panel">
          <h2>What the village sees</h2>
          <div className="seen-grid">
            <div className="seen-card">
              <h3>👁 Public</h3>
              <ul>
                <li>Store visits and timing</li>
                <li>Income deposits</li>
                <li>Item names and prices</li>
              </ul>
            </div>
            <div className="seen-card">
              <h3>🔒 Private</h3>
              <ul>
                <li>The exact amount you paid</li>
                <li>What you purchased</li>
                <li>Maude's answer to you</li>
                <li>Your vote</li>
              </ul>
            </div>
          </div>
          {/* The deep version of this lives in Rules ("What's actually
              happening under the hood") — saying it twice taught nothing
              extra and doubled the drift surface. The grid is the cheat
              sheet; Rules is the story. */}
          <p className="dim">
            The full story of how this works is under <b>Rules</b>.
          </p>
        </div>

        <div className="panel notices">
          <h2>Town Notices</h2>
          {view.round >= 1 && !view.winner && !view.marketClosed && (
            <p className="notice notice-plain">
              The market is open. Maude waits for:{" "}
              {(view.stillShopping ?? []).join(", ") || "—"}.
            </p>
          )}
          {view.round >= 1 && !view.winner && view.marketClosed && (
            <div className="notice notice-plain maude-pointer">
              <p>
                The market has closed —{" "}
                <button className="link inline" onClick={onGoMaude}>
                  Maude's office
                </button>{" "}
                is open. Maude McLedger is the Auditor: she holds the one key that can read
                every sealed amount on the ledger. Ask her one question about today's
                purchases, then take what you learn to <b>Chat &amp; Vote</b>.
              </p>
            </div>
          )}
          {view.round < 1 && <p className="notice">This opens when the game begins.</p>}
          {/* The headline facts of every day, newest first — who was eaten,
              who was banished. The Town Crier below keeps the full story. */}
          {[...view.mornings].reverse().map((m) => (
            <p key={m.round} className="notice">
              <b>Day {m.round}:</b>{" "}
              {m.banished
                ? `${m.banished} was banished${m.banishedRole === "werebear" ? " — the werebear! " : ". "}`
                : "Nobody was banished. "}
              {m.eaten ? `${m.eaten} was eaten in the night.` : "Nobody was eaten."}
            </p>
          ))}
          {me?.alive && view.round >= 2 && view.phase === "day" && !view.winner && (
            <p className="notice">
              The day's allowance of {DAILY_INCOME_XLM} XLM waits at the Town Treasury, in{" "}
              <b>The Shops</b>.
            </p>
          )}
        </div>
      </div>


    </div>
  );
}
