import { useCallback, useEffect, useRef, useState } from "react";

import { VillagerWallet, type VillagerBalances, type TxPhase } from "../lib/wallet";
import { DEPLOYMENT } from "../lib/deployment";
import { STARTING_BUDGET_XLM, stroopsFromXlm } from "../lib/catalog";
import { loadProfile, clearProfile, characterOf, type Profile } from "../lib/profile";
import { fetchGraph, fetchPublicView, loadGameId, saveGameId } from "../lib/player";
import { CharEmoji } from "./CharIcon";
import { Intro } from "./Intro";
import { GeraldStory } from "./Story";
import { Village } from "./Village";
import { Maude } from "./Maude";
import { Town } from "./Town";
import { Ledger } from "./Ledger";

const PHASE_LABEL: Record<TxPhase, string> = {
  proving: "Sealing with a zero-knowledge proof… real cryptography is running in your browser.",
  submitting: "Submitting to the ledger…",
};

type Step = { id: string; label: string; status: "todo" | "doing" | "done" };

export function PlayerApp() {
  const [profile, setProfile] = useState<Profile | null>(loadProfile);
  const [wallet, setWallet] = useState<VillagerWallet | null>(null);
  const [balances, setBalances] = useState<VillagerBalances | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"village" | "maude" | "town" | "ledger">("town");
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [gameId, setGameId] = useState(loadGameId);
  const [visitedShops, setVisitedShops] = useState<string[]>([]);
  const [round, setRound] = useState(0);
  const [storyOpen, setStoryOpen] = useState(false);
  const refreshing = useRef(false);

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

  /** fund → register → deposit budget → merge, skipping what's already done. */
  const provision = async () => {
    if (!wallet || !balances) return;
    setError(null);
    const plan: Step[] = [
      { id: "fund", label: "Fund your public account (testnet faucet)", status: "todo" },
      ...(balances.registered
        ? []
        : [
            {
              id: "register",
              label: "Register your keys with the confidential token contract (ZK proof)",
              status: "todo" as const,
            },
          ]),
      ...(balances.spendable + balances.receiving > 0n
        ? []
        : [
            {
              id: "deposit",
              label: `Buy in: ${STARTING_BUDGET_XLM} XLM → hidden budget`,
              status: "todo" as const,
            },
          ]),
      { id: "merge", label: "Collect your budget into spendable", status: "todo" },
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
    const t = setInterval(() => void refresh(wallet), 30_000);
    return () => clearInterval(t);
  }, [wallet, refresh]);

  // Day awareness: the public view is a cheap in-memory read, so poll it
  // fast — a new day should flip the whole app (shops unlock, allowance
  // grows, Done resets) without anyone touching F5.
  useEffect(() => {
    if (!wallet) return;
    const t = setInterval(async () => {
      try {
        const v = await fetchPublicView(gameId);
        setRound((r) => (v.round !== r ? v.round : r));
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
    setProfile(null);
    setWallet(null);
    setBalances(null);
    setSteps(null);
    setTab("village");
  };

  return (
    <div>
      <div className="topbar">
        {profile && (
          <button className="addr" title="Change name / villager" onClick={() => setProfile(null)}>
            <CharEmoji c={characterOf(profile)} /> {profile.name} {characterOf(profile)?.title}
          </button>
        )}
        {wallet && (
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
        <span className="dim">game:</span>
        <input
          type="text"
          value={gameId}
          onChange={(e) => {
            setGameId(e.target.value);
            saveGameId(e.target.value);
          }}
          style={{ width: "110px", padding: "4px 6px", fontSize: "0.85rem" }}
        />
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
        <span className="spacer" />
        {/* Rules and Log out travel together so Log out can't wrap off the
            banner on its own. Available from the moment there's an identity to
            shed — the picker and connect screens are where people start over. */}
        <div className="topbar-actions">
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

      {storyOpen && (
        <div className="panel story">
          <GeraldStory />
          <div className="row">
            <button onClick={() => setStoryOpen(false)}>Close the case file</button>
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
        <div className="error">
          {error} <button onClick={() => setError(null)}>dismiss</button>
        </div>
      )}

      {!profile && <Intro onDone={setProfile} address={wallet?.address} />}

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
          <h2>Take your seat</h2>
          <p className="dim mono">{wallet.address}</p>
          <p>
            Before the moon rises: fund your account, register your keys with the confidential
            token contract, and buy in your budget of {STARTING_BUDGET_XLM} XLM. From then on,
            every purchase you make is visible only as <i>who paid whom</i> — never how much.
          </p>
          {steps && (
            <ul className="steps">
              {steps.map((s) => (
                <li key={s.id} className={s.status}>
                  {s.label}
                </li>
              ))}
            </ul>
          )}
          <button className="primary" onClick={provision} disabled={steps !== null || balances === null}>
            {balances === null ? "Reading the ledger…" : "Provision my villager"}
          </button>
        </div>
      )}

      {/* No profile means the intro owns the page — the tabs and every panel
          below them must not render behind it. */}
      {profile && wallet && provisioned && balances && (
        <>
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
              className={tab === "ledger" ? "active" : ""}
              aria-current={tab === "ledger" ? "page" : undefined}
              onClick={() => setTab("ledger")}
            >
              My Ledger
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
            />
          </div>
          <div style={{ display: tab === "maude" ? "block" : "none" }}>
            <Maude wallet={wallet} gameId={gameId} setError={setError} />
          </div>
          <div style={{ display: tab === "town" ? "block" : "none" }}>
            <Town
              wallet={wallet}
              gameId={gameId}
              onPhase={onPhase}
              setBusy={setBusy}
              setError={setError}
              refresh={() => refresh(wallet)}
            />
          </div>
          <div style={{ display: tab === "ledger" ? "block" : "none" }}>
            <Ledger
              wallet={wallet}
              gameId={gameId}
              active={tab === "ledger"}
              onGoShops={() => setTab("village")}
            />
          </div>
        </>
      )}

      {busy && (
        <div className="overlay">
          <div className="moon" />
          <p>{busy}</p>
        </div>
      )}
    </div>
  );
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
