import { useEffect, useState } from "react";

import type { VillagerWallet } from "../lib/wallet";
import { fetchPublicView, playerApi } from "../lib/player";

/**
 * Maude McLedger's parlor. One private question per day — her answer comes
 * to you alone. What you tell the table about it is your business.
 */

const SUGGESTED: string[] = [
  "Did anyone buy the silver charm this game?",
  "How much did [player] spend in total today?",
  "What did [player] buy at the Apothecary today?",
  "Did [player] spend at least 20 XLM at the Blacksmith today?",
  "Whose purchase was the biggest today?",
  "Did [player] visit both the Blacksmith and the Apothecary today?",
  "Did anyone buy fresh venison? Asking for no particular reason.",
  "Has [player] been suspiciously frugal today?",
  "What's the most anyone has ever paid at the Liquor Store?",
  "Maude, professionally speaking: is my own ledger embarrassing?",
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
  const [doneToday, setDoneToday] = useState<boolean | null>(null);

  useEffect(() => {
    const check = () =>
      fetchPublicView(gameId)
        .then((v) => {
          const me = v.players.find((p) => p.address === wallet.address);
          setDoneToday(me ? me.doneToday === true : null);
        })
        .catch(() => setDoneToday(null));
    void check();
    const t = setInterval(check, 8_000);
    return () => clearInterval(t);
  }, [gameId, wallet.address]);

  const ask = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await playerApi.ask(wallet, gameId, question.trim());
      setAnswers((a) => [{ round: r.round, question: question.trim(), answer: r.answer }, ...a]);
      setQuestion("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="panel">
        <h2>Maude McLedger — the fortune teller</h2>
        <p className="dim">
          She reads ledgers the way other women read palms. One question per villager per day;
          her answer comes to <b>you alone</b>. Whether you tell the truth about it afterward is
          between you and St. Ursula.
        </p>
        {doneToday === false && (
          <div className="answer-card">
            “Finish your errands first, dear — I don't read ledgers that are still being
            written.” <span className="dim">(Declare Done in the Shops to unlock your question.)</span>
          </div>
        )}
        <p className="dim">Ideas (tap to use — replace [player] with a name):</p>
        <div className="row" style={{ flexWrap: "wrap" }}>
          {SUGGESTED.map((q) => (
            <button key={q} onClick={() => setQuestion(q)} style={{ fontSize: "0.8rem" }}>
              {q}
            </button>
          ))}
        </div>
        <textarea
          placeholder="Your one question about the ledger…"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
        />
        <div className="row">
          <button
            className="primary"
            onClick={() => void ask()}
            disabled={busy || question.trim() === "" || question.includes("[player]") || doneToday === false}
          >
            {busy ? "Maude is consulting the register…" : "Spend today's seal"}
          </button>
          {question.includes("[player]") && (
            <span className="dim">replace [player] with a real name first</span>
          )}
        </div>
      </div>

      {answers.map((a, i) => (
        <div key={i} className="panel">
          <p className="dim">
            day {a.round} — you asked: “{a.question}”
          </p>
          <div className="answer-card">“{a.answer}”</div>
          <p className="dim">Private. Only you received this.</p>
        </div>
      ))}
    </div>
  );
}
