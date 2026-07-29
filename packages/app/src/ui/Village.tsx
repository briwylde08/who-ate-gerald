import { useState } from "react";

import type { VillagerWallet, VillagerBalances, TxPhase } from "../lib/wallet";
import { SHOPS, stroopsFromXlm, xlmString, type ShopInfo, type CatalogItem } from "../lib/catalog";
import { recordPurchase } from "../lib/history";
import { loadGameId } from "../lib/player";

interface Props {
  wallet: VillagerWallet;
  balances: VillagerBalances;
  /** Shop labels visited this round (from the public graph) — drives the 2-shop cap. */
  visitedShops: string[];
  onPhase: (p: TxPhase) => void;
  setBusy: (b: string | null) => void;
  setError: (e: string | null) => void;
  refresh: () => Promise<void>;
}

/**
 * The shop floor: five stores, each item a two-click button (arm, then
 * confirm). Every purchase is one confidential transfer — the village sees
 * the visit, never the amount, and the amount IS the item. Item effects are
 * public knowledge (hover); which one YOU bought is not.
 */
export function Village({ wallet, balances, visitedShops, onPhase, setBusy, setError, refresh }: Props) {
  const [armed, setArmed] = useState<string | null>(null);

  const pay = async (shop: ShopInfo, item: CatalogItem, amountStroops: bigint) => {
    setArmed(null);
    setError(null);
    if (visitedShops.length >= 2 && !visitedShops.includes(shop.label)) {
      setError(
        `The village is small, but spread out: two shops a day is the custom. Today you've been to ${visitedShops.join(" and ")}. (Maude audits.)`,
      );
      return;
    }
    if (balances.spendable < amountStroops) {
      setError(
        `Not enough hidden budget: that costs ${xlmString(amountStroops)} XLM, you have ${xlmString(balances.spendable)}.`,
      );
      return;
    }
    try {
      const hash = await wallet.transfer(shop.address, amountStroops, onPhase);
      recordPurchase(wallet.address, {
        at: new Date().toISOString(),
        gameId: loadGameId(),
        shopId: shop.id,
        shopLabel: shop.label,
        item: item.label,
        amountStroops: amountStroops.toString(),
        txHash: hash,
      });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <div className="panel budget">
        <div>
          <div className="dim">hidden budget</div>
          <div className="big">{xlmString(balances.spendable)} XLM</div>
        </div>
        {balances.receiving > 0n && (
          <div>
            <div className="dim">received, uncollected</div>
            <div>
              {xlmString(balances.receiving)} XLM{" "}
              <button
                onClick={async () => {
                  setBusy("Collecting…");
                  try {
                    await wallet.merge();
                    await refresh();
                  } catch (e) {
                    setError(e instanceof Error ? e.message : String(e));
                  } finally {
                    setBusy(null);
                  }
                }}
              >
                collect
              </button>
            </div>
          </div>
        )}
        <div>
          <div className="dim">public XLM (everyone sees this)</div>
          <div>{xlmString(balances.publicXlm)} XLM</div>
        </div>
      </div>

      <div className="shops">
        {SHOPS.map((shop) => (
          <div key={shop.id} className="panel shop-card">
            <h3>{shop.label}</h3>
            <div className="items">
              {shop.items.map((item) => {
                const key = `${shop.id}:${item.id}`;
                const isArmed = armed === key;
                return (
                  <button
                    key={item.id}
                    className={isArmed ? "armed" : ""}
                    onClick={() =>
                      isArmed ? void pay(shop, item, stroopsFromXlm(item.priceXlm)) : setArmed(key)
                    }
                    onBlur={() => isArmed && setArmed(null)}
                    title={item.effect}
                  >
                    <span>{isArmed ? "Confirm purchase?" : item.label}</span>
                    <span>{item.priceXlm} XLM</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <p className="dim">
        Every purchase is a confidential transfer: the ledger shows <i>you paid this shop</i>,
        never the amount. Hover an item for what it does — effects are public knowledge; your
        shopping is not. Cheap wares make fine cover. The werebear is shopping too.
      </p>
    </div>
  );
}
