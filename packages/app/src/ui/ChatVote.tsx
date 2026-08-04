import { useCallback, useEffect, useState } from "react";

import type { VillagerWallet } from "../lib/wallet";
import { loadHistory } from "../lib/history";
import { xlmDisplay } from "../lib/catalog";
import {
  fetchPublicView,
  hasCachedAuth,
  playerApi,
  type PublicView,
} from "../lib/player";
import { ToteIcon } from "./CharIcon";

/**
 * Where the day is decided: the chat, the trial, and (for one player only)
 * the hunt. Split out of the Town Square so the tabs read left to right as
 * the day actually flows: see the square → shop → ask Maude → argue and vote.
 *
 * Also home of the dawn-results modal: aimed items (the candle, the bone, the
 * barrel, the offering) resolve overnight and their outcomes are private, so
 * each morning any fresh private notes pop up ONCE, front and center — a
 * player should never have to hunt for what their 42 XLM told them.
 */

interface Props {
  wallet: VillagerWallet;
  gameId: string;
  setError: (e: string | null) => void;
}

type Role = "villager" | "werebear";

export function ChatVote({ wallet, gameId, setError }: Props) {
  const [view, setView] = useState<PublicView | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [voteTarget, setVoteTarget] = useState("");
  const [voted, setVoted] = useState<string | null>(null);
  const [pickTarget, setPickTarget] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [chatText, setChatText] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [discloseTx, setDiscloseTx] = useState("");
  const [privateNotes, setPrivateNotes] = useState<{ round: number; text: string }[]>([]);
  /** Fresh dawn results, shown as a modal once per round per browser. */
  const [dawnNotes, setDawnNotes] = useState<string[] | null>(null);

  const loadView = useCallback(async () => {
    try {
      setView(await fetchPublicView(gameId));
    } catch {
      setView(null);
    }
  }, [gameId]);

  useEffect(() => {
    void loadView();
    const t = setInterval(() => void loadView(), 4_000);
    const onFocus = () => void loadView();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
    };
  }, [loadView]);

  const me = view?.players.find((p) => p.address === wallet.address);
  const round = view?.round;
  /** What this browser bought TODAY — the kit in hand while deciding. */
  const todaysItems = round
    ? loadHistory(wallet.address, gameId).filter((r) => r.round === round)
    : [];
  const living = (view?.players ?? []).filter((p) => p.alive && p.address !== wallet.address);

  // A new day voids yesterday's ballot and pick.
  useEffect(() => {
    setVoted(null);
    setVoteTarget("");
    setPicked(null);
    setPickTarget("");
  }, [round]);

  // The hunt panel needs to know if this player is the bear — fetched quietly
  // when the auth signature is cached, never displayed without this tab.
  useEffect(() => {
    if (view?.dealt && me && role === null && hasCachedAuth(wallet, gameId)) {
      playerApi
        .myRole(wallet, gameId)
        .then((r) => setRole(r.role))
        .catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view?.dealt, me?.address]);

  // Private dawn facts: fetch each day, and pop unseen ones as a modal.
  useEffect(() => {
    if (!(me && round && round >= 2 && hasCachedAuth(wallet, gameId))) return;
    playerApi
      .notes(wallet, gameId)
      .then((r) => {
        setPrivateNotes(r.notes);
        const fresh = r.notes.filter((n) => n.round === round).map((n) => n.text);
        if (fresh.length === 0) return;
        const seenKey = `gerald:dawnnotes:${gameId}:${round}`;
        if (localStorage.getItem(seenKey)) return;
        localStorage.setItem(seenKey, "1");
        setDawnNotes(fresh);
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.address, round]);

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

  const castVote = async () => {
    setError(null);
    try {
      const r = await playerApi.vote(wallet, gameId, voteTarget);
      setVoted(r.voted);
      setVoteTarget("");
      await loadView();
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
      await loadView();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (!view) {
    return (
      <div className="panel">
        <p className="dim">No game found yet — take a seat in the Town Square first.</p>
      </div>
    );
  }

  if (view.round < 1) {
    return (
      <div className="panel">
        <p className="dim">
          The square is empty. Chat and voting open when the game begins.
        </p>
      </div>
    );
  }

  return (
    <div>
      {!view.marketClosed && !view.winner && (
        <div className="panel">
          <p className="dim">
            <ToteIcon /> The square fills when the market closes. Still shopping:{" "}
            {(view.stillShopping ?? []).join(", ") || "—"}.
          </p>
        </div>
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
              <span className="dim">Private to you, and provably true. Share it or sit on it.</span>
            </div>
          )}

          {me?.standsAccused && (
            <div className="answer-card">
              <b>⚖ You stand accused.</b> The vote split on you yesterday — pick one purchase
              and Maude will unseal it for the whole square (she reads the chain, so it cannot
              be a lie). It reveals only that one purchase, nothing else you bought. Your vote
              unlocks after. Refusing is allowed — but until you disclose, your vote stays in
              your pocket, and the village will notice.
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
                      .then(() => void loadView())
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
          <h2>🧺 Your items today</h2>
          {todaysItems.length === 0 ? (
            <p className="dim">You bought nothing today.</p>
          ) : (
            <ul className="kit-list">
              {todaysItems.map((r) => (
                <li key={r.txHash}>
                  <b>{r.item}</b>
                  <span className="dim">
                    {" "}
                    — {xlmDisplay(BigInt(r.amountStroops))} XLM, {r.shopLabel}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="dim kit-note">Only you can see this list.</p>
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
            Who is the werebear? Ask Maude before you vote — <b>
              dawn comes the moment the last vote lands
            </b>, and it doesn't wait for unspent questions.
            {voted && (
              <>
                {" "}
                Current vote: <b>{voted}</b>.
              </>
            )}
          </p>
          {view.marketClosed && (
            <p className="dim">
              {(view.awaitingVotes ?? []).length > 0
                ? `Still to vote: ${(view.awaitingVotes ?? []).join(", ")}.`
                : "Every vote is in."}
              {view.nightDecided === false && " The night has not been decided yet."}
            </p>
          )}
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
              disabled={!voteTarget || !view.marketClosed || me?.standsAccused || me?.drunkToday}
              onClick={() => void castVote()}
            >
              {me?.drunkToday
                ? "🍺 Dead drunk — no vote today"
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

      {view.winner && (
        <div className="panel">
          <p className="dim">The game is over — the reckoning is in the Town Square.</p>
        </div>
      )}

      {/* Dawn results: what your aimed items did overnight, shown once. */}
      {dawnNotes && (
        <div className="film-overlay" role="dialog" aria-label="What the night told you">
          <div className="panel dawn-modal">
            <h2>🌅 The night's results — only you see this</h2>
            {dawnNotes.map((t, i) => (
              <p key={i} className="dawn-note">
                {t}
              </p>
            ))}
            <div className="row">
              <button className="primary" onClick={() => setDawnNotes(null)}>
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
