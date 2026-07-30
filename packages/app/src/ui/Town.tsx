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
import { loadHistory } from "../lib/history";
import { DAILY_INCOME_XLM, SHOPS } from "../lib/catalog";

const CHAR_BY_ID = new Map(CHARACTERS.map((c) => [c.id, c]));

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

  return (
    <div>
      <div className="panel">
        <h2>
          Day {view.round}
          {view.round >= 1 && view.maxDays ? ` of ${view.maxDays}` : ""}
          {view.winner && ` — THE ${view.winner.toUpperCase()} HAS WON`}
        </h2>
        {view.round >= 1 && view.maxDays && !view.winner && (
          <p className="dim">
            The clock runs for the village: if the werebear survives the dusk of day{" "}
            {view.maxDays}, it wins.
          </p>
        )}
        <p className="dim">
          {view.players.filter((p) => p.alive).length}/{view.players.length} alive
          {me ? (me.alive ? "" : " · you are among the departed") : ""}
        </p>

        {!me && !view.dealt && (
          <div className="answer-card">
            <b>Take a seat in “{gameId}”.</b> Joining asks Freighter for one signature — that's
            you proving your seat to the record-keeper.
            <div className="row">
              <button
                className="primary"
                onClick={() => {
                  const prof = loadProfile();
                  if (!prof) {
                    setError("Pick a name and villager first (📜 → log out if you need to start over).");
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

        {me && !view.dealt && (
          <div className="answer-card">
            <b>The lobby.</b> {view.readyCount ?? 0}/{Math.max(view.minPlayers ?? 3, view.players.length)}{" "}
            ready — the game starts itself the moment everyone seated is ready (minimum{" "}
            {view.minPlayers ?? 3}).
            <div className="row">
              <button
                className={me.ready ? "" : "primary"}
                onClick={() => {
                  playerApi
                    .ready(wallet, gameId, !me.ready)
                    .then(() => void load())
                    .catch((e) => setError(e instanceof Error ? e.message : String(e)));
                }}
              >
                {me.ready ? "✓ Ready (tap to unready)" : "Ready?"}
              </button>
            </div>
          </div>
        )}

        {me && view.dealt && !roleShown && (
          <div className="answer-card">
            <b>📜 Your fate has been dealt.</b>{" "}
            {role
              ? "It waits, sealed. Open it when nobody is looking over your shoulder."
              : "Receiving it will ask Freighter for one signature — that's you proving your seat."}
            <div className="row">
              <button className="primary" onClick={() => (role ? setRoleShown(true) : void fetchRole())}>
                {role ? "Break the seal (private)" : "Receive your fate (private)"}
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
      </div>

      <div className="panel">
        <h2>The village</h2>
        <div className="characters">
          {view.players.map((p) => {
            const c = p.character ? CHAR_BY_ID.get(p.character) : null;
            return (
              <div key={p.seat} className={`character ${p.alive ? "" : "dead"}`}>
                <span className="emoji">{p.alive ? (c?.emoji ?? "🧑‍🌾") : "🪦"}</span>
                <span>
                  {p.name} {c ? c.title : ""}
                  {p.address === wallet.address ? " (you)" : ""}
                  {!view.dealt && p.ready ? " ✅" : ""}
                  {view.dealt && p.alive && p.doneToday ? " 🛍✓" : ""}
                  {view.dealt && p.alive && p.askedToday ? " 🔮" : ""}
                  {view.dealt && p.alive && p.recovering ? " 🤕" : ""}
                </span>
                <span className="dim blurb">{p.alive ? (c?.blurb ?? "New in town.") : "Eaten or banished. Gerald has company."}</span>
              </div>
            );
          })}
        </div>
        <p className="dim">One of these fine people is the werebear. Possibly you.</p>
        {view.round >= 1 && !view.winner && (
          <p className="dim">
            {view.marketClosed
              ? "🔮 The market has closed — Maude's office is open for questions."
              : `🛍 The market is open. Maude waits for: ${(view.stillShopping ?? []).join(", ") || "—"}.`}
          </p>
        )}
      </div>

      <div className="panel">
        <h2>What the village sees</h2>
        <p className="dim">
          The rules of the ledger: everyone can see <b>who paid which store and when</b>, plus
          everyone's <b>income deposits</b> (that's how you know nobody smuggled extra budget).
          Nobody — except Maude — can see <b>how much</b> a purchase was, and since the price is
          the item, that means nobody can see <b>what you bought</b>. Two shops a day is the
          custom; item powers are public knowledge (hover them in the Shops tab).
        </p>
        {graph && (
          <p>
            {graph.edges.filter((e) => e.round === view.round).length === 0 ? (
              <span className="dim">No sightings yet today.</span>
            ) : (
              graph.edges
                .filter((e) => e.round === view.round)
                .map((e, i, arr) => (
                  <span key={i}>
                    {e.from} → {e.to}
                    {i < arr.length - 1 ? " · " : ""}
                  </span>
                ))
            )}
          </p>
        )}
        <p className="dim">
          {SHOPS.map((s) => s.label).join(" · ")} — five stores, fifteen wares, every price a
          different item. <b>The shops never run out</b>: any number of players can own the same
          item, so learning what the dead carried proves nothing about the living. Spend your
          budget on gear, or on looking innocent.
        </p>
      </div>

      {me?.alive && view.round >= 2 && view.phase === "day" && !view.winner && (
        <p className="dim">
          📯 Daily allowance ({DAILY_INCOME_XLM} XLM) collects at the Order's desk in{" "}
          <b>The Shops</b> — it appears there whenever you're below the day's allowance.
        </p>
      )}

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

      {me?.alive && view.phase === "day" && !view.winner && (
        <div className="panel">
          <h2>The trial</h2>
          {!view.marketClosed && (
            <p className="dim">
              🛍 The trial begins when the market closes.{" "}
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
    </div>
  );
}
