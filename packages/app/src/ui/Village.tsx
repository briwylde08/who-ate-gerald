import { useState } from "react";

import type { VillagerWallet, VillagerBalances, TxPhase } from "../lib/wallet";
import {
  DAILY_INCOME_XLM,
  ORDER_ADDRESS,
  SHOPS,
  STARTING_BUDGET_XLM,
  stroopsFromXlm,
  xlmString,
  type ShopInfo,
  type CatalogItem,
} from "../lib/catalog";
import { loadHistory, recordPurchase } from "../lib/history";
import { fetchPublicView, loadGameId, playerApi } from "../lib/player";
import { useEffect } from "react";

interface Props {
  wallet: VillagerWallet;
  balances: VillagerBalances;
  /** Shop labels visited this round (from the public graph) — drives the 2-shop cap. */
  visitedShops: string[];
  /** Current game day (0 = lobby) — drives the allowance schedule. */
  round: number;
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
export function Village({ wallet, balances, visitedShops, round, onPhase, setBusy, setError, refresh }: Props) {
  const [armed, setArmed] = useState<string | null>(null);

  // Budget normalization: the allowance schedule says how much spendable a
  // law-abiding villager can hold right now. Anything above it is old-wallet
  // money that must be surrendered to the Order before the shops will serve
  // you — that's how everyone verifiably plays with the same budget.
  const allowance = stroopsFromXlm(
    STARTING_BUDGET_XLM + DAILY_INCOME_XLM * Math.max(0, round - 1),
  );
  const spentThisGame = loadHistory(wallet.address, loadGameId()).reduce(
    (a, r) => a + BigInt(r.amountStroops),
    0n,
  );
  // In the lobby (round 0) the day-1 allowance already applies — settle your
  // business with the Order BEFORE the market opens, not during it.
  const remainingAllowance = allowance > spentThisGame ? allowance - spentThisGame : 0n;
  const excess =
    balances.spendable > remainingAllowance ? balances.spendable - remainingAllowance : 0n;

  const surrender = async () => {
    setError(null);
    try {
      if (!ORDER_ADDRESS) throw new Error("the Order's office is not configured");
      await wallet.transfer(ORDER_ADDRESS, excess, onPhase);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  // The mirror of the surrender: a wallet that arrives BELOW the allowance
  // (spent down in a previous game) may top up to it. Deposits are public,
  // so the whole village can verify the top-up stays within the schedule.
  const deficit =
    remainingAllowance > balances.spendable ? remainingAllowance - balances.spendable : 0n;

  const topUp = async () => {
    setError(null);
    setBusy("Topping up your budget (deposit + collect)…");
    try {
      await wallet.deposit(deficit);
      await wallet.merge();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  // Done-for-the-day: locks your stores and unlocks your Maude question.
  const [doneToday, setDoneToday] = useState(false);
  useEffect(() => {
    fetchPublicView(loadGameId())
      .then((v) => {
        const me = v.players.find((p) => p.address === wallet.address);
        setDoneToday(me?.doneToday === true);
      })
      .catch(() => undefined);
  }, [wallet.address, round]);

  const declareDone = async () => {
    setError(null);
    try {
      await playerApi.doneShopping(wallet, loadGameId());
      setDoneToday(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

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

      {excess > 0n && (
        <div className="panel">
          <h3>⚖ The Order requires a word</h3>
          <p className="dim">
            You hold {xlmString(balances.spendable)} XLM, but the law allows{" "}
            {xlmString(remainingAllowance)} at this point in the game. Surrender the difference
            to Maude's office and the shops will serve you — everyone plays with the same
            budget, verifiably.
          </p>
          <button className="primary" onClick={() => void surrender()}>
            Surrender {xlmString(excess)} XLM to the Order
          </button>
        </div>
      )}

      {deficit > 0n && excess === 0n && (
        <div className="panel">
          <h3>⚖ The Order owes you a word</h3>
          <p className="dim">
            You hold {xlmString(balances.spendable)} XLM, but the allowance at this point is{" "}
            {xlmString(remainingAllowance)} — your wallet arrived poorer than the law provides
            (a previous game's spending, most likely). Top up the difference from your public
            XLM; the deposit is public, so everyone can verify it's fair.
          </p>
          <button className="primary" onClick={() => void topUp()}>
            Top up {xlmString(deficit)} XLM
          </button>
        </div>
      )}

      {doneToday && (
        <div className="panel">
          <h3>🛍✓ Done for today</h3>
          <p className="dim">
            The shopkeepers wave you off. Your question to Maude is waiting — and buying
            anything now would be noticed at dawn.
          </p>
        </div>
      )}
      {!doneToday && round >= 1 && (
        <div className="row">
          <button onClick={() => void declareDone()}>Done buying for today → unlock Maude</button>
          <span className="dim">locks your stores for the day; shop first, ask second</span>
        </div>
      )}

      <div
        className="shops"
        style={excess > 0n || doneToday ? { opacity: 0.4, pointerEvents: "none" } : undefined}
      >
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
