import { useCallback, useEffect, useState } from "react";

import type { VillagerWallet, TxPhase } from "../lib/wallet";
import {
  playerApi,
  fetchPublicView,
  fetchGraph,
  hasCachedAuth,
  type PublicView,
  type GraphView,
} from "../lib/player";
import { CHARACTERS, loadProfile } from "../lib/profile";
import { CharEmoji, ToteIcon } from "./CharIcon";
import { loadHistory } from "../lib/history";
import { DAILY_INCOME_XLM, SHOPS } from "../lib/catalog";

const CHAR_BY_ID = new Map(CHARACTERS.map((c) => [c.id, c]));

/**
 * The night's film: when a villager is eaten, their character's "gets got"
 * reel plays once for everyone at dawn. Files live in public/videos/ as
 * <characterId>_gets_got.mp4 — a missing file (the midwife, for now) just
 * means no film, handled by onError.
 */
const nightFilmSrc = (characterId: string) => `/videos/${characterId}_gets_got.mp4`;

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
}

type Role = "villager" | "werebear";


export function Town({ wallet, gameId, onPhase, setBusy, setError, refresh }: Props) {
  void setBusy;
  void refresh;
  void onPhase;
  const [view, setView] = useState<PublicView | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [roleShown, setRoleShown] = useState(false);
  const [voteTarget, setVoteTarget] = useState("");
  const [voted, setVoted] = useState<string | null>(null);
  const [pickTarget, setPickTarget] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [chatText, setChatText] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [discloseTx, setDiscloseTx] = useState("");
  const [copiedId, setCopiedId] = useState(false);
  /** The night's film: {src, caption} while showing, null otherwise. */
  const [film, setFilm] = useState<{ src: string; caption: string } | null>(null);

  const sendChat = async () => {
    setChatBusy(true);
    setError(null);
    try {
      await playerApi.chat(wallet, gameId, chatText.trim());
      setChatText("");
      await loadView();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setChatBusy(false);
    }
  };

  const [graph, setGraph] = useState<GraphView | null>(null);

  const loadView = useCallback(async () => {
    try {
      setView(await fetchPublicView(gameId));
    } catch {
      setView(null); // game may not exist yet — quiet
    }
  }, [gameId]);

  const loadGraph = useCallback(async () => {
    try {
      setGraph(await fetchGraph(gameId));
    } catch {
      // graph is decoration; keep the last one
    }
  }, [gameId]);

  const load = useCallback(async () => {
    await Promise.all([loadView(), loadGraph()]);
  }, [loadView, loadGraph]);

  useEffect(() => {
    void load();
    // Game state is a cheap in-memory read — poll it fast so lobbies and
    // votes feel live across browsers. The graph re-reads the chain, so it
    // polls slower. Tab focus refreshes everything immediately.
    const fast = setInterval(() => void loadView(), 4_000);
    const slow = setInterval(() => void loadGraph(), 30_000);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(fast);
      clearInterval(slow);
      window.removeEventListener("focus", onFocus);
    };
  }, [load, loadView, loadGraph]);

  const me = view?.players.find((p) => p.address === wallet.address);

  // A new day voids yesterday's ballot — clear the trial (and the hunt) so
  // "Current vote" never carries over from a previous round.
  const round = view?.round;
  useEffect(() => {
    setVoted(null);
    setVoteTarget("");
    setPicked(null);
    setPickTarget("");
  }, [round]);

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

  // Private dawn facts (currently the tooth-sharpener offering). Fetched when the
  // auth signature is cached — only ever this player's own notes.
  const [privateNotes, setPrivateNotes] = useState<{ round: number; text: string }[]>([]);
  useEffect(() => {
    if (me && round && round >= 2 && hasCachedAuth(wallet, gameId)) {
      playerApi
        .notes(wallet, gameId)
        .then((r) => setPrivateNotes(r.notes))
        .catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.address, round]);

  // When a new morning carries a victim, roll their film — once per morning
  // per browser, marked seen on show so a refresh doesn't replay the horror.
  useEffect(() => {
    if (!view) return;
    const m = [...view.mornings].reverse().find((x) => x.eaten);
    if (!m?.eaten) return;
    const victim = view.players.find((p) => p.name === m.eaten);
    if (!victim?.character) return;
    const seenKey = `gerald:film:${gameId}:${m.round}`;
    if (localStorage.getItem(seenKey)) return;
    localStorage.setItem(seenKey, "1");
    setFilm({
      src: nightFilmSrc(victim.character),
      caption: `${m.eaten} was taken in the night.`,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view?.mornings.length]);

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
  const living = (view?.players ?? []).filter((p) => p.alive && p.address !== wallet.address);

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

  const castVote = async () => {
    setError(null);
    try {
      const r = await playerApi.vote(wallet, gameId, voteTarget);
      setVoted(r.voted);
      setVoteTarget(""); // the ballot is cast; empty the hand
      await load(); // if this was the last vote, dawn just came
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const castPick = async () => {
    setError(null);
    try {
      const r = await playerApi.nightPick(wallet, gameId, pickTarget);
      setPicked(r.picked);
      setPickTarget("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (!view) {
    return (
      <div className="panel">
        <p className="dim">
          No word from the town crier yet — either the game “{gameId}” hasn't been seated, or
          the record-keeper is asleep. (Set the game id in the banner.)
        </p>
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
        <div className="phase-label">{phaseLabel}</div>
        <h2 className="phase-title">{phaseTitle}</h2>

        {view.round >= 1 && view.maxDays && !view.winner && (
          <p className="dim">
            The clock runs for the village: if the werebear survives the dusk of day{" "}
            {view.maxDays}, it wins.
          </p>
        )}
        {view.winner && view.bear && (
          <div className="answer-card" style={{ fontSize: "1.1rem" }}>
            🐻 <b>{view.bear} was the werebear.</b>{" "}
            {view.winner === "werebear"
              ? "They shopped beside you, voted beside you, and outlasted you all."
              : "The village sleeps safe — and owes some apologies to the wrongly banished."}
          </div>
        )}
        {view.dealt && (
          <p className="dim">
            {view.players.filter((p) => p.alive).length} of {view.players.length} still breathing
            {me ? (me.alive ? "" : " · you are among the departed") : ""}
          </p>
        )}

        {/* The lobby's whole job: say what we're waiting for and give one
            obvious thing to press. */}
        {!view.dealt && (
          <div className="lobby-state">
            <h3>Waiting for the village</h3>
            <div className="seat-dots" role="img" aria-label={`${readyCount} of ${seats} ready`}>
              {Array.from({ length: seats }).map((_, i) => (
                <span key={i} className={`dot${i < readyCount ? " on" : ""}`} aria-hidden="true" />
              ))}
              <span className="seat-count">
                {readyCount} of {seats} ready
              </span>
            </div>
            <p className="dim">
              The game begins automatically when at least {minPlayers} villagers are seated and
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
          <div className="answer-card">
            <b>Take a seat in “{gameId}”.</b> Freighter will ask you to sign one message. It's
            free, and it proves this wallet is yours.
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
                Join the village
              </button>
            </div>
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
                🐻 <b>You are the werebear.</b> Gerald was delicious. Shop like an innocent, vote
                like a patriot — and each day, pick someone to eat below. Silver is beyond you;
                do not touch it.
              </>
            ) : (
              <>
                🏡 <b>You are a villager.</b> Find the werebear before it finds you. Shop
                wisely: the right gear survives the wrong night.
              </>
            )}
            <div className="row">
              <button onClick={() => setRoleShown(false)}>hide</button>
            </div>
          </div>
        )}

        {/* The village itself: portraits, not a roster line. */}
        <div className="villagers">
          {view.players.map((p) => {
            const c = p.character ? CHAR_BY_ID.get(p.character) : null;
            const isYou = p.address === wallet.address;
            const dayParts: React.ReactNode[] = [
              p.doneToday ? (
                <span key="done">
                  <ToteIcon /> Done
                </span>
              ) : null,
              p.askedToday ? "🔮 Asked" : null,
              p.recovering ? "🤕 Abed" : null,
            ].filter(Boolean);
            const status: React.ReactNode = !p.alive ? (
              p.ghostVoter ? (
                "👻 Dead — still votes"
              ) : (
                "Eaten or banished"
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
                className={`villager-card${p.alive ? "" : " dead"}${isYou ? " you" : ""}`}
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
                <p className="v-blurb">
                  {seatsNeeded === 1
                    ? "Waiting for another villager."
                    : i === 0
                      ? `${seatsNeeded} more suspicious people required.`
                      : "This seat is probably not cursed."}
                </p>
              </div>
            ))}
        </div>

        {!view.dealt && (
          <div className="invite-row">
            <span className="dim">
              Others join by entering the game id <b>{gameId}</b> in the top bar.
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
          <details className="privacy-more">
            <summary>How privacy works</summary>
            <p className="dim">
              Every purchase is a confidential transfer. The ledger shows <b>which store you
              paid and when</b>, never the amount — and because each price in the game is
              unique, hiding the amount is what hides the item. Your income arrives as a{" "}
              <b>public deposit</b>, amount included, which is how the village verifies nobody
              smuggled in extra budget.
            </p>
            <p className="dim">
              One person can read the amounts: <b>Maude McLedger</b>, who holds the token's
              auditor key. That is how her answers are true — and they go only to the villager
              who asked. Votes stay sealed too: the morning report announces the verdict, and
              the tied names when a trial deadlocks, but never who voted for whom.
            </p>
            <p className="dim">
              Two things can pull a purchase into the open, and both need you: standing accused
              after a tie (you nominate one purchase and the server unseals it) and items whose
              effect is to reveal — a long candle burning all night in the Chapel.
            </p>
          </details>
        </div>

        <div className="panel notices">
          <h2>Town Notices</h2>
          {view.round >= 1 && !view.winner && (
            <p className="notice">
              {view.marketClosed
                ? "The market has closed. Maude's office is open for questions."
                : `The market is open. Maude waits for: ${(view.stillShopping ?? []).join(", ") || "—"}.`}
            </p>
          )}
          {view.round < 1 ? (
            <p className="notice">The shops open when the game begins.</p>
          ) : graph && graph.edges.filter((e) => e.round === view.round).length > 0 ? (
            <>
              <p className="notice">Seen at the stores today:</p>
              <div className="sightings">
                {graph.edges
                  .filter((e) => e.round === view.round)
                  .map((e, i) => (
                    <span key={i} className="sighting">
                      {e.from} <span className="dim">→</span> {e.to}
                    </span>
                  ))}
              </div>
            </>
          ) : (
            <p className="notice">Nobody has been seen at a store yet today.</p>
          )}
          {me?.alive && view.round >= 2 && view.phase === "day" && !view.winner && (
            <p className="notice">
              The day's allowance of {DAILY_INCOME_XLM} XLM waits at the Order's desk, in{" "}
              <b>The Shops</b>.
            </p>
          )}
          <p className="notice">
            {SHOPS.length} stores. {SHOPS.reduce((n, s) => n + s.items.length, 0)} wares. Two
            visits per day.
          </p>
          <p className="notice">
            The shops never run out. Apparently capitalism survived Gerald.
          </p>
        </div>
      </div>

      {view.marketClosed && view.phase === "day" && !view.winner && (
        <div className="panel">
          <h2>The square</h2>
          <p className="dim">
            Accuse, defend, bluff — the square hears everything and forgets it at dawn.
            {me && !me.alive ? " You are a ghost now: whisper wisely, certified innocent." : ""}
          </p>
          <div className="chat">
            {(view.chat ?? []).length === 0 ? (
              <p className="dim">Nobody has said anything yet. Suspicious, honestly.</p>
            ) : (
              (view.chat ?? []).slice(-60).map((m, i) => (
                <p key={i} className="chat-line" style={m.ghost ? { opacity: 0.65, fontStyle: "italic" } : undefined}>
                  <b>
                    {m.ghost ? "👻 " : ""}
                    {m.name}:
                  </b>{" "}
                  {m.text}
                </p>
              ))
            )}
          </div>

          {privateNotes.some((n) => n.round === view.round) && (
            <div className="answer-card">
              <b>🔒 Only you know this.</b>
              {privateNotes
                .filter((n) => n.round === view.round)
                .map((n, i) => (
                  <p key={i}>
                    <i>{n.text}</i>
                  </p>
                ))}
              <span className="dim">
                Private to you, and provably true. Share it or sit on it.
              </span>
            </div>
          )}

          {me?.standsAccused && (
            <div className="answer-card">
              <b>⚖ You stand accused.</b> The vote split on you yesterday — pick one purchase
              and Maude will unseal it for the whole square (she reads the chain, so it cannot
              be a lie). Your vote unlocks after.
              <div className="row">
                <select value={discloseTx} onChange={(e) => setDiscloseTx(e.target.value)}>
                  <option value="">reveal which purchase?</option>
                  {loadHistory(wallet.address, gameId)
                    .filter((r) => (r.round ?? 0) >= 1)
                    .map((r) => (
                      <option key={r.txHash} value={r.txHash}>
                        {r.shopLabel}: {r.item}
                      </option>
                    ))}
                </select>
                <button
                  className="primary"
                  onClick={() => {
                    playerApi
                      .disclose(wallet, gameId, discloseTx)
                      .then(() => void load())
                      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
                  }}
                >
                  Let Maude unseal it
                </button>
              </div>
            </div>
          )}

          {me && (
            <div className="row">
              <input
                type="text"
                maxLength={280}
                placeholder="say it to their faces…"
                value={chatText}
                onChange={(e) => setChatText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && chatText.trim()) void sendChat();
                }}
              />
              <button disabled={!chatText.trim() || chatBusy} onClick={() => void sendChat()}>
                Say it
              </button>
            </div>
          )}
        </div>
      )}

      {(me?.alive || me?.ghostVoter) && view.phase === "day" && !view.winner && (
        <div className="panel">
          <h2>The trial</h2>
          {!view.marketClosed && (
            <p className="dim">
              <ToteIcon /> The trial begins when the market closes.{" "}
              {(view.stillShopping ?? []).length > 0 &&
                `Maude waits for: ${(view.stillShopping ?? []).join(", ")}.`}
            </p>
          )}
          <p className="dim">
            Who is the werebear? Ask Maude before you vote — <b>dawn comes the moment the last
            vote lands</b>, and it doesn't wait for unspent questions.
            {voted && (
              <>
                {" "}
                Current vote: <b>{voted}</b>.
              </>
            )}
          </p>
          <div className="row">
            <select value={voteTarget} onChange={(e) => setVoteTarget(e.target.value)}>
              <option value="">accuse whom?</option>
              {living.map((p) => (
                <option key={p.seat} value={p.name}>
                  {p.name}
                </option>
              ))}
            </select>
            <button
              className="primary"
              disabled={!voteTarget || !view.marketClosed || me?.standsAccused || me?.recovering}
              onClick={() => void castVote()}
            >
              {me?.recovering
                ? "🤕 Recovering — too weak to vote today"
                : me?.standsAccused
                  ? "Reveal a purchase first (see the square)"
                  : "Cast vote"}
            </button>
          </div>
        </div>
      )}

      {role === "werebear" && me?.alive && view.phase === "day" && !view.winner && (
        <div className="panel">
          <h2>🐻 The hunt (only you can see this)</h2>
          <p className="dim">
            Pick tonight's meal. You may change your mind until the day is resolved.
            {picked && (
              <>
                {" "}
                Current pick: <b>{picked}</b>.
              </>
            )}
          </p>
          <div className="row">
            <select value={pickTarget} onChange={(e) => setPickTarget(e.target.value)}>
              <option value="">eat whom?</option>
              {living.map((p) => (
                <option key={p.seat} value={p.name}>
                  {p.name}
                </option>
              ))}
            </select>
            <button className="primary" disabled={!pickTarget} onClick={() => void castPick()}>
              Mark for the night
            </button>
          </div>
        </div>
      )}

      {[...view.mornings].reverse().map((m) => (
        <div key={m.round} className="panel">
          <h2>Morning of day {m.round + 1}</h2>
          {m.banished && (
            <p>
              The village banished <b>{m.banished}</b> — {m.banishedRole === "werebear" ? "🐻 THE WEREBEAR!" : "a villager. Oops."}
            </p>
          )}
          {m.eaten && (
            <p>
              <b>{m.eaten}</b> was eaten in the night, like Gerald before them.
            </p>
          )}
          {m.notes.map((n, i) => (
            <p key={i} className="dim">
              {n}
            </p>
          ))}
          {(m.violations ?? []).map((v, i) => (
            <p key={i} className="dim">
              ⚖ {v}
            </p>
          ))}
          {m.winner && <p className="tagline">The {m.winner} has won.</p>}
        </div>
      ))}

      {film && (
        <div
          className="film-overlay"
          role="dialog"
          aria-label={film.caption}
          onClick={() => setFilm(null)}
        >
          <div className="film-frame" onClick={(e) => e.stopPropagation()}>
            <video
              src={film.src}
              autoPlay
              muted
              playsInline
              controls
              onError={() => setFilm(null)} // no reel for this villager (yet)
            />
            <p className="film-caption">{film.caption}</p>
            <button className="primary" onClick={() => setFilm(null)}>
              Close the curtains
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
