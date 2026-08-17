import { useCallback, useEffect, useRef, useState } from "react";

import { VillagerWallet, type VillagerBalances, type TxPhase } from "../lib/wallet";
import { DEPLOYMENT } from "../lib/deployment";
import { STARTING_BUDGET_XLM, stroopsFromXlm } from "../lib/catalog";
import { loadProfile, clearProfile, characterOf, saveProfile, type Profile } from "../lib/profile";
import { fetchGraph, fetchPublicView, loadGameId, pageHidden, playerApi, saveGameId, type ServerPurchases } from "../lib/player";
import { CharEmoji } from "./CharIcon";
import { Intro } from "./Intro";
import { GeraldStory } from "./Story";
import { Village } from "./Village";
import { Maude } from "./Maude";
import { Town } from "./Town";
import { ChatVote } from "./ChatVote";
import { Satchel } from "./Satchel";
import { SixSteps } from "./SixSteps";
import { loadHistory, treasuryOwed } from "../lib/history";

/**
 * A purchase takes real seconds because it really is proving a statement in
 * zero knowledge. Rather than hide that behind one vague spinner, narrate the
 * true steps — this is the moment a player is watching most closely, and every
 * line below describes something the code is actually doing right then.
 */
const PHASE_LABEL: Record<TxPhase, string> = {
  reading: "Reading your sealed balance — the encrypted copy only you can open…",
  witness:
    "Building the witness: your new balance, the shop's, and the Auditor's copy — all sealed…",
  proving:
    "Proving it in your browser — real zero-knowledge cryptography, which is why this takes a moment…",
  submitting: "Submitting: the network verifies the proof without ever learning the amount…",
};

type Step = { id: string; label: string; sub?: string; status: "todo" | "doing" | "done" };

/** A villager's "gets got" reel; the werebear's plays when the village
 *  catches it. A missing file just means no film (handled by onError). */
const nightFilmSrc = (characterId: string) => `/videos/${characterId}_gets_got.mp4`;
// Characters with a dedicated banishment reel (Bri's films, 2026-08-17).
// A trial is not an attack: the gets-got reels stay the bear's alone, and a
// banished villager gets a film only once their character has one of THESE.
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

/** The four steps of taking a seat, worded to teach — shown as a preview
 *  before the button is pressed and ticked live while they run. */
const STEP_COPY = {
  fund: {
    label: "Fund your public account",
    sub: "Ordinary testnet XLM from the faucet. This part everyone can see — that's normal Stellar.",
  },
  register: {
    label: "Register with the confidential token contract",
    sub: "One transaction, one zero-knowledge proof, once ever: it binds your encryption keys so only you (and the Auditor) can ever read your balance.",
  },
  deposit: {
    label: "Buy in: 50 XLM into the shared pool",
    sub: "The amount is public on purpose — the whole village can verify everyone starts with the same 50. Inside the pool it becomes a sealed claim only you can spend.",
  },
  merge: {
    label: "Collect your budget into your purse",
    sub: "Incoming money lands in a pending inbox first, so nobody can spoil a proof you're building by paying you mid-proof. Collecting moves it to the balance only you control.",
  },
} as const;

export function PlayerApp() {
  const [profile, setProfile] = useState<Profile | null>(loadProfile);
  const [wallet, setWallet] = useState<VillagerWallet | null>(null);
  const [balances, setBalances] = useState<VillagerBalances | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  type Tab = "village" | "maude" | "chatvote" | "town";
  // A refresh keeps you where you were — losing your tab to F5 was pure loss.
  // (A stored "ledger" from before that tab retired falls back to town.)
  const [tab, setTabRaw] = useState<Tab>(() => {
    const stored = sessionStorage.getItem("gerald:tab");
    return stored === "village" || stored === "maude" || stored === "chatvote"
      ? stored
      : "town";
  });
  const setTab = (v: Tab) => {
    sessionStorage.setItem("gerald:tab", v);
    setTabRaw(v);
  };
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [tills, setTills] = useState<{ round: number; shops: string[] } | null>(null);
  const [gameId, setGameId] = useState(loadGameId);
  const [visitedShops, setVisitedShops] = useState<string[]>([]);
  const [round, setRound] = useState(0);
  const [storyOpen, setStoryOpen] = useState(false);
  /** The night's film — APP-level, so it shows no matter which tab you're
   *  on. It lived in the Town Square once, where dawn breaking while you
   *  voted on Chat & Vote played it invisibly AND marked it seen. */
  const [film, setFilm] = useState<{ src: string; caption: string; started?: boolean } | null>(null);
  /** Personal banishment notice — a ghost shouldn't learn their fate from
   *  fine print (Bri). Shown once, before any film. */
  const [banishedNotice, setBanishedNotice] = useState<string | null>(null);
  /** The ending film, replayable on demand from the reckoning card — the
   *  auto-popup raced at least once (testing3) and the ending is too good
   *  to lose to a race. */
  const endingFilm = useRef<{ src: string; caption: string } | null>(null);
  /** Dead villagers collect nothing — the sidebar must not owe them. */
  const [meAlive, setMeAlive] = useState(true);
  /** Set once the game has a winner — every poll goes quiet (issue #12).
   *  The reckoning is final; nothing it shows can change. */
  const gameOverRef = useRef(false);
  /** A lobby re-seat (Change villager) in flight — don't stack joins. */
  const reseating = useRef(false);
  /** The server's answer to "what have I spent?" — survives fresh browsers. */
  const [serverSpend, setServerSpend] = useState<ServerPurchases | null>(null);
  useEffect(() => {
    if (!wallet || round < 1) return;
    let stale = false;
    playerApi
      .myPurchases(wallet, gameId)
      .then((r) => !stale && setServerSpend(r))
      .catch(() => undefined); // not seated / auth not cached — local math stands
    return () => {
      stale = true;
    };
  }, [wallet, gameId, round]);
  /** Where the intro opens when we send someone back to it: "game" for the
   *  chooser (change game), "identity" for the villager picker. */
  const [introAt, setIntroAt] = useState<"story" | "game" | "identity">("story");
  const refreshing = useRef(false);
  /** Always the game we are CURRENTLY in, for discarding stale poll replies. */
  const gameIdRef = useRef(gameId);
  gameIdRef.current = gameId;
  useEffect(() => {
    gameOverRef.current = false; // a new game gets fresh polls
  }, [gameId]);

  const refresh = useCallback(
    async (w: VillagerWallet) => {
      if (refreshing.current) return;
      refreshing.current = true;
      try {
        setBalances(await w.balances());
        // The public graph tells us which shops we've visited this round
        // (drives the two-shops-a-day custom).
        try {
          const g = await fetchGraph(gameId);
          setRound(g.round);
          const myName = g.players.find((p) => p.address === w.address)?.name;
          if (myName && g.round >= 1) {
            setVisitedShops([
              ...new Set(
                g.edges.filter((e) => e.from === myName && e.round === g.round).map((e) => e.to),
              ),
            ]);
          } else {
            setVisitedShops([]);
          }
        } catch {
          setVisitedShops([]); // no game yet — no cap
        }
      } finally {
        refreshing.current = false;
      }
    },
    [gameId],
  );

  const connect = useCallback(
    async (silent = false) => {
      setError(null);
      setBusy(silent ? "Waking the village…" : "Waking Freighter…");
      try {
        const w = await VillagerWallet.connect();
        setWallet(w);
        localStorage.setItem("gerald:connected", "1"); // enables auto-reconnect
        setBusy("Reading the ledger…");
        await refresh(w);
      } catch (e) {
        if (!silent) setError(msg(e));
      } finally {
        setBusy(null);
      }
    },
    [refresh],
  );

  // A refresh shouldn't send you back to the connect page: once you've
  // connected on this browser, Freighter re-authorizes silently on load.
  useEffect(() => {
    if (profile && !wallet && localStorage.getItem("gerald:connected")) {
      void connect(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onPhase = (phase: TxPhase) => setBusy(PHASE_LABEL[phase]);

  /** Tab jumps land at the TOP of the destination — tabs share one scroll
   *  position, so 'Ask Maude' used to drop you mid-page (Bri's note). */
  const goTab = (t: Tab) => {
    setTab(t);
    window.scrollTo({ top: 0 });
  };

  // The error banner lives above the tabs, so an error raised by a control at
  // the bottom of the Shops rendered off-screen on a phone — from where the
  // player was standing, the button simply did nothing.
  useEffect(() => {
    if (error) window.scrollTo({ top: 0, behavior: "smooth" });
  }, [error]);

  /** fund → register → deposit budget → merge, skipping what's already done. */
  const provision = async () => {
    if (!wallet || !balances) return;
    setError(null);
    const plan: Step[] = [
      { id: "fund", ...STEP_COPY.fund, status: "todo" },
      ...(balances.registered ? [] : [{ id: "register", ...STEP_COPY.register, status: "todo" as const }]),
      ...(balances.spendable + balances.receiving > 0n
        ? []
        : [{ id: "deposit", ...STEP_COPY.deposit, status: "todo" as const }]),
      { id: "merge", ...STEP_COPY.merge, status: "todo" },
    ];
    setSteps(plan);
    const mark = (id: string, status: Step["status"]) =>
      setSteps((s) => s?.map((st) => (st.id === id ? { ...st, status } : st)) ?? null);

    try {
      for (const step of plan) {
        mark(step.id, "doing");
        if (step.id === "fund") await wallet.fund();
        if (step.id === "register") {
          await wallet.register(onPhase);
          setBusy(null);
        }
        if (step.id === "deposit") await wallet.deposit(stroopsFromXlm(STARTING_BUDGET_XLM));
        if (step.id === "merge") {
          const b = await wallet.balances();
          if (b.receiving > 0n) await wallet.merge();
        }
        mark(step.id, "done");
      }
      await refresh(wallet);
      setSteps(null);
    } catch (e) {
      setError(msg(e));
      setSteps(null);
    } finally {
      setBusy(null);
    }
  };

  // Periodic balance refresh while in the village.
  useEffect(() => {
    if (!wallet) return;
    const t = setInterval(() => {
      if (pageHidden() || gameOverRef.current) return;
      void refresh(wallet);
    }, 30_000);
    return () => clearInterval(t);
  }, [wallet, refresh]);

  // Day awareness: the public view is a cheap in-memory read, so poll it
  // fast — a new day should flip the whole app (shops unlock, allowance
  // grows, Done resets) without anyone touching F5.
  useEffect(() => {
    if (!wallet) return;
    const t = setInterval(async () => {
      if (pageHidden() || gameOverRef.current) return;
      try {
        const v = await fetchPublicView(gameId);
        if (v.winner) {
          gameOverRef.current = true;
          endingFilm.current =
            v.winner === "werebear" && !v.calledOff
              ? { src: "/videos/bear_wins.mp4", caption: `${v.bear ?? "The werebear"} has won. The village belongs to the bear.` }
              : v.bear
                ? { src: nightFilmSrc("werebear"), caption: `${v.bear} was the werebear — and the village got them.` }
                : null;
        }
        // A reply for the game we just LEFT must not touch anything: it would
        // snap the player back to their old seat the instant they switch.
        if (gameIdRef.current !== gameId) return;
        setRound((r) => (v.round !== r ? v.round : r));
        if (v.tills) setTills((t) => (t?.round === v.tills!.round ? t : v.tills!));
        // A fresh banishment of YOU gets a personal notice before any film.
        const bm = [...v.mornings].reverse().find((x) => x.banished);
        if (bm?.banished) {
          const seat2 = v.players.find((p) => p.name === bm.banished);
          if (seat2?.address === wallet.address) {
            const bKey = `gerald:banished:${gameId}:${bm.round}`;
            if (!localStorage.getItem(bKey)) {
              localStorage.setItem(bKey, "1");
              setBanishedNotice(
                `The village voted, and the rope chose you. You were banished on day ${bm.round}. You can still haunt the chat — the living can hear you.`,
              );
            }
          }
        }
        // Roll the right film for a fresh morning — once per morning per
        // browser, and only ever where it can actually be SEEN.
        const filmMorning = v.mornings.length > 0 ? v.mornings[v.mornings.length - 1] : null;
        if (filmMorning) {
          const seenKey = `gerald:film:${gameId}:${filmMorning.round}`;
          if (!localStorage.getItem(seenKey)) {
            if (v.winner === "werebear" && !v.calledOff) {
              // The bear wins — parity or the clock, one reel for both
              // (Bri's film, 2026-08-06). Outranks the night's own film:
              // this IS the ending.
              localStorage.setItem(seenKey, "1");
              setFilm({
                src: "/videos/bear_wins.mp4",
                caption: `${v.bear ?? "The werebear"} has won. The village belongs to the bear.`,
              });
            } else if (filmMorning.banishedRole === "werebear" && filmMorning.banished) {
              localStorage.setItem(seenKey, "1");
              setFilm({
                src: nightFilmSrc("werebear"),
                caption: `${filmMorning.banished} was the werebear — and the village got them.`,
              });
            } else if (filmMorning.eaten) {
              const victim = v.players.find((p) => p.name === filmMorning.eaten);
              if (victim?.character) {
                localStorage.setItem(seenKey, "1");
                setFilm({
                  src: nightFilmSrc(victim.character),
                  // When it's YOU, say so — the most personal beat in the game
                  // shouldn't read like someone else's news (issue #18).
                  caption:
                    victim.address === wallet.address
                      ? "You were taken in the night."
                      : `${filmMorning.eaten} was taken in the night.`,
                });
              }
            } else if (
              !filmMorning.eaten &&
              !v.winner &&
              filmMorning.banished &&
              banishedFilmSrc(
                v.players.find((p) => p.name === filmMorning.banished)?.character ?? "",
              )
            ) {
              // A trial with its OWN picture: characters with a dedicated
              // banishment reel (Bri's films, 2026-08-17) get it — the
              // 2026-08-14 no-reel ruling was about attack films telling
              // the wrong story, not about trials staying invisible.
              const banishee = v.players.find((p) => p.name === filmMorning.banished);
              localStorage.setItem(seenKey, "1");
              setFilm({
                src: banishedFilmSrc(banishee?.character ?? "")!,
                caption: `${filmMorning.banished} was banished.`,
              });
            } else if (!filmMorning.eaten && !v.winner) {
              // Banishment (without a reel of its own) stays crier-only
              // (Bri's ruling, 2026-08-14): the gets-got films depict a
              // werebear attack, and playing one over a village trial told
              // the wrong story (game11 — Wick banished, bell rang, and his
              // "attack" reel rolled against a 'nobody died tonight' note).
              // A quiet night gets its own reel (Bri's film, 2026-08-06):
              // nobody eaten, game still on — the village exhales.
              localStorage.setItem(seenKey, "1");
              setFilm({
                src: "/videos/no_one_eaten.mp4",
                caption: "Nobody was eaten in the night.",
              });
            }
          }
        }
        // One wallet, one identity: the SEAT is the truth — but before the
        // deal, the truth is allowed to CHANGE. The old behavior snapped any
        // local profile drift straight back to the seat, which made "Change
        // villager" a button that always failed and blamed the player
        // (issue #14). The Intro promises face-switching while the lobby is
        // open, and the server allows it; now the app actually asks.
        const seat = v.players.find((p) => p.address === wallet.address);
        setMeAlive(seat ? seat.alive : true);
        if (seat?.character) {
          const prof = loadProfile();
          const drifted =
            prof && (prof.name !== seat.name || prof.characterId !== seat.character);
          if (drifted && !v.dealt && !reseating.current) {
            // Lobby: push the new identity to the seat. join() renames and
            // re-faces an existing seat, and refuses a face someone else holds.
            reseating.current = true;
            playerApi
              .join(wallet, gameId, prof.name, prof.characterId)
              .then(() => setError(null))
              .catch((e) => {
                // Face taken (or similar): the seat stays; snap the profile back.
                const fixed = { name: seat.name, characterId: seat.character! };
                saveProfile(fixed);
                setProfile(fixed);
                setError(
                  `Couldn't switch: ${e instanceof Error ? e.message : String(e)} — you're still ${seat.name}.`,
                );
              })
              .finally(() => {
                reseating.current = false;
              });
          } else if (drifted && v.dealt) {
            // Underway: faces are set. Snap back, and say why.
            const fixed = { name: seat.name, characterId: seat.character! };
            saveProfile(fixed);
            setProfile(fixed);
            setError(
              `The game is underway — your face is set. You are ${seat.name} in “${gameId}”.`,
            );
          }
        }
      } catch {
        // no game yet — the slow refresh will catch up
      }
    }, 5_000);
    return () => clearInterval(t);
  }, [wallet, gameId]);

  // Dawn broke: re-read balances and sightings immediately so the top-up
  // desk and the two-shops cap reflect today, not yesterday.
  useEffect(() => {
    if (wallet && round >= 1) void refresh(wallet);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round]);

  // Registered = provisioned. Being BROKE mid-game (spendable 0) is a
  // legitimate state — the Shops' top-up desk handles refills, not the
  // welcome flow.
  const provisioned = balances !== null && balances.registered;

  const [copied, setCopied] = useState(false);
  const logout = async () => {
    await wallet?.destroy();
    localStorage.removeItem("gerald:connected"); // stop auto-reconnecting
    clearProfile(); // back to the intro — name and villager are chosen fresh
    sessionStorage.removeItem("gerald:intro-page");
    sessionStorage.removeItem("gerald:tab");
    setProfile(null);
    setWallet(null);
    setBalances(null);
    setSteps(null);
    // Logging out then in must land on the Town Square — setTab remembers
    // its argument, so setting "village" here made Shops the login screen.
    setTab("town");
  };

  return (
    <div className="app-root">
      <div className="topbar">
        {profile && (
          <button
            className="addr"
            title="Change name / villager"
            onClick={() => {
              setIntroAt("identity");
              setProfile(null);
            }}
          >
            <CharEmoji c={characterOf(profile)} /> {profile.name} {characterOf(profile)?.title}
          </button>
        )}
        {profile && wallet && (
          <button
            className="mono addr"
            title="Copy your roster line (paste it to the GM)"
            onClick={() => {
              void navigator.clipboard.writeText(
                profile ? `${profile.name}, ${wallet.address}` : wallet.address,
              );
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {wallet.address.slice(0, 6)}…{wallet.address.slice(-6)} {copied ? "✓ copied" : "⧉"}
          </button>
        )}
        {/* Game-name text is read-only on purpose. Typing here used to
            repoint the whole app without moving your SEAT; switching games
            goes through the intro. Nothing in this group renders on the
            front page — no game talk before there is a game (Bri's call). */}
        {profile && (
          <>
            <span className="dim">game:</span>
            <span className="mono">{gameId}</span>
            <button
              className="link"
              onClick={() => {
                setIntroAt("game"); // the chooser, NOT the villager picker
                setProfile(null);
              }}
            >
              change game
            </button>
            <span className="dim contract-label">confidential token contract:</span>
            <a
              className="mono addr"
              href={`https://stellar.expert/explorer/testnet/contract/${DEPLOYMENT.token}`}
              target="_blank"
              rel="noreferrer"
              title="The game's confidential token on Stellar testnet — every purchase lives here, amounts hidden"
            >
              {DEPLOYMENT.token.slice(0, 6)}…{DEPLOYMENT.token.slice(-6)} ↗
            </a>
          </>
        )}
        <span className="spacer" />
        {/* Rules and Log out travel together so Log out can't wrap off the
            banner on its own. Available from the moment there's an identity to
            shed — the picker and connect screens are where people start over. */}
        <div className="topbar-actions">
          {profile && (
            <button
              title="Pick a different villager or name"
              onClick={() => {
                setIntroAt("identity");
                setProfile(null);
              }}
            >
              Change villager
            </button>
          )}
          {profile && (
            <button
              title="The story, the rules, and how it works"
              onClick={() => setStoryOpen((s) => !s)}
            >
              Rules
            </button>
          )}
          {(wallet || profile) && <button onClick={() => void logout()}>Log out</button>}
        </div>
      </div>

      {banishedNotice && (
        <div className="film-overlay" role="dialog" aria-label="You were banished">
          <div className="panel dawn-modal">
            <h2>⚖ You have been banished</h2>
            <p className="dawn-note">{banishedNotice}</p>
            <div className="row">
              <button className="primary" onClick={() => setBanishedNotice(null)}>
                So be it
              </button>
            </div>
          </div>
        </div>
      )}

      {film && !banishedNotice && (
        <div
          className="film-overlay"
          role="dialog"
          aria-label={film.caption}
          onClick={() => setFilm(null)}
        >
          <div className="film-frame" onClick={(e) => e.stopPropagation()}>
            {film.src && film.started ? (
              // Created AFTER the click: the user gesture lets it play WITH
              // sound — browsers forbid unmuted autoplay (Bri chose the
              // click over the mute).
              <video
                src={film.src}
                autoPlay
                playsInline
                controls
                onError={() => setFilm(null)}
              />
            ) : film.src ? (
              <button
                className="primary film-play"
                onClick={() => setFilm({ ...film, started: true })}
              >
                ▶ Watch the night
              </button>
            ) : (
              <img className="film-still" src="/bg.jpg" alt="" />
            )}
            <p className="film-caption">{film.caption}</p>
            <button className="primary" onClick={() => setFilm(null)}>
              Close the curtains
            </button>
          </div>
        </div>
      )}

      {storyOpen && (
        <div className="panel story">
          <GeraldStory />
          <div className="row">
            <button onClick={() => setStoryOpen(false)}>Close</button>
          </div>
        </div>
      )}
      <div className="masthead">
        <h1 className="title">
          Who Ate <span className="title-accent">Gerald?</span>
        </h1>
        <p className="subtitle">Trust is scarce. Gerald is dead.</p>
      </div>

      {error && (
        <div className="error" role="alert">
          {error} <button onClick={() => setError(null)}>dismiss</button>
        </div>
      )}

      {!profile && (
        <Intro
          // Remount when the requested page changes: Intro reads startAt into
          // useState ONCE, so without the key "change game" clicked while the
          // intro is already showing (the homepage) changed nothing at all.
          key={introAt}
          onDone={(p) => {
            setProfile(p);
            setGameId(loadGameId()); // the intro may have chosen a different game
            setTab("town"); // a fresh seat starts at the square, not wherever
            // this browser's remembered tab happened to be (usually Shops)
          }}
          address={wallet?.address}
          onConnect={() => void connect()}
          startAt={introAt}
        />
      )}

      {profile && !wallet && (
        <div className="panel">
          <p>
            Welcome, {profile.name} {characterOf(profile)?.title}.
          </p>
          <p className="dim">
            You need the Freighter extension, set to <b>Testnet</b>.
          </p>
          <p className="dim">
            Your hidden budget lives on-chain, tied to this account — as does your{" "}
            <b>registration with the confidential token contract</b>: a one-time transaction
            that binds your confidential keys to your address so you can hold and spend hidden
            amounts.
          </p>
          <div className="row">
            <button className="primary" onClick={() => void connect()} disabled={busy !== null}>
              Connect your wallet
            </button>
            <button
              onClick={() => {
                clearProfile();
                setProfile(null);
              }}
            >
              Not {profile.name}? Start over
            </button>
          </div>
        </div>
      )}

      {profile && wallet && !provisioned && (
        <div className="panel">
          <h2>🌕 Welcome to the village!</h2>
          <p className="dim mono">{wallet.address}</p>
          <p>
            Money here is a <b>confidential token</b>: real XLM sits in a shared pool, and what
            you hold is a sealed claim on it. Everyone can see <i>who</i> pays <i>whom</i> —
            nobody can see <i>how much</i>. Since every price in the village is unique, hiding
            the amount hides what you bought. That one trick is the whole game.
          </p>
          <p>
            Taking your seat is four real transactions, proved in this browser — about a
            minute. Each step below says what it's doing while it does it:
          </p>
          <ul className="steps">
            {(
              steps ??
              Object.entries(STEP_COPY).map(([id, c]) => ({ id, ...c, status: "todo" as const }))
            ).map((s) => (
              <li key={s.id} className={s.status}>
                {s.label}
                {s.sub && <span className="step-sub">{s.sub}</span>}
              </li>
            ))}
          </ul>
          <button className="primary" onClick={provision} disabled={steps !== null || balances === null}>
            {balances === null ? "Reading the ledger…" : "Provision my villager"}
          </button>
        </div>
      )}

      {/* No profile means the intro owns the page — the tabs and every panel
          below them must not render behind it. */}
      {profile && wallet && provisioned && balances && (
        <div className="app-shell">
        <Satchel serverSpend={serverSpend} round={round} alive={meAlive} />
        <div className="app-main">
          <div className="tabs">
            <button
              className={tab === "town" ? "active" : ""}
              aria-current={tab === "town" ? "page" : undefined}
              onClick={() => setTab("town")}
            >
              Town Square
            </button>
            <button
              className={tab === "village" ? "active" : ""}
              aria-current={tab === "village" ? "page" : undefined}
              onClick={() => setTab("village")}
            >
              The Shops
            </button>
            <button
              className={tab === "maude" ? "active" : ""}
              aria-current={tab === "maude" ? "page" : undefined}
              onClick={() => setTab("maude")}
            >
              Maude
            </button>
            <button
              className={tab === "chatvote" ? "active" : ""}
              aria-current={tab === "chatvote" ? "page" : undefined}
              onClick={() => setTab("chatvote")}
            >
              Chat &amp; Vote
            </button>
          </div>
          {/* All tabs stay mounted (hidden with CSS) so half-typed chat
              lines, questions, and pasted bundles survive tab switches. */}
          <div style={{ display: tab === "village" ? "block" : "none" }}>
            <Village
              wallet={wallet}
              balances={balances}
              visitedShops={visitedShops}
              round={round}
              onPhase={onPhase}
              setBusy={setBusy}
              setError={setError}
              refresh={() => refresh(wallet)}
              onGoMaude={() => goTab("maude")}
              serverSpend={serverSpend}
              refreshServerSpend={() =>
                void playerApi.myPurchases(wallet, gameId).then(setServerSpend).catch(() => undefined)
              }
              active={tab === "village"}
            />
          </div>
          <div style={{ display: tab === "maude" ? "block" : "none" }}>
            <Maude wallet={wallet} gameId={gameId} setError={setError} onGoChatVote={() => goTab("chatvote")} active={tab === "maude"} />
          </div>
          <div style={{ display: tab === "town" ? "block" : "none" }}>
            <Town
              wallet={wallet}
              gameId={gameId}
              onPhase={onPhase}
              setBusy={setBusy}
              setError={setError}
              refresh={() => refresh(wallet)}
              onGoShops={() => goTab("village")}
              onGoMaude={() => goTab("maude")}
              onPlayEnding={() => {
                if (endingFilm.current) setFilm({ ...endingFilm.current, started: false });
              }}
            />
          </div>
          <div style={{ display: tab === "chatvote" ? "block" : "none" }}>
            <ChatVote
              wallet={wallet}
              gameId={gameId}
              setError={setError}
              onGoShops={() => goTab("village")}
              serverSpend={serverSpend}
            />
          </div>
        </div>
        {/* Bri's favorite teaching surface, promoted: the six steps ride
            beside every page on wide screens. Narrow screens keep it in
            My Ledger instead — same component, never shown twice. */}
        <aside className="six-aside">
          <div className="panel">
            <SixSteps
              tills={tills}
              balances={balances}
              purchases={loadHistory(wallet.address, gameId).length}
              owedStroops={
                meAlive
                  ? treasuryOwed(
                      wallet.address,
                      gameId,
                      round,
                      balances.spendable,
                      serverSpend ? BigInt(serverSpend.spentStroops) : null,
                    )
                  : 0n
              }
            />
          </div>
        </aside>
        </div>
      )}

      {busy && (
        <div className="overlay" role="status">
          <div className="moon" />
          <p>{busy}</p>
          {/* A dismissed Freighter popup never settles its promise, so the
              finally that clears this can never run — the player needs a
              door (issue #13). The transaction may still land. */}
          <button className="link overlay-escape" onClick={() => setBusy(null)}>
            Hide this — the transaction may still be running
          </button>
        </div>
      )}
    </div>
  );
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
