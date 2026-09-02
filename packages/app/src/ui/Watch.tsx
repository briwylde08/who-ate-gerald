import { useEffect, useRef, useState } from "react";

import { fetchGraph, fetchPublicView, pageHidden, type GraphView, type PublicView } from "../lib/player";
import { CHARACTERS } from "../lib/profile";
import { SHOPS, xlmDisplay } from "../lib/catalog";
import { explorerTx } from "../lib/activity";
import type { VillagerBalances } from "../lib/wallet";
import { SixSteps } from "./SixSteps";
import { BearIcon, CharEmoji } from "./CharIcon";

/**
 * #/watch — the wallet-free spectator page (Bri, 2026-09-01).
 *
 * Mirrors the player app — same masthead, same four tabs, same cards — so an
 * audience sees the game the players see (Bri: "exactly like the player
 * page"). Everything here reads ONLY the unauthenticated public endpoints
 * (/public and /graph): no wallet, no Freighter, no seat, and nothing on the
 * page that can join, buy, or vote. Additive route, like #/gm; the player
 * app is untouched.
 *
 * Films play here too — third person always, same finale chain as the app
 * (trial → kill → victory dance), once per morning per browser under
 * watch-scoped keys.
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

/** Example numbers for the demo's reference panels — a typical mid-game
 *  villager: registered, 27.5 XLM spendable, today's 25 XLM income still
 *  uncollected, friendbot XLM minus the buy-in in the public wallet. Spectators
 *  hold no purse; these exist so the presenter can point at the shapes. */
const DEMO_BALANCES: VillagerBalances = {
  publicXlm: 9_948_60_00000n,
  spendable: 27_50_00000n,
  receiving: 25_00_00000n,
  registered: true,
};
const DEMO_PURCHASES = 2;

const GAME_KEY = "gerald:watch-game";
type Tab = "town" | "village" | "maude" | "chatvote";

/** Build the film (or chain) for the latest morning — third person, no seat. */
function filmForMorning(v: PublicView): FilmSpec | null {
  const m = v.mornings.length > 0 ? v.mornings[v.mornings.length - 1] : null;
  if (!m) return null;
  const charOf = (name: string | null | undefined) =>
    name ? (v.players.find((p) => p.name === name)?.character ?? null) : null;

  if (v.winner === "werebear" && !v.calledOff) {
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
    return null;
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
  const [tab, setTab] = useState<Tab>("town");
  const [view, setView] = useState<PublicView | null>(null);
  const [graph, setGraph] = useState<GraphView | null>(null);
  const [film, setFilm] = useState<FilmSpec | null>(null);
  const viewRef = useRef<PublicView | null>(null);
  viewRef.current = view;

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

  const wasBanished = (name: string): boolean =>
    !!view?.mornings.some((m) => m.banished === name);
  const fateOf = (name: string): string | null => {
    if (!view) return null;
    const b = view.mornings.find((m) => m.banished === name);
    if (b) return `⚖ banished day ${b.round}`;
    const e = view.mornings.find((m) => m.eaten === name);
    if (e) return `🍽 eaten day ${e.round}`;
    return null;
  };

  const feed = [
    ...(graph?.edges ?? [])
      .filter((e) => e.txHash)
      .map((e) => ({
        ledger: e.ledger,
        txHash: e.txHash!,
        label: `Day ${e.round} · ${e.from} paid ${e.to} — amount confidential`,
      })),
    ...(graph?.deposits ?? []).map((d) => ({
      ledger: d.ledger,
      txHash: d.txHash,
      label: `${d.round < 1 ? "Lobby" : `Day ${d.round}`} · ${d.player} deposited ${d.amountXlm} XLM${d.round < 1 ? " (buy-in)" : ""} — public`,
    })),
  ].sort((a, b) => b.ledger - a.ledger);

  const lastMorning =
    view && view.mornings.length > 0 ? view.mornings[view.mornings.length - 1] : null;
  const round = view?.round ?? 0;
  const sightings = (graph?.edges ?? []).filter((e) => e.round === round);
  const seatsNeeded = view ? Math.max(0, (view.minPlayers ?? 8) - view.players.length) : 0;

  // ---------------------------------------------------------------- entry --
  if (!gameId) {
    return (
      <div className="app-root watch-page">
        <div className="masthead">
          <h1 className="title">
            Who Ate <span className="title-accent">Gerald?</span>
          </h1>
          <p className="subtitle">Trust is scarce. Gerald is dead.</p>
        </div>
        <div className="panel">
          <h2>👁 Watch a game</h2>
          <p className="dim">
            No wallet needed. Everything here is the public view: who's alive, who shopped
            where, the mornings, and the films. Amounts stay sealed, here and everywhere.
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
      </div>
    );
  }

  return (
    <div className="app-root watch-page">
      <div className="topbar">
        <h1>👁 watching “{gameId}”</h1>
        <span className="spacer" />
        <span className="dim">{view ? (view.phase === "ended" ? "ended" : `day ${view.round}`) : "…"} · live</span>
        <div className="topbar-actions">
          <button onClick={() => { setGameId(""); setEntry(""); setView(null); }}>Change game</button>
        </div>
      </div>

      <div className="masthead">
        <h1 className="title">
          Who Ate <span className="title-accent">Gerald?</span>
        </h1>
        <p className="subtitle">Trust is scarce. Gerald is dead.</p>
      </div>

      <div className="app-shell">
      <div className="app-main">
      <div className="tabs">
        <button className={tab === "town" ? "active" : ""} aria-current={tab === "town" ? "page" : undefined} onClick={() => setTab("town")}>
          Town Square
        </button>
        <button className={tab === "village" ? "active" : ""} aria-current={tab === "village" ? "page" : undefined} onClick={() => setTab("village")}>
          The Shops
        </button>
        <button className={tab === "maude" ? "active" : ""} aria-current={tab === "maude" ? "page" : undefined} onClick={() => setTab("maude")}>
          Maude
        </button>
        <button className={tab === "chatvote" ? "active" : ""} aria-current={tab === "chatvote" ? "page" : undefined} onClick={() => setTab("chatvote")}>
          Chat &amp; Vote
        </button>
      </div>

      {!view && (
        <div className="panel">
          <p className="dim">Looking for “{gameId}”…</p>
        </div>
      )}

      {/* ------------------------------------------------ TOWN SQUARE ----- */}
      {view && tab === "town" && (
        <>
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

          {lastMorning && (
            <div className="panel">
              <h2>📯 The Town Crier — morning of day {lastMorning.round + 1}</h2>
              {lastMorning.banished && (
                <p>
                  The village banished <b>{lastMorning.banished}</b>
                  {lastMorning.banishedRole === "werebear" ? (
                    <>
                      {" "}
                      — <BearIcon /> THE WEREBEAR!
                    </>
                  ) : (
                    " — a villager."
                  )}
                </p>
              )}
              {lastMorning.eaten && (
                <p>
                  <b>{lastMorning.eaten}</b> was eaten in the night, like Gerald before them.
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

          {view.dealt && (
            <p className="dim headcount">
              {view.players.filter((p) => p.alive).length}/{view.players.length} still alive
            </p>
          )}
          <div className="villagers">
            {view.players.map((p) => {
              const c = p.character ? CHAR_BY_ID.get(p.character) : null;
              const isBear = !!view.winner && view.bear === p.name;
              const isWinner =
                !!view.winner &&
                ((view.winner === "werebear" && isBear) ||
                  (view.winner === "village" && !isBear && p.alive));
              return (
                <div
                  key={p.seat}
                  className={`villager-card${p.alive ? "" : " dead"}${isBear ? " bear-seat" : ""}${isWinner ? " winner-seat" : ""}`}
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
                      <span
                        className={`v-fate-overlay${wasBanished(p.name) ? " waved" : ""}`}
                        aria-hidden="true"
                      >
                        {wasBanished(p.name) ? "👋" : "RIP"}
                      </span>
                    )}
                    {isBear && (
                      <span className="verdict-badge bear-badge">
                        <BearIcon /> the werebear
                      </span>
                    )}
                    {isWinner && !isBear && (
                      <span className="verdict-badge winner-badge">👑 winner</span>
                    )}
                  </div>
                  <div className="v-name">{p.name}</div>
                  <div className="v-role">{c?.title ?? "new in town"}</div>
                  <div className="v-status">
                    {p.alive
                      ? p.drunkToday
                        ? "🍺 dead drunk"
                        : view.dealt
                          ? "in the village"
                          : p.ready
                            ? "ready"
                            : "not ready"
                      : (fateOf(p.name) ?? "dead")}
                  </div>
                </div>
              );
            })}
            {!view.dealt &&
              Array.from({ length: seatsNeeded }).map((_, i) => (
                <div key={`seat-${i}`} className="villager-card empty">
                  <div className="v-portrait empty-frame" aria-hidden="true" />
                  <div className="v-name">Empty seat</div>
                </div>
              ))}
          </div>
        </>
      )}

      {/* ------------------------------------------------- THE SHOPS ------ */}
      {view && tab === "village" && (
        <div className="shop-page">
          <div className="panel purse">
            <h2 style={{ margin: "0 0 12px" }}>A villager's purse — dummy data</h2>
            <div className="purse-block">
              <div className="purse-label">🔒 Confidential spending balance</div>
              <div className="purse-amount">{xlmDisplay(DEMO_BALANCES.spendable)} XLM</div>
              <div className="purse-note">
                Confidential claims that represent your share of the confidential token contract
                pool
              </div>
            </div>
            <div className="purse-block">
              <div className="purse-label">📦 Uncollected</div>
              <div className="purse-amount secondary">{xlmDisplay(DEMO_BALANCES.receiving)} XLM</div>
              <div className="purse-note">
                Payments land here first, so nobody can spoil a proof you're building
              </div>
            </div>
            <div className="purse-block">
              <div className="purse-label">👁 Public wallet</div>
              <div className="purse-amount secondary">{xlmDisplay(DEMO_BALANCES.publicXlm)} XLM</div>
              <div className="purse-note">Everyone can see this</div>
            </div>
          </div>
          <div className="panel shop-howto">
            {round >= 1 ? (
              <div className="role-label">Day {round}</div>
            ) : (
              <p className="shut-note">🔒 The stores are shut until the game begins.</p>
            )}
            <p className="dim">
              Every purchase is a confidential transfer: the ledger shows <i>who paid which
              shop</i>, never the amount — and since every price is unique, the amount IS the
              item. What each item does is public knowledge; who bought which one is not.
            </p>
            {round >= 1 && (
              <p className="dim">
                {view.marketClosed
                  ? "The market has closed for the day."
                  : `Still shopping: ${(view.stillShopping ?? []).join(", ") || "—"}.`}
              </p>
            )}
          </div>

          {round >= 1 && (
            <div className="panel">
              <h3 className="composer-head">Seen at the stores today</h3>
              {sightings.length > 0 ? (
                <div className="sightings">
                  {sightings.map((e, i) => (
                    <span key={i} className="sighting">
                      {e.from} <span className="dim">→</span> {e.to}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="dim">Nobody has been seen at a store yet today.</p>
              )}
            </div>
          )}

          {SHOPS.map((shop) => {
            const shut = (view.closedShops ?? []).includes(shop.id);
            return (
              <div key={shop.id} className={`panel shop-card${shut ? " shut" : ""}`}>
                <h3>
                  {shop.icon && (
                    <span className="shop-icon" aria-hidden="true">
                      {shop.icon}
                    </span>
                  )}
                  {shop.label}
                </h3>
                {shop.subtitle && <p className="shop-sub">“{shop.subtitle}”</p>}
                {shut && (
                  <p className="shut-note">
                    🧳 Shuttered today — the shopkeeper is on holiday. Somebody paid for that.
                  </p>
                )}
                <div className="items">
                  {shop.items.map((item) => (
                    <div key={item.id} className="item">
                      <div className="item-main">
                        <div className="item-name">{item.label}</div>
                        {item.flavor && <p className="item-flavor">“{item.flavor}”</p>}
                        <p className="item-effect">{item.effect}</p>
                      </div>
                      <div className="item-price">{item.priceXlm} XLM</div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          <div className="panel activity-log">
            <div className="activity-head">
              <h3>Onchain activity</h3>
            </div>
            {feed.length === 0 && (
              <p className="dim">
                Nothing yet — the village's transactions appear here as they land on the chain.
              </p>
            )}
            <div className="activity-rows">
              {feed.map((a, i) => (
                <div key={`${a.txHash}-${i}`} className="activity-row">
                  <span className="activity-main">
                    <span className="activity-label">{a.label}</span>
                  </span>
                  <a className="tx-link" href={explorerTx(a.txHash)} target="_blank" rel="noreferrer">
                    {a.txHash.slice(0, 8)}… ↗
                  </a>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* --------------------------------------------------- MAUDE -------- */}
      {view && tab === "maude" && (
        <div className="maude-page">
          <div className="panel maude-intro">
            <img
              className="maude-portrait"
              src="/characters/maude.jpg"
              alt="Maude McLedger at her table, one hand on a crystal ball, a ledger open beside her"
            />
            <div className="maude-words">
              <div className="role-label">The Auditor</div>
              <h2>Maude McLedger</h2>
              <p className="dim">
                As the Auditor, Maude holds the one key that can read every confidential amount
                on the ledger — her answers come straight from the chain.
              </p>
              <p className="dim">
                An auditor isn't a contract; it's a keypair. A confidential token contract can
                be deployed with an auditor's public key baked in, and every transfer must
                include its amount encrypted to that key or the network rejects it. Whoever
                holds the matching secret key can read every amount. Here, that's Maude.
              </p>
              <p className="dim">
                One question per villager per day, and no other villager sees her answer —
                which is why this page can't show you what she said.
              </p>
            </div>
          </div>
          {round >= 1 && (
            <div className="panel">
              <h3 className="composer-head">Who has asked today</h3>
              <div className="roster-strip">
                {view.players
                  .filter((p) => p.alive)
                  .map((p) => (
                    <span key={p.seat} className="roster-chip">
                      <b>{p.name}</b>
                      <span className="dim"> {p.askedToday ? "🔮 asked" : "— not yet"}</span>
                    </span>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ------------------------------------------------ CHAT & VOTE ----- */}
      {view && tab === "chatvote" && (
        <>
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
          </div>

          {!view.winner && view.round >= 1 && (
            <div className="panel">
              <p className="dim">
                {view.marketClosed
                  ? (view.awaitingVotes ?? []).length > 0
                    ? `🗳 The trial is on. Still to vote: ${(view.awaitingVotes ?? []).join(", ")}.`
                    : "🗳 Every vote is in — dawn is close."
                  : `🧺 The square fills when the market closes. Still shopping: ${(view.stillShopping ?? []).join(", ") || "—"}.`}
              </p>
            </div>
          )}

          <div className="panel">
            <h2>The square</h2>
            {(view.chat ?? []).length === 0 ? (
              <p className="dim">Nobody has said anything yet. Suspicious, honestly.</p>
            ) : (
              <div className="chat">
                {(view.chat ?? []).slice(-60).map((m, i) => (
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
            )}
          </div>

          {view.winner && (
            <div className="panel">
              <p className="dim">The game is over — the reckoning is in the Town Square tab.</p>
            </div>
          )}
        </>
      )}

      </div>
      {view && (
        <aside className="six-aside">
          <div className="panel">
            <p className="dim" style={{ margin: "0 0 6px", fontSize: "0.72rem" }}>
              Dummy data — a typical villager's view
            </p>
            <SixSteps
              balances={DEMO_BALANCES}
              purchases={DEMO_PURCHASES}
              tills={view.tills ?? null}
            />
          </div>
        </aside>
      )}
      </div>

      {/* Films — same overlay as the app, chain and all. */}
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
