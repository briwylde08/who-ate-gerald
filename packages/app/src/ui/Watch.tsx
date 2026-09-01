import { useEffect, useRef, useState } from "react";

import { fetchGraph, fetchPublicView, pageHidden, type GraphView, type PublicView } from "../lib/player";
import { CHARACTERS } from "../lib/profile";

/**
 * #/watch — the wallet-free spectator page (Bri, 2026-09-01).
 *
 * Built for the live demo's projected screen and for anyone in an audience:
 * open the URL, type a game id, watch. Reads ONLY the unauthenticated public
 * endpoints (/public and /graph), so there is no wallet, no Freighter, no
 * seat, and nothing on the page that can join, buy, or vote. The player app
 * is untouched — this is an additive route, like #/gm.
 *
 * The films play here too, third-person always, with the same finale chain
 * as the player app (trial → kill → victory dance). Once per morning per
 * browser, keyed separately from the player app's film keys.
 */

const CHAR_BY_ID = new Map(CHARACTERS.map((c) => [c.id, c]));
const nightFilmSrc = (characterId: string) => `/videos/${characterId}_gets_got.mp4`;
const BANISHED_FILMS = new Set([
  "midwife",
  "gravedigger",
  "drunk",
  "baker",
  "ratcatcher",
  "lamplighter",
  "beekeeper",
  "poacher",
]);
const banishedFilmSrc = (characterId: string) =>
  BANISHED_FILMS.has(characterId) ? `/videos/${characterId}_banished.mp4` : null;

interface FilmSpec {
  src: string;
  caption: string;
  started?: boolean;
  next?: FilmSpec;
  nextLabel?: string;
}

const GAME_KEY = "gerald:watch-game";

/** Build the film (or chain) for the latest morning — third person, no seat. */
function filmForMorning(v: PublicView): FilmSpec | null {
  const m = v.mornings.length > 0 ? v.mornings[v.mornings.length - 1] : null;
  if (!m) return null;
  const charOf = (name: string | null | undefined) =>
    name ? (v.players.find((p) => p.name === name)?.character ?? null) : null;

  if (v.winner === "werebear" && !v.calledOff) {
    // The finale chain: trial → kill → victory dance (same order as the app).
    const victory: FilmSpec = {
      src: "/videos/bear_wins.mp4",
      caption: `${v.bear ?? "The werebear"} has won. The village belongs to the bear.`,
    };
    const victimChar = charOf(m.eaten);
    const kill: FilmSpec | undefined = victimChar
      ? {
          src: nightFilmSrc(victimChar),
          caption: `${m.eaten} was taken in the night.`,
          next: victory,
          nextLabel: "🐻 How did it end?",
        }
      : undefined;
    const banisheeChar = m.banished && m.banished !== m.eaten ? charOf(m.banished) : null;
    const trialReel = banisheeChar ? banishedFilmSrc(banisheeChar) : null;
    if (trialReel) {
      return {
        src: trialReel,
        caption: `${m.banished} was banished.`,
        next: kill ?? victory,
        nextLabel: kill ? "🌙 And in the night?" : "🐻 How did it end?",
      };
    }
    return kill ?? victory;
  }
  if (m.banishedRole === "werebear" && m.banished) {
    return {
      src: nightFilmSrc("werebear"),
      caption: `${m.banished} was the werebear — and the village got them.`,
    };
  }
  if (m.eaten) {
    const victimChar = charOf(m.eaten);
    if (!victimChar) return null;
    const banisheeChar = m.banished && m.banished !== m.eaten ? charOf(m.banished) : null;
    const trialReel = banisheeChar ? banishedFilmSrc(banisheeChar) : null;
    return {
      src: nightFilmSrc(victimChar),
      caption: `${m.eaten} was taken in the night.`,
      next: trialReel ? { src: trialReel, caption: `${m.banished} was banished.` } : undefined,
      nextLabel: "⚖ Who got banished?",
    };
  }
  if (m.banished) {
    const banisheeChar = charOf(m.banished);
    const trialReel = banisheeChar ? banishedFilmSrc(banisheeChar) : null;
    if (trialReel) return { src: trialReel, caption: `${m.banished} was banished.` };
    return null; // banishment without a reel stays crier-only
  }
  if (!v.winner) {
    return { src: "/videos/no_one_eaten.mp4", caption: "Nobody was eaten in the night." };
  }
  return null;
}

export function Watch() {
  const [gameId, setGameId] = useState<string>(() => {
    const fromHash = new URLSearchParams(window.location.hash.split("?")[1] ?? "").get("g");
    return fromHash ?? localStorage.getItem(GAME_KEY) ?? "";
  });
  const [entry, setEntry] = useState(gameId);
  const [view, setView] = useState<PublicView | null>(null);
  const [graph, setGraph] = useState<GraphView | null>(null);
  const [film, setFilm] = useState<FilmSpec | null>(null);
  const viewRef = useRef<PublicView | null>(null);
  viewRef.current = view;

  // Poll the public view (fast) and the graph (slower) — no auth anywhere.
  useEffect(() => {
    if (!gameId) return;
    localStorage.setItem(GAME_KEY, gameId);
    let stale = false;
    const pullView = () => {
      if (pageHidden()) return;
      fetchPublicView(gameId)
        .then((v) => !stale && setView(v))
        .catch(() => !stale && setView(null));
    };
    const pullGraph = () => {
      if (pageHidden()) return;
      fetchGraph(gameId)
        .then((g) => !stale && setGraph(g))
        .catch(() => undefined);
    };
    pullView();
    pullGraph();
    const t = setInterval(pullView, 4_000);
    const g = setInterval(pullGraph, 12_000);
    return () => {
      stale = true;
      clearInterval(t);
      clearInterval(g);
    };
  }, [gameId]);

  // Roll the film for a fresh morning — once per morning per browser.
  useEffect(() => {
    if (!view || !gameId) return;
    const m = view.mornings.length > 0 ? view.mornings[view.mornings.length - 1] : null;
    if (!m) return;
    const seenKey = `gerald:watchfilm:${gameId}:${m.round}`;
    if (localStorage.getItem(seenKey)) return;
    const spec = filmForMorning(view);
    if (spec) {
      localStorage.setItem(seenKey, "1");
      setFilm(spec);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view?.mornings.length, gameId]);

  const fateOf = (name: string): string | null => {
    if (!view) return null;
    const b = view.mornings.find((mm) => mm.banished === name);
    if (b) return `⚖ banished day ${b.round}`;
    const e = view.mornings.find((mm) => mm.eaten === name);
    if (e) return `🍽 eaten day ${e.round}`;
    return null;
  };

  const lastMorning =
    view && view.mornings.length > 0 ? view.mornings[view.mornings.length - 1] : null;
  const round = view?.round ?? 0;
  const sightings = (graph?.edges ?? []).filter((e) => e.round === round);

  return (
    <div className="app-shell watch-page">
      <div className="topbar">
        <h1>Who Ate Gerald? — 👁 watching</h1>
        <span className="spacer" />
        {view && (
          <span className="dim">
            {gameId} · {view.phase === "ended" ? "ended" : `day ${view.round}`} · live
          </span>
        )}
      </div>

      {!gameId && (
        <div className="panel">
          <h2>Watch a game</h2>
          <p className="dim">
            No wallet needed. Type the game's id — everything on this page is the public view:
            who's alive, who shopped where, the mornings, and the films. Amounts stay sealed,
            here and everywhere.
          </p>
          <div className="row">
            <input
              type="text"
              placeholder="the game's id"
              value={entry}
              onChange={(e) => setEntry(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && entry.trim()) setGameId(entry.trim());
              }}
            />
            <button className="primary" disabled={!entry.trim()} onClick={() => setGameId(entry.trim())}>
              Watch
            </button>
          </div>
        </div>
      )}

      {gameId && !view && (
        <div className="panel">
          <p className="dim">Looking for “{gameId}”…</p>
          <div className="row">
            <button onClick={() => { setGameId(""); setView(null); }}>Watch a different game</button>
          </div>
        </div>
      )}

      {view && (
        <>
          {/* Who's who */}
          <div className="panel roster-strip">
            {view.players.map((p) => (
              <span key={p.seat} className={`roster-chip${p.alive ? "" : " dead"}`}>
                <b>{p.name}</b>
                <span className="dim">
                  {" "}
                  {p.alive
                    ? p.drunkToday
                      ? "🍺 dead drunk"
                      : "alive"
                    : `${fateOf(p.name) ?? "dead"}${p.ghostVoter ? " · 👻 votes" : ""}`}
                </span>
              </span>
            ))}
            {view.players.length === 0 && <span className="dim">Nobody seated yet.</span>}
          </div>

          {/* Reckoning */}
          {view.winner && (
            <div className="panel">
              <h2>{view.winner === "village" ? "🌻 The village won" : "🐻 The werebear won"}</h2>
              {view.bear && (
                <p>
                  <b>{view.bear} was the werebear.</b>{" "}
                  {view.calledOff
                    ? "The Order called the hunt off before the village found them."
                    : view.winner === "werebear"
                      ? "They shopped beside the village, voted beside it, and outlasted it."
                      : "The village sleeps safe."}
                </p>
              )}
              {!view.calledOff && (
                <div className="row">
                  <button
                    className="primary"
                    onClick={() => {
                      const spec = filmForMorning(view);
                      if (spec) setFilm({ ...spec, started: true });
                    }}
                  >
                    🎬 Watch the ending
                  </button>
                </div>
              )}
            </div>
          )}

          {/* The town crier — latest morning */}
          {lastMorning && !view.winner && (
            <div className="panel">
              <h2>📯 The Town Crier — morning of day {lastMorning.round + 1}</h2>
              {lastMorning.banished && (
                <p>
                  The village banished <b>{lastMorning.banished}</b>
                  {lastMorning.banishedRole === "werebear" ? " — THE WEREBEAR!" : " — a villager."}
                </p>
              )}
              {lastMorning.eaten && (
                <p>
                  <b>{lastMorning.eaten}</b> was eaten in the night.
                </p>
              )}
              {!lastMorning.banished && !lastMorning.eaten && <p>Nobody died. A rare morning.</p>}
              {lastMorning.notes.map((n, i) => (
                <p key={i} className="crier-note">
                  {n}
                </p>
              ))}
            </div>
          )}

          {/* Day status */}
          {!view.winner && view.round >= 1 && (
            <div className="panel">
              <p className="dim">
                {view.marketClosed
                  ? (view.awaitingVotes ?? []).length > 0
                    ? `🗳 The trial is on. Still to vote: ${(view.awaitingVotes ?? []).join(", ")}.`
                    : "🗳 Every vote is in — dawn is close."
                  : `🧺 The market is open. Still shopping: ${(view.stillShopping ?? []).join(", ") || "—"}.`}
              </p>
            </div>
          )}

          {/* Sightings */}
          {round >= 1 && (
            <div className="panel">
              <h3 className="composer-head">Seen at the stores today</h3>
              {sightings.length > 0 ? (
                <>
                  <div className="sightings">
                    {sightings.map((e, i) => (
                      <span key={i} className="sighting">
                        {e.from} <span className="dim">→</span> {e.to}
                      </span>
                    ))}
                  </div>
                  <p className="dim">
                    Who went where is public. What they bought — and what they paid — is not.
                  </p>
                </>
              ) : (
                <p className="dim">Nobody has been seen at a store yet today.</p>
              )}
            </div>
          )}

          {/* The square */}
          {(view.chat ?? []).length > 0 && (
            <div className="panel">
              <h2>The square</h2>
              <div className="chat">
                {(view.chat ?? []).slice(-40).map((m, i) => (
                  <p
                    key={i}
                    className="chat-line"
                    style={m.ghost ? { opacity: 0.65, fontStyle: "italic" } : undefined}
                  >
                    <b>
                      {m.ghost ? "👻 " : ""}
                      {m.name}:
                    </b>{" "}
                    {m.text}
                  </p>
                ))}
              </div>
            </div>
          )}

          <div className="row">
            <button onClick={() => { setGameId(""); setEntry(""); setView(null); }}>
              Watch a different game
            </button>
          </div>
        </>
      )}

      {/* Films — same overlay pattern as the app, chain and all. */}
      {film && (
        <div
          className="film-overlay"
          role="dialog"
          aria-label={film.caption}
          onClick={() => {
            if (!film.next) setFilm(null);
          }}
        >
          <div className="film-frame" onClick={(e) => e.stopPropagation()}>
            {!film.next && (
              <button className="panel-x film-x" aria-label="Close" onClick={() => setFilm(null)}>
                ✕
              </button>
            )}
            {film.started ? (
              <video src={film.src} autoPlay playsInline controls onError={() => setFilm(null)} />
            ) : (
              <button className="primary film-play" onClick={() => setFilm({ ...film, started: true })}>
                ▶ Watch the night
              </button>
            )}
            <p className="film-caption">{film.caption}</p>
            {film.next && (
              <button className="primary" onClick={() => setFilm({ ...film.next!, started: true })}>
                {film.nextLabel ?? "▶ Next"}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
