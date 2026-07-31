import { useEffect, useState } from "react";

import type { VillagerWallet } from "../lib/wallet";
import { loadHistory, type PurchaseRecord } from "../lib/history";
import { xlmDisplay } from "../lib/catalog";

interface Props {
  wallet: VillagerWallet;
  gameId: string;
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
export function Ledger({ wallet, gameId, active, onGoShops }: Props) {
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
            <div className="entries">
              {history.map((h) => (
                <div key={h.txHash} className="entry">
                  <span className="entry-main">
                    <span className="entry-item">{h.item}</span>
                    <span className="entry-where">
                      {h.shopLabel}
                      {h.round ? ` · Day ${h.round}` : ""}
                    </span>
                  </span>
                  <span className="entry-side">
                    <span className="entry-amount">
                      {xlmDisplay(BigInt(h.amountStroops))} XLM
                    </span>
                    <span className="entry-state">Hidden</span>
                  </span>
                </div>
              ))}
            </div>
            <p className="ledger-total">
              <span className="role-label">Spent this game</span>
              <span className="entry-amount">{xlmDisplay(total)} XLM</span>
            </p>
          </>
        )}

        <details className="privacy-more">
          <summary>How disclosure works</summary>
          <p className="dim">
            If a trial ties and you stand accused, the village expects an answer in the{" "}
            <b>Town Square</b>: you choose one purchase from this list, and Maude unseals that
            single payment for everyone to read. Because she decrypts it from the chain rather
            than taking your word, the reveal cannot be a lie — and it says nothing about
            anything else you bought.
          </p>
          <p className="dim">
            Refusing is allowed. Until you disclose, your vote stays in your pocket, which the
            village will notice. A horseshoe nail excuses you from the whole business once.
          </p>
        </details>
      </div>
    </div>
  );
}
