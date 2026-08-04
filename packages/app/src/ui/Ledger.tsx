import { useEffect, useState } from "react";

import type { VillagerBalances, VillagerWallet } from "../lib/wallet";
import { loadHistory, type PurchaseRecord } from "../lib/history";
import { xlmDisplay } from "../lib/catalog";
import { SixSteps } from "./SixSteps";

interface Props {
  wallet: VillagerWallet;
  gameId: string;
  /** Live balances — the six-step tracker reads real state, never a mock. */
  balances: VillagerBalances;
  /** Tabs stay mounted for draft-survival; reload the list when shown. */
  active: boolean;
  /** Jump to the Shops tab — the empty ledger's way out. */
  onGoShops?: () => void;
}

/**
 * The player's own record of what they bought. The chain keeps the amounts
 * encrypted, so these item names exist nowhere but this browser — which is
 * also why the Town Square's stand-accused picker reads this same list.
 *
 * There is deliberately no proof workshop here. Accusations are answered in
 * the square, where the Order unseals a chosen purchase with the auditor key;
 * the manual GM-request flow this page once carried belonged to the moderated
 * design and only confused players. The capability still exists in the wallet
 * (discloseSent) and the GM dashboard's verifier if a demo ever wants it.
 */
export function Ledger({ wallet, gameId, balances, active, onGoShops }: Props) {
  const [history, setHistory] = useState<PurchaseRecord[]>([]);
  useEffect(() => {
    if (active) setHistory(loadHistory(wallet.address, gameId).slice().reverse());
  }, [active, wallet.address, gameId]);

  const total = history.reduce((sum, h) => sum + BigInt(h.amountStroops), 0n);

  return (
    <div className="ledger-page">
      <div className="panel ledger-panel">
        <h2>My private ledger</h2>
        <div className="privacy-banner">
          <div className="role-label">🔒 Private ledger</div>
          <p>
            The village sees which shops you visited, never what you paid. The amounts are
            encrypted on the chain — only you and the Auditor can read them, and these item
            names live in this browser alone.
          </p>
        </div>

        {history.length === 0 ? (
          <div className="ledger-empty">
            <p className="empty-head">Your ledger is empty</p>
            <p className="dim">You haven't bought anything yet.</p>
            {onGoShops && (
              <button className="primary" onClick={onGoShops}>
                Visit the Shops
              </button>
            )}
            <p className="lobby-flavor">An honest ledger. How suspicious.</p>
          </div>
        ) : (
          <>
            <div className="chain-log-head">
              <div className="role-label">What the chain saw</div>
              <p className="dim">
                One row per purchase, split down the middle: everything the village can see, and
                everything it can't. The left column is public forever. The right column exists
                only here and inside the Auditor's key.
              </p>
            </div>
            <div className="entries chain-log">
              {history.map((h) => (
                <div key={h.txHash} className="chain-row">
                  <div className="chain-head">
                    <span className="entry-where">
                      {h.shopLabel}
                      {h.round ? ` · Day ${h.round}` : ""}
                    </span>
                    <a
                      className="tx-link"
                      href={`https://stellar.expert/explorer/testnet/tx/${h.txHash}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      view on chain ↗
                    </a>
                  </div>
                  <div className="chain-cols">
                    <div className="chain-col chain-public">
                      <div className="role-label">Public</div>
                      <p className="chain-fact">You paid {h.shopLabel}</p>
                      <p className="chain-sealed">amount ●●●●●● sealed</p>
                    </div>
                    <div className="chain-col chain-private">
                      <div className="role-label">🔒 Only you</div>
                      <p className="chain-fact">{h.item}</p>
                      <p className="entry-amount">{xlmDisplay(BigInt(h.amountStroops))} XLM</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <p className="chain-dare dim">
              Don't take our word for it: open any transaction above. You'll find the shop, the
              time, and your signature — and no amount anywhere in it.
            </p>
            <p className="ledger-total">
              <span className="role-label">Spent this game</span>
              <span className="entry-amount">{xlmDisplay(total)} XLM</span>
            </p>
          </>
        )}

        {/* On wide screens the six steps live in the sidebar instead. */}
        <div className="six-inline">
          <SixSteps balances={balances} purchases={history.length} />
        </div>

      </div>
    </div>
  );
}
