import { useCallback, useEffect, useState } from "react";

import type { VillagerWallet, TxPhase } from "../lib/wallet";
import { playerApi, fetchPublicView, type PublicView } from "../lib/player";
import { DAILY_INCOME_XLM, stroopsFromXlm } from "../lib/catalog";

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

const incomeKey = (address: string, gameId: string) => `gerald:income:${gameId}:${address}`;

export function Town({ wallet, gameId, onPhase, setBusy, setError, refresh }: Props) {
  void onPhase;
  const [view, setView] = useState<PublicView | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [roleShown, setRoleShown] = useState(false);
  const [voteTarget, setVoteTarget] = useState("");
  const [voted, setVoted] = useState<string | null>(null);
  const [pickTarget, setPickTarget] = useState("");
  const [picked, setPicked] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setView(await fetchPublicView(gameId));
    } catch {
      setView(null); // game may not exist yet — quiet
    }
  }, [gameId]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 20_000);
    return () => clearInterval(t);
  }, [load]);

  const me = view?.players.find((p) => p.address === wallet.address);
  const living = (view?.players ?? []).filter((p) => p.alive && p.address !== wallet.address);
  const lastIncomeRound = Number(localStorage.getItem(incomeKey(wallet.address, gameId)) ?? "1");
  const incomeDue = view !== null && view.round >= 2 && lastIncomeRound < view.round && me?.alive;

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

  const collectIncome = async () => {
    if (!view) return;
    setBusy(`Collecting today's ${DAILY_INCOME_XLM} XLM…`);
    setError(null);
    try {
      await wallet.deposit(stroopsFromXlm(DAILY_INCOME_XLM));
      await wallet.merge();
      localStorage.setItem(incomeKey(wallet.address, gameId), String(view.round));
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const castVote = async () => {
    setError(null);
    try {
      const r = await playerApi.vote(wallet, gameId, voteTarget);
      setVoted(r.voted);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const castPick = async () => {
    setError(null);
    try {
      const r = await playerApi.nightPick(wallet, gameId, pickTarget);
      setPicked(r.picked);
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

  return (
    <div>
      <div className="panel">
        <h2>
          Day {view.round}
          {view.winner && ` — THE ${view.winner.toUpperCase()} HAS WON`}
        </h2>
        <p className="dim">
          {view.players.filter((p) => p.alive).length}/{view.players.length} alive
          {me ? (me.alive ? "" : " · you are among the departed") : " · you are not seated in this game"}
        </p>

        {me && view.dealt && !roleShown && (
          <button className="primary" onClick={() => void fetchRole()}>
            Receive your fate (private)
          </button>
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
      </div>

      {incomeDue && (
        <div className="panel">
          <h2>The morning post</h2>
          <p className="dim">
            Day {view.round}'s allowance has arrived: {DAILY_INCOME_XLM} XLM. Deposits are
            public — the whole village can verify nobody takes more.
          </p>
          <button className="primary" onClick={() => void collectIncome()}>
            Collect {DAILY_INCOME_XLM} XLM income
          </button>
        </div>
      )}

      {me?.alive && view.phase === "day" && !view.winner && (
        <div className="panel">
          <h2>The trial</h2>
          <p className="dim">
            Who is the werebear? You may change your vote until the day is resolved.
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
            <button className="primary" disabled={!voteTarget} onClick={() => void castVote()}>
              Cast vote
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
          {m.violations.map((v, i) => (
            <p key={i} className="dim">
              ⚖ {v}
            </p>
          ))}
          {m.winner && <p className="tagline">The {m.winner} has won.</p>}
        </div>
      ))}
    </div>
  );
}
