/**
 * Local purchase history — the player's OWN record of what they bought
 * (the chain hides amounts, so this is the only per-item memory the UI has).
 * Written at purchase time; read by My Ledger and the disclosure flow.
 * Testnet game stakes only; losing it loses nothing but UI labels.
 */
import { DEPLOYMENT } from "./deployment";

export interface PurchaseRecord {
  at: string;
  /** Which game this purchase belonged to — a new game starts a clean ledger. */
  gameId?: string;
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
