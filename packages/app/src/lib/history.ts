/**
 * Local purchase history — the player's OWN record of what they bought
 * (the chain hides amounts, so this is the only per-item memory the UI has).
 * Written at purchase time; read by My Ledger and the disclosure flow.
 * Testnet game stakes only; losing it loses nothing but UI labels.
 */
import { DEPLOYMENT } from "./deployment";
import { DAILY_INCOME_XLM, STARTING_BUDGET_XLM, stroopsFromXlm } from "./catalog";

export interface PurchaseRecord {
  at: string;
  /** Which game this purchase belonged to — a new game starts a clean ledger. */
  gameId?: string;
  /** Which game day — drives the two-stores-a-day cap without chain lag. */
  round?: number;
  shopId: string;
  shopLabel: string;
  /** Item label from the catalog. */
  item: string;
  amountStroops: string; // bigint as string for JSON
  txHash: string;
}

const key = (address: string) => `gerald:history:${DEPLOYMENT.token}:${address}`;

function loadAll(address: string): PurchaseRecord[] {
  try {
    return JSON.parse(localStorage.getItem(key(address)) ?? "[]") as PurchaseRecord[];
  } catch {
    return [];
  }
}

/** This game's records only — legacy entries without a gameId stay hidden. */
export function loadHistory(address: string, gameId: string): PurchaseRecord[] {
  return loadAll(address).filter((r) => r.gameId === gameId);
}

export function recordPurchase(address: string, rec: PurchaseRecord): void {
  const all = loadAll(address); // append to the FULL store, across games
  all.push(rec);
  localStorage.setItem(key(address), JSON.stringify(all));
}

/**
 * What the Town Treasury "owes" this wallet right now: the allowance the
 * schedule permits by the given day, minus what this browser has spent this
 * game, minus what's already in the purse. Positive = a deposit+merge cycle
 * is waiting at the collect desk. Mirrors the Shops' own calculation.
 */
export function treasuryOwed(
  address: string,
  gameId: string,
  round: number,
  spendableStroops: bigint,
  /** The server's decrypted spend total, when known — localStorage lies on a
   *  second device (issue #16). */
  serverSpentStroops?: bigint | null,
): bigint {
  const allowance = stroopsFromXlm(STARTING_BUDGET_XLM + DAILY_INCOME_XLM * Math.max(0, round - 1));
  // BOTH records are lower bounds on the truth: the browser can't see other
  // devices, and the server's mirror can't see the last few seconds. Taking
  // the server alone put a player on a money carousel — every purchase made
  // the Treasury "owe" its price for the seconds before the mirror caught
  // up, then demand it back (Trixy Diamond, game08). Take the max.
  const localSpent = loadHistory(address, gameId).reduce(
    (a, r) => a + BigInt(r.amountStroops),
    0n,
  );
  const spent =
    serverSpentStroops != null && serverSpentStroops > localSpent
      ? serverSpentStroops
      : localSpent;
  const remaining = allowance > spent ? allowance - spent : 0n;
  return remaining > spendableStroops ? remaining - spendableStroops : 0n;
}
