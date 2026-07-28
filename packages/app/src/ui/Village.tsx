import { useState } from "react";

import type { VillagerWallet, VillagerBalances, TxPhase } from "../lib/wallet";
import { CHAPEL, SHOPS, stroopsFromXlm, xlmString, type ShopInfo, type CatalogItem } from "../lib/catalog";
import { recordPurchase } from "../lib/history";

interface Props {
  wallet: VillagerWallet;
  balances: VillagerBalances;
  onPhase: (p: TxPhase) => void;
  setBusy: (b: string | null) => void;
  setError: (e: string | null) => void;
  refresh: () => Promise<void>;
}

/**
 * The shop floor: five cards, each item a two-click button (arm, then
 * confirm). Every purchase is one confidential transfer — the village sees
 * the visit, never the amount, and the amount IS the item.
 */
export function Village({ wallet, balances, onPhase, setBusy, setError, refresh }: Props) {
  const [armed, setArmed] = useState<string | null>(null);
  const [titheXlm, setTitheXlm] = useState<string>("");

  const pay = async (shop: ShopInfo, item: CatalogItem | null, amountStroops: bigint) => {
    setArmed(null);
    setError(null);
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
        shopId: shop.id,
        shopLabel: shop.label,
        item: item?.label ?? "tithe",
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

  const payTithe = async () => {
    const parsed = Number(titheXlm);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError("The Chapel accepts any amount — but it must be a positive number of XLM.");
      return;
    }
    setTitheXlm("");
    await pay(CHAPEL, null, stroopsFromXlm(parsed));
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
        {SHOPS.filter((s) => !s.tithe).map((shop) => (
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

        <div className="panel shop-card">
          <h3>{CHAPEL.label}</h3>
          <p className="dim">
            The tithe. Any amount, once a round. The whole village sees you pay — only the
            Auditor sees how much.
          </p>
          <div className="row">
            <input
              type="number"
              min="0"
              step="0.0000001"
              placeholder="amount in XLM"
              value={titheXlm}
              onChange={(e) => setTitheXlm(e.target.value)}
            />
            <button
              className={armed === "tithe" ? "armed" : ""}
              onClick={() => (armed === "tithe" ? void payTithe() : setArmed("tithe"))}
              onBlur={() => armed === "tithe" && setArmed(null)}
              disabled={titheXlm === ""}
            >
              {armed === "tithe" ? "Confirm tithe?" : "Pay the tithe"}
            </button>
          </div>
        </div>
      </div>

      <p className="dim">
        Every purchase is a confidential transfer: the ledger shows <i>you paid this shop</i>,
        never the amount. Cheap wares make fine decoys. Spend wisely — or conspicuously.
      </p>
    </div>
  );
}
