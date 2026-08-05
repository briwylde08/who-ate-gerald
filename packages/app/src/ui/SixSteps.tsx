import type { VillagerBalances } from "../lib/wallet";
import { xlmDisplay } from "../lib/catalog";

/**
 * The six steps of a confidential-token payment, lit up by what this player
 * has ACTUALLY done on chain. Not a diagram: every ✓ here is a real
 * transaction they signed, read back from their own balances and ledger.
 *
 * Steps 5 and 6 belong to the RECEIVER — shown at full brightness with an
 * arrow, because they're the final steps of every confidential transfer even
 * though this game never shows them happening.
 */

type State = "done" | "waiting" | "elsewhere" | "unused";

interface Props {
  balances: VillagerBalances;
  /** How many confidential transfers this browser has recorded this game. */
  purchases: number;
  /** Stroops waiting at the Town Treasury — reopens the deposit+merge cycle. */
  owedStroops?: bigint;
}

export function SixSteps({ balances, purchases, owedStroops = 0n }: Props) {
  const registered = balances.registered;
  const funded = registered && (balances.spendable + balances.receiving > 0n || purchases > 0);
  const merged = registered && balances.spendable > 0n;
  const waiting = balances.receiving > 0n;
  // Deposit and merge CYCLE: every day's income is a fresh pair. While the
  // Treasury owes you, both steps reopen and point at the collect desk.
  const owed = owedStroops > 0n;

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
      what: "Bind your keys to the confidential token contract. Once ever per contract.",
      state: registered ? "done" : "waiting",
      note: registered ? "you did this when you joined" : "not yet",
    },
    {
      n: 2,
      name: "Deposit",
      what: "XLM from your Freighter wallet goes into the shared pool. You receive confidential claims in return.",
      state: owed ? "waiting" : funded ? "done" : "waiting",
      note: owed
        ? `${xlmDisplay(owedStroops)} XLM waiting at the Town Treasury — collect in The Shops`
        : funded
          ? "your daily income"
          : "not yet",
    },
    {
      n: 3,
      name: "Merge",
      what: "New claims arrive in your pending balance. Merging moves them into the spendable balance only you control.",
      state: owed || waiting ? "waiting" : merged ? "done" : "waiting",
      note: waiting
        ? `${xlmDisplay(balances.receiving)} XLM waiting — "Collect into purse" in The Shops`
        : owed
          ? "collecting will merge it into your spendable balance"
          : merged
            ? "your purse is collected"
            : "nothing to collect",
    },
    {
      n: 4,
      name: "Transfer",
      what: "Pay a shop without revealing the amount by transferring from your spendable balance into their pending balance.",
      state: purchases > 0 ? "done" : "waiting",
      note:
        purchases > 0
          ? `${purchases} confidential ${purchases === 1 ? "payment" : "payments"} this game`
          : "buy something and this lights up",
    },
    {
      n: 5,
      name: "Merge",
      what: "The receiver moves your payment from their pending balance into their spendable balance.",
      state: "elsewhere",
      note: "happens at the receiver",
    },
    {
      n: 6,
      name: "Withdraw",
      what: "The receiver can turn confidential claims back into ordinary XLM.",
      state: "elsewhere",
      note: "happens at the receiver — the final step of a confidential token transfer",
    },
  ];

  const MARK: Record<State, string> = {
    done: "✓",
    waiting: "○",
    // → on both closing steps: actions you won't see in this game, but
    // still the final steps of every confidential token transfer.
    elsewhere: "→",
    unused: "→",
  };

  return (
    <div className="six-steps">
      <div className="role-label">6 steps of a confidential payment</div>
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
        Steps 2 and 6 are where amounts become public. Everything in between is confidential,
        which is why the village can see that you paid a shop and never what you paid.
      </p>
    </div>
  );
}
