import { DEPLOYMENT } from "./deployment";

/**
 * A private record of every transaction THIS BROWSER has signed — deposits,
 * collects, purchases, surrenders. One purpose: let a player point at the
 * real chain. Each entry links to stellar.expert, where the shop and the
 * signature are public and the amount conspicuously is not.
 *
 * Keyed by token + address like the purchase history, because it describes
 * the wallet, not one game.
 */

export interface ActivityEntry {
  at: string;
  /** What the transaction was, in the player's own terms. */
  label: string;
  /** Public amounts (deposits) are shown; confidential ones are the item's price —
   *  private to this browser, exactly like the Ledger. */
  detail?: string;
  txHash: string;
}

const key = (address: string) => `gerald:activity:${DEPLOYMENT.token}:${address}`;
const MAX_KEPT = 60;

export function loadActivity(address: string): ActivityEntry[] {
  try {
    return JSON.parse(localStorage.getItem(key(address)) ?? "[]") as ActivityEntry[];
  } catch {
    return [];
  }
}

export function recordActivity(address: string, entry: ActivityEntry): void {
  const all = loadActivity(address);
  all.push(entry);
  localStorage.setItem(key(address), JSON.stringify(all.slice(-MAX_KEPT)));
}

export const explorerTx = (txHash: string) =>
  `https://stellar.expert/explorer/testnet/tx/${txHash}`;
