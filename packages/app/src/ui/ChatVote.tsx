import { useCallback, useEffect, useRef, useState } from "react";

import type { VillagerWallet } from "../lib/wallet";
import { loadHistory } from "../lib/history";
import { SHOPS, xlmDisplay } from "../lib/catalog";
import {
  fetchPublicView,
  pageHidden,
  hasCachedAuth,
  playerApi,
  type PublicView,
  type ServerPurchases,
} from "../lib/player";
import { BearIcon, ToteIcon } from "./CharIcon";

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
  /** Jump to the Shops — the crier's "Start new day" button. */
  onGoShops: () => void;
  /** Server-decrypted own purchases; fills the kit on a fresh device. */
  serverSpend: ServerPurchases | null;
}

type Role = "villager" | "werebear";

/** Catalog effect text by item label — the kit list explains what you hold. */
const EFFECT_BY_LABEL = new Map(
  SHOPS.flatMap((sh) => sh.items).map((it) => [it.label, it.effect]),
);
const effectOf = (label: string) => EFFECT_BY_LABEL.get(label);

export function ChatVote({ wallet, gameId, setError, onGoShops, serverSpend }: Props) {
  const [view, setView] = useState<PublicView | null>(null);
  const viewRef = useRef<PublicView | null>(null);
  viewRef.current = view;
  const [role, setRole] = useState<Role | null>(null);
  const [voteTarget, setVoteTarget] = useState("");
  const [voted, setVoted] = useState<string | null>(null);
  const [pickTarget, setPickTarget] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [chatText, setChatText] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  /** Vote/pick in flight — the LAST vote of a day runs the entire dawn. */
  const [acting, setActing] = useState(false);
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
    const t = setInterval(() => {
      if (pageHidden() || viewRef.current?.winner) return;
      void loadView();
    }, 4_000);
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
    ? [
        ...loadHistory(wallet.address, gameId).filter((r) => r.round === round),
        // The server's record fills a fresh device's empty kit (issue #16);
        // dedupe by txHash against the local rows.
        ...(serverSpend?.purchases ?? [])
          .filter(
            (r) =>
              r.round === round &&
              r.item !== null &&
              !loadHistory(wallet.address, gameId).some((l) => l.txHash === r.txHash),
          )
          .map((r) => ({
            round: r.round,
            shopId: r.shopId ?? "",
            shopLabel: r.shopLabel,
            item: r.item!,
            amountStroops: r.amountStroops,
            txHash: r.txHash,
            at: "",
            gameId,
          })),
      ]
    : [];
  /** Where each aimed item was pointed (written by the Shops' aim flow),
   *  keyed by item id — shown beside the kit. */
  const myAims: Record<string, string> = (() => {
    try {
      return JSON.parse(
        localStorage.getItem(`gerald:aims:${gameId}:${round}`) ?? "{}",
      ) as Record<string, string>;
    } catch {
      return {};
    }
  })();
  const AIM_ID_BY_LABEL = new Map(SHOPS.flatMap((sh) => sh.items).map((it) => [it.label, it.id]));
  /** The candle's instant answer, if this round produced one. */
  const candleNote = privateNotes.find(
    (n) => n.round === round && n.text.includes("candle"),
  )?.text;
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
    // Fetch from day 1: the long candle answers on the spot and files its note
    // under TODAY, so gating the fetch on round >= 2 lost a 42 XLM answer the
    // moment its modal was dismissed. Only the pop-up is a dawn thing.
    if (!(me && round && hasCachedAuth(wallet, gameId))) return;
    playerApi
      .notes(wallet, gameId)
      .then((r) => {
        setPrivateNotes(r.notes);
        if (round < 2) return; // day 1 has no overnight results to announce
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
    setActing(true);
    try {
      const r = await playerApi.vote(wallet, gameId, voteTarget);
      setVoted(r.voted);
      setVoteTarget("");
      await loadView();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setActing(false);
    }
  };

  const castPick = async () => {
    setError(null);
    setActing(true);
    try {
      const r = await playerApi.nightPick(wallet, gameId, pickTarget);
      setPicked(r.picked);
      setPickTarget("");
      await loadView();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setActing(false);
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

  const lastMorning = view.mornings.length > 0 ? view.mornings[view.mornings.length - 1] : null;
  /** Dawn has resolved but the next day hasn't opened (the ~60s roll): the
   *  newest morning still belongs to the CURRENT round. */
  const dayResetting = lastMorning !== null && lastMorning.round === view.round;

  const fateOf = (name: string): string | null => {
    const b = view.mornings.find((m) => m.banished === name);
    if (b) return `⚖ banished day ${b.round}`;
    const e = view.mornings.find((m) => m.eaten === name);
    if (e) return `🍽 eaten day ${e.round}`;
    return null;
  };

  return (
    <div>
      {/* Who's who, at a glance, where the arguing happens (Bri's note). */}
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
              <button
                disabled={!chatText.trim() || chatBusy || dayResetting}
                onClick={() => void sendChat()}
              >
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
                  {effectOf(r.item) && <span className="kit-effect">{effectOf(r.item)}</span>}
                  {(() => {
                    const id = AIM_ID_BY_LABEL.get(r.item);
                    const at = id ? myAims[id] : undefined;
                    if (!at) return null;
                    return (
                      <span className="kit-aim">
                        🎯 Aimed at {at}
                        {r.item === "The long candle" && candleNote ? ` — ${candleNote}` : ""}
                      </span>
                    );
                  })()}
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
              disabled={acting || !voteTarget || !view.marketClosed || me?.drunkToday || dayResetting}
              onClick={() => void castVote()}
            >
              {acting
                ? "Casting… (the last vote of the day brings the dawn)"
                : me?.drunkToday
                  ? "🍺 Dead drunk — no vote today"
                  : dayResetting
                    ? "Dawn has broken"
                    : "Cast vote"}
            </button>
          </div>
        </div>
      )}

      {role === "werebear" && me?.alive && view.phase === "day" && !view.winner && (
        <div className="panel">
          <h2>
            <BearIcon /> The hunt (only you can see this)
          </h2>
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
            <button
              className="primary"
              disabled={acting || !pickTarget || dayResetting}
              onClick={() => void castPick()}
            >
              {acting ? "Marking…" : dayResetting ? "The night is over" : "Mark for the night"}
            </button>
          </div>
        </div>
      )}

      {/* The freshest results, HERE — this is the tab everyone is on when
          dawn breaks, so the outcome must not hide in the Town Square. */}
      {lastMorning && (
        <div className="panel">
          <h2>📯 The Town Crier — morning of day {lastMorning.round + 1}</h2>
          {lastMorning.banished && (
            <p>
              The village banished <b>{lastMorning.banished}</b> —{" "}
              {lastMorning.banishedRole === "werebear" ? (
                <>
                  <BearIcon /> THE WEREBEAR!
                </>
              ) : (
                "a villager. Oops."
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
          {lastMorning.winner && <p className="tagline">The {lastMorning.winner} has won.</p>}
          {/* The results are read; the next day is shopping. One click. */}
          {!view.winner &&
            me?.alive &&
            (dayResetting ||
              (lastMorning.round + 1 === view.round &&
                !view.marketClosed &&
                me?.doneToday !== true)) && (
              <div className="row">
                <button className="primary" disabled={dayResetting} onClick={onGoShops}>
                  {dayResetting ? "Waiting for the day to reset…" : "Start new day →"}
                </button>
              </div>
            )}
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
