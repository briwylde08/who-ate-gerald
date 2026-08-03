import type { VillagerBalances } from "../lib/wallet";
import { xlmDisplay } from "../lib/catalog";

/**
 * The six steps of a confidential-token payment, lit up by what this player
 * has ACTUALLY done on chain. Not a diagram: every ✓ here is a real
 * transaction they signed, read back from their own balances and ledger.
 *
 * Two of the six are deliberately marked as not-yours rather than hidden. The
 * receiver's merge happens in the shopkeeper's wallet, and withdrawal never
 * happens at all in this game — saying so teaches more than quietly showing
 * four steps and calling it six.
 */

type State = "done" | "waiting" | "elsewhere" | "unused";

interface Props {
  balances: VillagerBalances;
  /** How many confidential transfers this browser has recorded this game. */
  purchases: number;
}

export function SixSteps({ balances, purchases }: Props) {
  const registered = balances.registered;
  const funded = registered && (balances.spendable + balances.receiving > 0n || purchases > 0);
  const merged = registered && balances.spendable > 0n;
  const waiting = balances.receiving > 0n;

  const steps: {
    n: number;
    name: string;
    what: string;
    state: State;
    note?: string;
  }[] = [
    {
      n: 1,
      name: "Register",
      what: "Bind your keys to the wrapper contract. Once, ever.",
      state: registered ? "done" : "waiting",
      note: registered ? "you did this when you joined" : "not yet",
    },
    {
      n: 2,
      name: "Deposit",
      what: "Public XLM goes into the shared pool and becomes a hidden claim.",
      state: funded ? "done" : "waiting",
      note: funded ? "your buy-in and daily income — public on purpose" : "not yet",
    },
    {
      n: 3,
      name: "Merge",
      what: "Move what arrived in your pending inbox into your spendable purse.",
      state: waiting ? "waiting" : merged ? "done" : "waiting",
      note: waiting
        ? `${xlmDisplay(balances.receiving)} XLM waiting — "Collect into purse" in The Shops`
        : merged
          ? "your purse is collected"
          : "nothing to collect",
    },
    {
      n: 4,
      name: "Transfer",
      what: "Pay a shop without revealing the amount. This is the only step that hides anything.",
      state: purchases > 0 ? "done" : "waiting",
      note:
        purchases > 0
          ? `${purchases} confidential ${purchases === 1 ? "payment" : "payments"} this game`
          : "buy something and this lights up",
    },
    {
      n: 5,
      name: "Merge",
      what: "The receiver moves your payment from their pending into their spendable.",
      state: "elsewhere",
      note: "happens in the shopkeeper's wallet, not yours",
    },
    {
      n: 6,
      name: "Withdraw",
      what: "Turn a hidden claim back into ordinary XLM.",
      state: "unused",
      note: "never happens here — the coin stays in the wrapper all game",
    },
  ];

  const MARK: Record<State, string> = {
    done: "✓",
    waiting: "○",
    elsewhere: "→",
    unused: "—",
  };

  return (
    <div className="six-steps">
      <div className="role-label">The six steps of a confidential payment</div>
      <p className="dim six-intro">
        Every payment in this village takes the same six steps. Yours are ticked as you make
        them — these are real transactions, not a tutorial.
      </p>
      <ol className="step-list">
        {steps.map((s) => (
          <li key={`${s.n}-${s.name}`} className={`step step-${s.state}`}>
            <span className="step-mark" aria-hidden="true">
              {MARK[s.state]}
            </span>
            <span className="step-body">
              <span className="step-name">
                {s.n}. {s.name}
              </span>
              <span className="step-what">{s.what}</span>
              {s.note && <span className="step-note">{s.note}</span>}
            </span>
          </li>
        ))}
      </ol>
      <p className="dim six-foot">
        Steps 2 and 6 are where amounts become public. Everything in between is sealed, which
        is why the village can see that you paid a shop and never what you paid.
      </p>
    </div>
  );
}
