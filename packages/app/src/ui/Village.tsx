import { useState } from "react";

import type { VillagerWallet, VillagerBalances, TxPhase } from "../lib/wallet";
import {
  DAILY_INCOME_XLM,
  ORDER_ADDRESS,
  SHOPS,
  STARTING_BUDGET_XLM,
  stroopsFromXlm,
  xlmDisplay,
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
  // Dead players get neither stores nor the Order — the chain can't stop a
  // ghost's transfers, but the shop floor won't offer them.
  const [doneToday, setDoneToday] = useState(false);
  const [dead, setDead] = useState(false);
  // What this browser has bought in this game — drives the Owned badge.
  // localStorage-backed, so it is this player's own record, not the chain's.
  const [boughtItems, setBoughtItems] = useState<Set<string>>(new Set());
  const [justBought, setJustBought] = useState<string | null>(null);
  useEffect(() => {
    // Keyed by item label — every one of the twelve is distinct, and that is
    // what the stored records carry.
    setBoughtItems(new Set(loadHistory(wallet.address, loadGameId()).map((r) => r.item)));
  }, [wallet.address, round]);
  useEffect(() => {
    fetchPublicView(loadGameId())
      .then((v) => {
        const me = v.players.find((p) => p.address === wallet.address);
        setDoneToday(me?.doneToday === true);
        setDead(me ? !me.alive : false);
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
    // The cap counts BOTH the public graph (other devices, authoritative but
    // laggy) and this browser's own instant purchase log — no sync window to
    // slip a third store through.
    const localVisited = loadHistory(wallet.address, loadGameId())
      .filter((r) => r.round === round)
      .map((r) => r.shopLabel);
    const visited = [...new Set([...visitedShops, ...localVisited])];
    if (visited.length >= 2 && !visited.includes(shop.label)) {
      setError(
        `The village is small, but spread out: two stores a day is the custom. Today you've been to ${visited.join(" and ")}. (Maude audits.)`,
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
        round,
        shopId: shop.id,
        shopLabel: shop.label,
        item: item.label,
        amountStroops: amountStroops.toString(),
        txHash: hash,
      });
      setBoughtItems((s) => new Set(s).add(item.label));
      setJustBought(`${shop.id}:${item.id}`);
      window.setTimeout(() => setJustBought(null), 3000);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="shop-page">
      <div className="panel purse">
        <div className="purse-block">
          <div className="purse-label">🔒 Private purse</div>
          <div className="purse-amount">{xlmDisplay(balances.spendable)} XLM</div>
          <div className="purse-note">Hidden from the village</div>
        </div>
        {balances.receiving > 0n && (
          <div className="purse-block">
            <div className="purse-label">📦 Uncollected</div>
            <div className="purse-amount secondary">
              {xlmDisplay(balances.receiving)} XLM
            </div>
            <button
              className="link"
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
              Collect into purse
            </button>
          </div>
        )}
        <div className="purse-block">
          <div className="purse-label">👁 Public wallet</div>
          <div className="purse-amount secondary">{xlmDisplay(balances.publicXlm)} XLM</div>
          <div className="purse-note">Everyone can see this</div>
        </div>
      </div>

      {dead && (
        <div className="panel">
          <h3>🪦 The shops serve no ghosts</h3>
          <p className="dim">
            You are dead — banished or eaten, the market no longer concerns you. Whatever coin
            you carry, purchases from beyond the grave hold no power at dawn. Haunt the square
            instead; the living can hear you.
          </p>
        </div>
      )}

      {!dead && excess > 0n && (
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

      {!dead && deficit > 0n && excess === 0n && (
        <div className="panel">
          <h3>⚖ The Order owes you</h3>
          <p className="dim">
            You hold {xlmString(balances.spendable)} XLM; the allowance at this point is{" "}
            {xlmString(remainingAllowance)}. Daily income and old-wallet shortfalls both collect
            here — the deposit is public, so everyone can verify it's fair.
          </p>
          <button className="primary" onClick={() => void topUp()}>
            Collect {xlmString(deficit)} XLM
          </button>
        </div>
      )}

      {!dead && doneToday && (
        <div className="panel">
          <h3>🛍✓ Done for today</h3>
          <p className="dim">
            The shopkeepers wave you off. Maude opens her office once the <b>whole village</b>{" "}
            is done shopping.
          </p>
        </div>
      )}
      {!dead && !doneToday && round >= 1 && (
        <div className="row">
          <button onClick={() => void declareDone()}>Done buying for today</button>
          <span className="dim">
            locks your stores; when the whole village is done, Maude opens
          </span>
        </div>
      )}

      <div
        className="shops"
        style={excess > 0n || dead ? { opacity: 0.4, pointerEvents: "none" } : undefined}
      >
        {SHOPS.map((shop) => (
          <div key={shop.id} className="panel shop-card">
            <h3>
              {shop.icon && (
                <span className="shop-icon" aria-hidden="true">
                  {shop.icon}
                </span>
              )}
              {shop.label}
            </h3>
            {shop.subtitle && <p className="shop-sub">“{shop.subtitle}”</p>}
            <div className="items">
              {shop.items.map((item) => {
                const key = `${shop.id}:${item.id}`;
                const isArmed = armed === key;
                const price = stroopsFromXlm(item.priceXlm);
                const owned = boughtItems.has(item.label);
                const tooRich = price > balances.spendable;
                const blocked = doneToday || tooRich;
                const label = doneToday
                  ? "Market closed"
                  : tooRich
                    ? "Too rich for your blood"
                    : isArmed
                      ? "Confirm?"
                      : owned
                        ? "Buy another"
                        : "Buy";
                return (
                  <div
                    key={item.id}
                    className={`item${owned ? " owned" : ""}${tooRich ? " too-rich" : ""}`}
                  >
                    <div className="item-main">
                      <div className="item-name">
                        {item.label}
                        {owned && <span className="badge">✓ Owned</span>}
                      </div>
                      {item.flavor && <p className="item-flavor">“{item.flavor}”</p>}
                      {/* Effects are public knowledge — no reason to hide them
                          behind a hover that phones don't have. */}
                      <p className="effect">{item.effect}</p>
                    </div>
                    <div className="item-buy">
                      <span className="price">{item.priceXlm} XLM</span>
                      <button
                        className={isArmed ? "armed" : ""}
                        disabled={blocked}
                        aria-label={`${label}: ${item.label}, ${item.priceXlm} XLM`}
                        onClick={() =>
                          isArmed ? void pay(shop, item, price) : setArmed(key)
                        }
                        onBlur={() => isArmed && setArmed(null)}
                      >
                        {label}
                      </button>
                      {justBought === key && (
                        <span className="satchel" role="status">
                          Added to satchel
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <p className="dim">
        Every purchase is a confidential transfer: the ledger shows <i>you paid this shop</i>,
        never the amount. What each item does is public knowledge — which one you bought is
        not. The werebear is shopping too.
      </p>
    </div>
  );
}
