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
import { explorerTx, loadActivity, recordActivity } from "../lib/activity";
import { fetchPublicView, loadGameId, playerApi } from "../lib/player";
import { ToteIcon } from "./CharIcon";
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
  // money that must be surrendered to the Town Treasury before the shops serve
  // you — that's how everyone verifiably plays with the same budget.
  const allowance = stroopsFromXlm(
    STARTING_BUDGET_XLM + DAILY_INCOME_XLM * Math.max(0, round - 1),
  );
  const spentThisGame = loadHistory(wallet.address, loadGameId()).reduce(
    (a, r) => a + BigInt(r.amountStroops),
    0n,
  );
  // In the lobby (round 0) the day-1 allowance already applies — settle your
  // business with the Treasury BEFORE the market opens, not during it.
  const remainingAllowance = allowance > spentThisGame ? allowance - spentThisGame : 0n;
  const excess =
    balances.spendable > remainingAllowance ? balances.spendable - remainingAllowance : 0n;

  const surrender = async () => {
    setError(null);
    try {
      if (!ORDER_ADDRESS) throw new Error("the Town Treasury is not configured");
      const hash = await wallet.transfer(ORDER_ADDRESS, excess, onPhase);
      recordActivity(wallet.address, {
        at: new Date().toISOString(),
        label: "Surrendered excess to the Town Treasury",
        detail: `${xlmString(excess)} XLM (confidential)`,
        txHash: hash,
      });
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
      const dep = await wallet.deposit(deficit);
      recordActivity(wallet.address, {
        at: new Date().toISOString(),
        label: "Collected from the Town Treasury (public deposit)",
        detail: `${xlmString(deficit)} XLM — public, so the budget is verifiable`,
        txHash: dep,
      });
      const mrg = await wallet.merge();
      recordActivity(wallet.address, {
        at: new Date().toISOString(),
        label: "Merged pending into purse",
        txHash: mrg,
      });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  // Done-for-the-day: locks your stores and unlocks your Maude question.
  // Dead players get neither stores nor the Treasury — the chain can't stop a
  // ghost's transfers, but the shop floor won't offer them.
  const [doneToday, setDoneToday] = useState(false);
  const [dead, setDead] = useState(false);
  // What this browser has bought in this game — drives the Owned badge.
  // localStorage-backed, so it is this player's own record, not the chain's.
  const [boughtItems, setBoughtItems] = useState<Set<string>>(new Set());
  const [justBought, setJustBought] = useState<string | null>(null);
  // Newest first; re-read on every render — it's a tiny localStorage list and
  // every recordActivity is followed by a state change that re-renders us.
  const activity = loadActivity(wallet.address).slice().reverse();
  /** The teaching moment: what the village just learned, and what it didn't. */
  const [receipt, setReceipt] = useState<{
    shopLabel: string;
    item: string;
    amountStroops: bigint;
  } | null>(null);
  // Aimed items need a second, private action after the purchase.
  const [others, setOthers] = useState<string[]>([]);
  const [closedShops, setClosedShops] = useState<string[]>([]);
  const [aimTarget, setAimTarget] = useState<Record<string, string>>({});
  const [aimShop, setAimShop] = useState<Record<string, string>>({});
  const [aimed, setAimed] = useState<Record<string, string>>({});
  const aimsKey = `gerald:aims:${loadGameId()}:${round}`;
  // Yesterday's receipt is yesterday's news — a new day clears it.
  useEffect(() => {
    setReceipt(null);
  }, [round]);
  useEffect(() => {
    try {
      setAimed(JSON.parse(localStorage.getItem(aimsKey) ?? "{}") as Record<string, string>);
    } catch {
      setAimed({});
    }
  }, [aimsKey]);
  useEffect(() => {
    // TODAY's purchases only (Bri's ruling 2026-08-04): the shelf resets
    // each morning, so an item bought yesterday can be bought again.
    setBoughtItems(
      new Set(
        loadHistory(wallet.address, loadGameId())
          .filter((r) => r.round === round)
          .map((r) => r.item),
      ),
    );
  }, [wallet.address, round]);
  useEffect(() => {
    fetchPublicView(loadGameId())
      .then((v) => {
        const me = v.players.find((p) => p.address === wallet.address);
        setDoneToday(me?.doneToday === true);
        setOthers(
          v.players.filter((p) => p.alive && p.address !== wallet.address).map((p) => p.name),
        );
        setClosedShops(v.closedShops ?? []);
        setDead(me ? !me.alive : false);
      })
      .catch(() => undefined);
  }, [wallet.address, round]);

  // Round 0 is the lobby: a purchase now can never fire (effects only read
  // rounds >= 1), so the coin would simply be burned. Bar the doors.
  const marketOpen = round >= 1;

  /** Bought today, needs aiming, still unaimed — dead weight until pointed. */
  const unaimed = SHOPS.flatMap((sh) => sh.items).filter(
    (it) =>
      it.aim &&
      !aimed[it.id] &&
      loadHistory(wallet.address, loadGameId()).some(
        (r) => r.round === round && r.item === it.label,
      ),
  );

  const declareDone = async () => {
    setError(null);
    try {
      await playerApi.doneShopping(wallet, loadGameId());
      setDoneToday(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const aim = async (item: CatalogItem) => {
    setError(null);
    try {
      const r = await playerApi.aim(
        wallet,
        loadGameId(),
        item.id,
        aimTarget[item.id] || undefined,
        aimShop[item.id] || undefined,
      );
      setAimed((a) => {
        const next = { ...a, [item.id]: r.at };
        localStorage.setItem(aimsKey, JSON.stringify(next));
        return next;
      });
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
      recordActivity(wallet.address, {
        at: new Date().toISOString(),
        label: `Paid ${shop.label} (confidential transfer)`,
        detail: `${item.label} — amount sealed on chain`,
        txHash: hash,
      });
      setReceipt({ shopLabel: shop.label, item: item.label, amountStroops });
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
      <div className="panel shop-howto">
        {!marketOpen && (
          <p className="shut-note">
            🔒 The stores are shut until the game begins.
          </p>
        )}
        <p>
          You may buy items from two shops every day. The amount of items you purchase is up to
          you, as long as you can afford them. You will be given an additional{" "}
          {DAILY_INCOME_XLM} XLM per day. Once you're done purchasing your items for the day,
          click the “Done buying for today” button.
        </p>
      </div>
      {!dead && deficit > 0n && excess === 0n && (
        <div className="panel">
          <h3>⚖ The Town Treasury owes you</h3>
          <p className="dim">
            {/* No treasury pays anyone: income is PERMISSION to move more of
                your own XLM behind the curtain, publicly. Say so. */}
            You hold {xlmString(balances.spendable)} XLM; the rules allow{" "}
            {xlmString(remainingAllowance)} by day {Math.max(1, round)}. Collecting transfers{" "}
            {xlmString(deficit)} XLM from your own wallet into the confidential token
            contract's pool, where it is represented as your confidential claims. The
            deposit's amount is public on purpose — that's how the village verifies everyone
            plays within the same budget.
          </p>
          <button className="primary" onClick={() => void topUp()}>
            Collect {xlmString(deficit)} XLM
          </button>
        </div>
      )}

      <div className="panel purse">
        <div className="purse-block">
          <div className="purse-label">🔒 Confidential claims</div>
          <div className="purse-amount">{xlmDisplay(balances.spendable)} XLM</div>
          <div className="purse-note">Your sealed spending balance — the village can't read it</div>
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
                  const hash = await wallet.merge();
                  recordActivity(wallet.address, {
                    at: new Date().toISOString(),
                    label: "Merged pending into purse",
                    txHash: hash,
                  });
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
            {/* The pending/spendable split is the one piece of protocol design
                players meet without being told why it exists. */}
            <div className="purse-note">
              Payments land here first, so nobody can spoil a proof you're building
            </div>
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
          <h3>⚖ The Town Treasury requires a word</h3>
          <p className="dim">
            You hold {xlmString(balances.spendable)} XLM, but the law allows{" "}
            {xlmString(remainingAllowance)} at this point in the game. Surrender the difference
            to the Treasury and the shops will serve you — everyone plays with the same
            budget, verifiably.
          </p>
          <button className="primary" onClick={() => void surrender()}>
            Surrender {xlmString(excess)} XLM to the Town Treasury
          </button>
        </div>
      )}


      {!dead && doneToday && (
        <div className="panel">
          <h3><ToteIcon />✓ Done for today</h3>
          <p className="dim">
            The shopkeepers wave you off. Maude opens her office once the <b>whole village</b>{" "}
            is done shopping.
          </p>
        </div>
      )}
      {receipt && (
        <div className="panel receipt">
          <div className="receipt-head">
            <div className="role-label">Paid — here is what that told the village</div>
            <button className="link" onClick={() => setReceipt(null)}>
              dismiss
            </button>
          </div>
          <p className="receipt-line">
            <span className="receipt-tag">They now know</span>
            you visited <b>{receipt.shopLabel}</b> today.
          </p>
          <p className="receipt-line">
            <span className="receipt-tag sealed">They cannot know</span>
            <b>{xlmDisplay(receipt.amountStroops)} XLM</b>, or <b>{receipt.item}</b>.
          </p>
          <p className="receipt-why">
            Every price in the village is unique, so that number would have named the item
            exactly. Sealing the amount is what hides the purchase.
          </p>
        </div>
      )}
      {!dead && !doneToday && round >= 1 && unaimed.length > 0 && (
        <div className="panel">
          <h3>⚠ Not aimed yet</h3>
          <p className="dim">
            {unaimed.map((it) => it.label).join(", ")}{" "}
            {unaimed.length === 1 ? "needs" : "need"} pointing at somebody before the day ends —
            until then {unaimed.length === 1 ? "it does" : "they do"} nothing at all. The picker
            is under {unaimed.length === 1 ? "the item" : "each item"} above.
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
        style={
          excess > 0n || dead || !marketOpen
            ? { opacity: 0.4, pointerEvents: "none" }
            : undefined
        }
      >
        {SHOPS.map((shop) => {
          const shut = closedShops.includes(shop.id);
          return (
          <div key={shop.id} className={`panel shop-card${shut ? " shut" : ""}`}>
            <h3>
              {shop.icon && (
                <span className="shop-icon" aria-hidden="true">
                  {shop.icon}
                </span>
              )}
              {shop.label}
            </h3>
            {shop.subtitle && <p className="shop-sub">“{shop.subtitle}”</p>}
            {shut && (
              <p className="shut-note">
                🧳 Shuttered today — the shopkeeper is on holiday. Somebody paid for that.
              </p>
            )}
            <div className="items">
              {shop.items.map((item) => {
                const key = `${shop.id}:${item.id}`;
                const isArmed = armed === key;
                const price = stroopsFromXlm(item.priceXlm);
                const owned = boughtItems.has(item.label);
                const tooRich = price > balances.spendable;
                const blocked = !marketOpen || doneToday || tooRich || owned;
                const label = !marketOpen
                  ? "Not open yet"
                  : owned
                  ? "Bought today ✓"
                  : shut
                    ? "Shuttered"
                    : doneToday
                      ? "Market closed"
                      : tooRich
                        ? "Can't afford this item"
                        : isArmed
                          ? "Confirm?"
                          : "Buy";
                return (
                  <div
                    key={item.id}
                    className={`item${owned ? " owned" : ""}${tooRich ? " too-rich" : ""}`}
                  >
                    <div className="item-main">
                      <div className="item-name">
                        {item.label}
                        {/* "Bought", not "Owned": most v4 items are consumed
                            (nail, charm) or only work the day they're bought,
                            so possession would be a promise the rules break. */}
                        {owned && <span className="badge">✓ Bought</span>}
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
                        disabled={blocked || shut}
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
                    {/* An aimed item is inert until it's pointed at somebody. */}
                    {item.aim && owned && (
                      <div className="aim-row">
                        {aimed[item.id] ? (
                          <span className="dim">Aimed at {aimed[item.id]} ✓</span>
                        ) : (
                          <>
                            {(item.aim === "player" || item.aim === "player+shop") && (
                              <select
                                aria-label={`Aim ${item.label} at a villager`}
                                value={aimTarget[item.id] ?? ""}
                                onChange={(e) =>
                                  setAimTarget((a) => ({ ...a, [item.id]: e.target.value }))
                                }
                              >
                                <option value="">choose a villager…</option>
                                {others.map((n) => (
                                  <option key={n} value={n}>
                                    {n}
                                  </option>
                                ))}
                              </select>
                            )}
                            {(item.aim === "shop" || item.aim === "player+shop") && (
                              <select
                                aria-label={`Aim ${item.label} at a store`}
                                value={aimShop[item.id] ?? ""}
                                onChange={(e) =>
                                  setAimShop((a) => ({ ...a, [item.id]: e.target.value }))
                                }
                              >
                                <option value="">choose a store…</option>
                                {SHOPS.map((sh) => (
                                  <option key={sh.id} value={sh.id}>
                                    {sh.label}
                                  </option>
                                ))}
                              </select>
                            )}
                            <button
                              disabled={
                                (item.aim !== "shop" && !aimTarget[item.id]) ||
                                (item.aim !== "player" && !aimShop[item.id])
                              }
                              onClick={() => void aim(item)}
                            >
                              Aim it
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          );
        })}
      </div>

      <p className="dim">
        Every purchase is a confidential transfer: the ledger shows <i>you paid this shop</i>,
        never the amount. What each item does is public knowledge — which one you bought is
        not. The werebear is shopping too.
      </p>

      {/* The running receipt trail: every tx this browser signed, linked to
          the chain, newest first. The proof the game is real, one click away. */}
      {activity.length > 0 && (
        <div className="panel activity-log">
          <h3>📜 Your activity on the chain</h3>
          <p className="dim">
            Every transaction this browser has signed. Open any of them — the shop and your
            signature are public; the amounts are not there to find.
          </p>
          <div className="activity-rows">
            {activity.map((a, i) => (
              <div key={`${a.txHash}-${i}`} className="activity-row">
                <span className="activity-main">
                  <span className="activity-label">{a.label}</span>
                  {a.detail && <span className="activity-detail">{a.detail}</span>}
                </span>
                <a className="tx-link" href={explorerTx(a.txHash)} target="_blank" rel="noreferrer">
                  {a.txHash.slice(0, 8)}… ↗
                </a>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
