import { useEffect, useRef, useState } from "react";

import type { VillagerWallet } from "../lib/wallet";
import { fetchGraph, fetchPublicView, playerApi, type GraphView, type PublicView } from "../lib/player";

/**
 * Maude McLedger's parlor. One private question per villager per day; her
 * answer goes to the asker alone (the GM's console keeps a record — no other
 * villager ever sees it). The seal opens only once YOU have declared done and
 * the whole market has closed, which is exactly what ask() enforces.
 */

/** `[player]` is a template slot, filled from the selector — never displayed. */
const QUESTION_GROUPS: { label: string; questions: string[] }[] = [
  {
    label: "Purchases",
    questions: [
      "What did [player] buy at the Butcher's today?",
      "Did anyone buy the tooth sharpener? Asking for no particular reason.",
      "Has anyone bought the barrel of beer today?",
    ],
  },
  {
    label: "Spending",
    questions: [
      "How much did [player] spend in total today?",
      "Did [player] spend at least 20 XLM at the Blacksmith today?",
      "Whose purchase was the biggest today?",
      "Has [player] been suspiciously frugal today?",
    ],
  },
  {
    label: "Suspicion",
    questions: [
      "Did [player] visit both the Chapel and the Butcher's today?",
      "Maude, professionally speaking: is my own ledger embarrassing?",
    ],
  },
];

interface Props {
  wallet: VillagerWallet;
  gameId: string;
  setError: (e: string | null) => void;
}

export function Maude({ wallet, gameId, setError }: Props) {
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [answers, setAnswers] = useState<{ round: number; question: string; answer: string }[]>([]);
  const [view, setView] = useState<PublicView | null>(null);
  const [graph, setGraph] = useState<GraphView | null>(null);
  const [target, setTarget] = useState("");
  const boxRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const check = () =>
      fetchPublicView(gameId)
        .then(setView)
        .catch(() => setView(null));
    void check();
    const t = setInterval(check, 5_000);
    // The sightings live here so a player knows what to ask about without
    // clicking around. The graph reads the chain, so it polls slower.
    const pullGraph = () => void fetchGraph(gameId).then(setGraph).catch(() => undefined);
    pullGraph();
    const g = setInterval(pullGraph, 30_000);
    return () => {
      clearInterval(t);
      clearInterval(g);
    };
  }, [gameId]);

  const me = view?.players.find((p) => p.address === wallet.address);
  const round = view?.round ?? 0;
  const spent = me?.askedToday === true;
  const openForMe =
    round >= 1 && me?.alive === true && me.doneToday === true && view?.marketClosed === true;
  const seal: "available" | "spent" | "locked" = spent
    ? "spent"
    : openForMe
      ? "available"
      : "locked";
  const sealLabel =
    seal === "available"
      ? "Today's question: available"
      : seal === "spent"
        ? "Today's question: asked"
        : "Today's question: unavailable";

  const needsPlayer = (q: string) => q.includes("[player]");
  const fill = (q: string) => (target ? q.replace("[player]", target) : q);

  const ask = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await playerApi.ask(wallet, gameId, question.trim());
      setAnswers((a) => [{ round: r.round, question: question.trim(), answer: r.answer }, ...a]);
      setQuestion("");
      void fetchPublicView(gameId).then(setView).catch(() => undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
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
          <p className="maude-tagline">Fortune teller. Ledger reader. Terrible confidante.</p>
          <p className="dim">
            One question per villager per day, and no other villager sees her answer.
          </p>
          <div className={`seal seal-${seal}`}>{sealLabel}</div>
        </div>
      </div>

      {/* What the seal state actually means, in her voice and then plainly. */}
      <div className="panel state-card">
        {seal === "locked" && me?.doneToday !== true && round >= 1 && (
          <p className="maude-quote">
            “Finish your errands first, dear — I don't read ledgers that are still being
            written.”
          </p>
        )}
        {seal === "locked" && me?.doneToday === true && view?.marketClosed === false && (
          <p className="maude-quote">“One moment, dear — the market is still open.”</p>
        )}
        <div className="state-head">
          {seal === "available"
            ? "Maude is listening"
            : seal === "spent"
              ? "Maude has answered for today"
              : "Maude is unavailable"}
        </div>
        <p className="state-note">
          {seal === "available" ? (
            "You have one question remaining today."
          ) : seal === "spent" ? (
            "You get a new question when the next day begins."
          ) : round < 1 ? (
            "Her office opens once the first day begins."
          ) : me?.alive === false ? (
            "The dead ask no questions."
          ) : me?.doneToday !== true ? (
            <>
              Declare yourself done in <b>The Shops</b> to unlock your question.
            </>
          ) : (
            <>
              The market closes for everyone at once.
              {(view?.stillShopping ?? []).length > 0 && (
                <> Still shopping: {(view?.stillShopping ?? []).join(", ")}.</>
              )}
            </>
          )}
        </p>
      </div>

      {round >= 1 && (
        <div className="panel">
          <h3 className="composer-head">Seen at the stores today</h3>
          {graph && graph.edges.filter((e) => e.round === round).length > 0 ? (
            <>
              <div className="sightings">
                {graph.edges
                  .filter((e) => e.round === round)
                  .map((e, i) => (
                    <span key={i} className="sighting">
                      {e.from} <span className="dim">→</span> {e.to}
                    </span>
                  ))}
              </div>
              <p className="dim">
                Who went where is public. What they bought is not — that part is what Maude
                is for.
              </p>
            </>
          ) : (
            <p className="dim">Nobody has been seen at a store yet today.</p>
          )}
        </div>
      )}

      <div className="panel">
        <div className="ask-about">
          <label htmlFor="maude-target">Ask about</label>
          <select
            id="maude-target"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          >
            <option value="">Choose a villager</option>
            {(view?.players ?? []).map((p) => (
              <option key={p.seat} value={p.name}>
                {p.name}
                {p.address === wallet.address ? " (you)" : ""}
                {p.alive ? "" : " 🪦"}
              </option>
            ))}
          </select>
        </div>

        <h3 className="composer-head">Choose a question, or write your own</h3>
        {QUESTION_GROUPS.map((group) => (
          <div key={group.label} className="q-group">
            <div className="q-group-label">{group.label}</div>
            <div className="q-chips">
              {group.questions.map((q) => {
                const text = fill(q);
                const blocked = needsPlayer(q) && !target;
                const selected = !blocked && question === text;
                return (
                  <button
                    key={q}
                    className={`chip${selected ? " selected" : ""}`}
                    disabled={blocked}
                    aria-pressed={selected}
                    title={blocked ? "Choose a villager first" : undefined}
                    onClick={() => {
                      setQuestion(text);
                      boxRef.current?.focus();
                    }}
                  >
                    {blocked ? q.replace("[player]", "…") : text}
                    {selected && <span className="chip-tick"> ✓</span>}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        {QUESTION_GROUPS.some((g) => g.questions.some(needsPlayer)) && !target && (
          <p className="dim">Some questions need a name — choose a villager above.</p>
        )}

        <label className="composer-label" htmlFor="maude-question">
          Your question for Maude
        </label>
        <textarea
          id="maude-question"
          ref={boxRef}
          placeholder="Ask about the ledger — purchases, amounts, shops, days."
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
        />
        <p className="dim">No other villager sees Maude's answer.</p>
        <div className="row">
          <button
            className="primary"
            onClick={() => void ask()}
            disabled={
              busy || question.trim() === "" || question.includes("[player]") || seal !== "available"
            }
          >
            {busy ? "Maude is consulting the register…" : "Ask Maude"}
          </button>
          {question.includes("[player]") && (
            <span className="dim">Pick a villager above, or type a name yourself.</span>
          )}
        </div>
      </div>

      <div className="panel answer-area">
        {answers.length === 0 ? (
          <p className="quiet-crystal">The crystal is quiet.</p>
        ) : (
          answers.map((a, i) => (
            <div key={i} className="maude-answer">
              <div className="role-label">
                Maude's answer · day {a.round}
              </div>
              <p className="asked-what">You asked: “{a.question}”</p>
              <div className="answer-card">“{a.answer}”</div>
              {/* Why she could answer at all: the auditor key is a real feature
                  of the token, not a story device. */}
              <p className="answer-source">
                Read with the Auditor's key — the one key that can open every sealed amount.
              </p>
              {/* Only after the newest answer: what to do with it. */}
              {i === 0 && (
                <p className="whats-next">
                  Now that you've gotten your insight, navigate back to the{" "}
                  <b>Town Square</b> to discuss your findings with your fellow villagers, then
                  pick someone to accuse.
                </p>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
