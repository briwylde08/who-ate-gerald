import { useState, useRef } from "react";

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
import { explorerTx, recordActivity } from "../lib/activity";
import { fetchGraph, fetchPublicView, loadGameId, pageHidden, playerApi, type GraphView, type ServerPurchases } from "../lib/player";
import { ToteIcon } from "./CharIcon";
import { SixSteps } from "./SixSteps";
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
  /** Jump to Maude — the done-for-today box points there. */
  onGoMaude: () => void;
  /** The server's decrypted record of MY purchases — localStorage lies on a
   *  second device (issue #16). Null until fetched; local math is fallback. */
  serverSpend: ServerPurchases | null;
  refreshServerSpend: () => void;
  /** Is this tab the one showing? Hidden tabs don't poll (issue #12). */
  active: boolean;
}

/**
 * The shop floor: four stores, each item a two-click button (arm, then
 * confirm). Every purchase is one confidential transfer — the village sees
 * the visit, never the amount, and the amount IS the item. Item effects are
 * public knowledge (hover); which one YOU bought is not.
 */
export function Village({ wallet, balances, visitedShops, round, onPhase, setBusy, setError, refresh, onGoMaude, serverSpend, refreshServerSpend, active }: Props) {
  const [armed, setArmed] = useState<string | null>(null);

  // Budget normalization: the allowance schedule says how much spendable a
  // law-abiding villager can hold right now. Anything above it is old-wallet
  // money that must be surrendered to the Town Treasury before the shops serve
  // you — that's how everyone verifiably plays with the same budget.
  const allowance = stroopsFromXlm(
    STARTING_BUDGET_XLM + DAILY_INCOME_XLM * Math.max(0, round - 1),
  );
  // Max of both records — each is a lower bound (see treasuryOwed for the
  // carousel this prevents).
  const localSpent = loadHistory(wallet.address, loadGameId()).reduce(
    (a, r) => a + BigInt(r.amountStroops),
    0n,
  );
  const serverSpent = serverSpend !== null ? BigInt(serverSpend.spentStroops) : null;
  const spentThisGame = serverSpent !== null && serverSpent > localSpent ? serverSpent : localSpent;
  // The lobby (round 0) uses the day-1 allowance for this math, but the
  // Treasury panels themselves are gated on `marketOpen` below (Bri,
  // 2026-08-xx): a surrender/top-up demand in the lobby — while every other
  // shop action reads "stores shut" — was a contradiction. Normalization now
  // surfaces when day 1 opens, still before any purchase (buying stays blocked
  // on excess), just not before the game has begun.
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

  // THE SETTLED-INPUTS GATE (Bri, 2026-08-18 — third sighting of this bug
  // family: aim race, Treasury carousel, now the Treasury panels). The
  // surrender/owes verdict mixes three reads that warm up at different
  // speeds (engine balance, server spend, live round). Demand agreement
  // between two consecutive balance reads — and the server record once the
  // game is on — before accusing anyone of owing anything.
  const prevSpendable = useRef<bigint | null>(null);
  const [balanceSettled, setBalanceSettled] = useState(false);
  useEffect(() => {
    setBalanceSettled(prevSpendable.current === balances.spendable);
    prevSpendable.current = balances.spendable;
  }, [balances]);
  const treasuryReady = balanceSettled && (round < 1 || serverSpend !== null);
  // The gate needs a SECOND read to agree with the first, and the app only
  // refreshes balances on actions — so while unsettled, ask for one.
  useEffect(() => {
    if (balanceSettled || !active) return;
    const t = setTimeout(() => refresh(), 1_200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [balanceSettled, balances, active]);

  const topUp = async () => {
    setError(null);
    // Two real transactions, narrated as they happen — Bri's wording.
    setBusy("Depositing XLM from Freighter into the confidential token contract pool…");
    try {
      const dep = await wallet.deposit(deficit);
      recordActivity(wallet.address, {
        at: new Date().toISOString(),
        label: "Collected from the Town Treasury (public deposit)",
        detail: `${xlmString(deficit)} XLM — public, so the budget is verifiable`,
        txHash: dep,
      });
      setBusy("Collecting into your spendable balance…");
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
  /** The teaching moment: what the village just learned, and what it didn't. */
  // Aimed items need a second, private action after the purchase.
  const [others, setOthers] = useState<string[]>([]);
  const [myFate, setMyFate] = useState<string | null>(null);
  const [winner, setWinner] = useState<string | null>(null);
  /** Dawn has broken; the next day opens in ~60s. Aims are refused meanwhile. */
  const [dayResetting, setDayResetting] = useState(false);
  /** The village-wide feed: every seated player's public txs. */
  const [feedGraph, setFeedGraph] = useState<GraphView | null>(null);
  useEffect(() => {
    const pull = () => {
      if (pageHidden() || !active) return; // hidden tabs don't poll (issue #12)
      void fetchGraph(loadGameId())
        .then(setFeedGraph)
        .catch(() => undefined);
    };
    pull();
    // 12s, down from 30 (Bri, 2026-08-18): the reliquary ladder ("x of 8
    // claimed") read stale for most of a shopping phase.
    const t = setInterval(pull, 12_000);
    return () => clearInterval(t);
  }, [round, active]);

  // My own purchases, by tx hash — used to annotate MY rows in the village
  // feed with what this browser privately knows (the item, the amount).
  const mine = new Map(
    loadHistory(wallet.address, loadGameId()).map((r) => [
      r.txHash,
      `${r.item} — ${xlmDisplay(BigInt(r.amountStroops))} XLM (only you see this)`,
    ]),
  );
  const feed = [
    ...(feedGraph?.edges ?? [])
      .filter((e) => e.txHash)
      .map((e) => ({
        ledger: e.ledger,
        txHash: e.txHash!,
        label: `Day ${e.round} · ${e.from} paid ${e.to} — amount confidential`,
        detail: mine.get(e.txHash!),
      })),
    ...(feedGraph?.deposits ?? []).map((d) => ({
      ledger: d.ledger,
      txHash: d.txHash,
      label: `${d.round < 1 ? "Lobby" : `Day ${d.round}`} · ${d.player} deposited ${d.amountXlm} XLM${d.round < 1 ? " (buy-in)" : ""} — public`,
      detail: undefined as string | undefined,
    })),
  ].sort((a, b) => b.ledger - a.ledger);
  const [aimTarget, setAimTarget] = useState<Record<string, string>>({});
  const [aimShop, setAimShop] = useState<Record<string, string>>({});
  const [aimed, setAimed] = useState<Record<string, string>>({});
  /** An aimed item that answers instantly (the candle) — shown as a modal. */
  const [aimResult, setAimResult] = useState<string | null>(null);
  const aimsKey = `gerald:aims:${loadGameId()}:${round}`;
  useEffect(() => {
    try {
      setAimed(JSON.parse(localStorage.getItem(aimsKey) ?? "{}") as Record<string, string>);
    } catch {
      setAimed({});
    }
  }, [aimsKey]);
  useEffect(() => {
    // TODAY's purchases only (Bri's ruling 2026-08-04): the shelf resets
    // each morning. Union of this browser's log and the server's decrypted
    // record — a dropped purchase response no longer hides the aim picker
    // for an item the chain says you own (issue #16).
    setBoughtItems(
      new Set([
        ...loadHistory(wallet.address, loadGameId())
          .filter((r) => r.round === round)
          .map((r) => r.item),
        ...(serverSpend?.purchases ?? [])
          .filter((r) => r.round === round && r.item !== null)
          .map((r) => r.item!),
      ]),
    );
  }, [wallet.address, round, serverSpend]);
  useEffect(() => {
    fetchPublicView(loadGameId())
      .then((v) => {
        const me = v.players.find((p) => p.address === wallet.address);
        setDoneToday(me?.doneToday === true);
        setOthers(
          v.players.filter((p) => p.alive && p.address !== wallet.address).map((p) => p.name),
        );
        // Which death was it? "banished or eaten" told a ghost nothing (Bri).
        const myName = me?.name;
        if (myName) {
          const b = v.mornings.find((m) => m.banished === myName);
          const e = v.mornings.find((m) => m.eaten === myName);
          setMyFate(
            b ? `banished on day ${b.round}` : e ? `eaten on day ${e.round}` : null,
          );
        }
        setDead(me ? !me.alive : false);
        setWinner(v.winner ?? null);
        // Dawn resolved but the next day hasn't opened yet (the ~60s roll):
        // the newest morning still belongs to the CURRENT round. Aiming is
        // refused during it, so the picker must not keep inviting it.
        setDayResetting(v.mornings.at(-1)?.round === v.round);
      })
      .catch(() => undefined);
  }, [wallet.address, round]);

  // Round 0 is the lobby: a purchase now can never fire (effects only read
  // rounds >= 1), so the coin would simply be burned. Bar the doors.
  const marketOpen = round >= 1;

  /** Today's store visits: public graph ∪ this browser's own instant log. */
  const visitedToday = [
    ...new Set([
      ...visitedShops,
      ...loadHistory(wallet.address, loadGameId())
        .filter((r) => r.round === round)
        .map((r) => r.shopLabel),
      ...(serverSpend?.purchases ?? [])
        .filter((r) => r.round === round)
        .map((r) => r.shopLabel),
    ]),
  ];

  /** Bought today, needs aiming, still unaimed — dead weight until pointed. */
  const unaimed = SHOPS.flatMap((sh) => sh.items).filter(
    (it) =>
      it.aim &&
      !aimed[it.id] &&
      loadHistory(wallet.address, loadGameId()).some(
        (r) => r.round === round && r.item === it.label,
      ),
  );

  /** Done with something unaimed = almost certainly a mistake. Arm first. */
  const [doneArmed, setDoneArmed] = useState(false);
  const declareDone = async () => {
    setError(null);
    setBusy("Telling the shopkeepers you're done…");
    try {
      await playerApi.doneShopping(wallet, loadGameId());
      setDoneToday(true);
      // Guide the eye: your shopping is now ON the chain — look, then go ask.
      document.querySelector(".activity-log")?.scrollIntoView({ behavior: "smooth" });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const aim = async (item: CatalogItem) => {
    setError(null);
    // aimItem decrypts the day's ledger server-side — seconds, not instant.
    // Without this, a double-click raced itself and the second click was told
    // "buy it today before you aim it" about an item just aimed (issue #13).
    setBusy("Pointing it…");
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
      if (r.result) setAimResult(r.result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
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
        detail: `${item.label} — amount confidential on chain`,
        txHash: hash,
      });
      setJustBought(`${shop.id}:${item.id}`);
      refreshServerSpend();
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
        {round >= 1 && (
          <div className="role-label">
            Day {round}
          </div>
        )}
        <p>
          You may buy items from two shops every day, one of each item. The number of different
          items you buy is up to you, as long as you can afford them. You will be given an
          additional {DAILY_INCOME_XLM} XLM per day. Once you're done purchasing your items for
          the day, click the “Done buying for today” button.
        </p>
        <p className="dim">
          Every purchase is a confidential transfer: the ledger shows <i>you paid this shop</i>,
          never the amount. The only people who know the amount of the confidential token
          transfer are you and the auditor (Maude).
        </p>
        <p className="dim">
          What each item does is public knowledge — which one you bought is not. The werebear
          is shopping too. DUN DUN DUN.
        </p>
      </div>
      {marketOpen && !dead && !treasuryReady && (deficit > 0n || excess > 0n) && (
        <div className="panel">
          <p className="dim">⚖ The Town Treasury is checking its books…</p>
        </div>
      )}
      {marketOpen && !dead && treasuryReady && deficit > 0n && excess === 0n && (
        <div className="panel">
          <h3>⚖ The Town Treasury owes you</h3>
          <p className="dim">
            {/* No treasury pays anyone: income is PERMISSION to move more of
                your own XLM behind the curtain, publicly. Say so. */}
            You hold {xlmString(balances.spendable)} XLM; the rules allow{" "}
            {xlmString(remainingAllowance)} by day {Math.max(1, round)}. Collecting transfers{" "}
            {xlmString(deficit)} XLM from your own wallet into the confidential token
            contract's pool, where it is represented as your confidential claims. Amounts
            inside the pool are hidden, but money entering it is always visible.
          </p>
          <button className="primary" onClick={() => void topUp()}>
            Collect {xlmString(deficit)} XLM
          </button>
        </div>
      )}

      <div className="panel purse">
        <div className="purse-block">
          <div className="purse-label">🔒 Confidential spending balance</div>
          <div className="purse-amount">{xlmDisplay(balances.spendable)} XLM</div>
          <div className="purse-note">
            Confidential claims that represent your share of the confidential token contract
            pool
          </div>
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
          <p className="dim">You can't shop — {myFate ?? "you're dead"}.</p>
        </div>
      )}

      {marketOpen && !dead && treasuryReady && excess > 0n && (
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


      {winner && (
        <div className="panel">
          <p className="dim">The game is over — the reckoning is in the Town Square.</p>
        </div>
      )}
      {!dead && doneToday && !winner && (
        <div className="panel">
          <h3><ToteIcon />✓ Done for today</h3>
          <p className="dim">
            The shopkeepers wave you off.{" "}
            <button className="link inline" onClick={onGoMaude}>
              Maude
            </button>{" "}
            opens her office once the <b>whole village</b> is done shopping.
          </p>
        </div>
      )}
      {/* NOT gated on doneToday: aiming stays possible (and necessary!)
          after Done, and hiding this cost the baker 23 XLM on an item he
          believed he'd aimed (game04, day 1). */}
      {!dead && round >= 1 && unaimed.length > 0 && !winner && (
        <div className="panel">
          <h3>{dayResetting ? "🌅 Dawn broke first" : "⚠ Not aimed yet"}</h3>
          <p className="dim">
            {dayResetting ? (
              <>
                {unaimed.map((it) => it.label).join(", ")} never got pointed at anybody, and the
                day is over. The coin is spent. The next day opens in a moment.
              </>
            ) : (
              <>
                {unaimed.map((it) => it.label).join(", ")}{" "}
                {unaimed.length === 1 ? "needs" : "need"} pointing at somebody before the day
                ends — until then {unaimed.length === 1 ? "it does" : "they do"} nothing at all.
                The picker is under {unaimed.length === 1 ? "the item" : "each item"} above.
                {doneToday && " You're done shopping, but you can still aim."}
              </>
            )}
          </p>
        </div>
      )}
      {!dead && !doneToday && round >= 1 && (
        <div className="row">
          <button
            className={doneArmed ? "armed" : ""}
            onClick={() => {
              // An unaimed item does NOTHING — the baker lost 23 XLM to an
              // item he never pointed (game04). Make Done a deliberate
              // second click while anything is still unaimed.
              if (unaimed.length > 0 && !doneArmed) {
                setDoneArmed(true);
                window.setTimeout(() => setDoneArmed(false), 5000);
                return;
              }
              setDoneArmed(false);
              void declareDone();
            }}
          >
            {doneArmed
              ? `⚠ ${unaimed.map((it) => it.label).join(", ")} not aimed — Done anyway?`
              : "Done buying for today"}
          </button>
          <span className="dim">
            {doneArmed
              ? "Aim it above first, or click again to finish with it unaimed."
              : "locks your stores; when the whole village is done, Maude opens"}
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
          // A key pointed at YOU is no longer a blind trap (Bri, 2026-08-18):
          // the barred door wears a big X, and your coin stays in your purse.
          const barred = serverSpend?.lockedShops?.includes(shop.id) ?? false;
          // The two-stores custom, visible BEFORE the till refuses you: a
          // third store's card shutters instead of taking your confirm and
          // then scolding you (issue #13).
          const capped = visitedToday.length >= 2 && !visitedToday.includes(shop.label);
          return (
          <div key={shop.id} className={`panel shop-card${capped ? " shut" : ""}${barred ? " barred" : ""}`}>
            {barred && (
              <div className="shop-x" aria-hidden="true">
                ✕
              </div>
            )}
            <h3>
              {shop.icon && (
                <span className="shop-icon" aria-hidden="true">
                  {shop.icon}
                </span>
              )}
              {shop.label}
            </h3>
            {shop.subtitle && <p className="shop-sub">“{shop.subtitle}”</p>}
            {/* The shopkeeper is a real account on the public ledger. Look
                mid-game and the page is EMPTY — a confidential payment is the
                buyer's transaction, not the shop's. The dawn till-count is
                the first mark this account ever makes. */}
            {shop.address && (
              <a
                className="till-link dim"
                href={`https://stellar.expert/explorer/testnet/account/${shop.address}`}
                target="_blank"
                rel="noreferrer"
              >
                till: {shop.address.slice(0, 5)}…{shop.address.slice(-4)} ↗
              </a>
            )}
            {barred && (
              <p className="shut-note">
                🔑 Someone's cold iron key barred this door for you today. It will not sell to
                you, and it will not take your coin.
              </p>
            )}
            {capped && (
              <p className="shut-note">
                <ToteIcon /> Two stores a day is the custom — you've been to{" "}
                {visitedToday.join(" and ")}.
              </p>
            )}
            <div className="items">
              {shop.items.map((item) => {
                const key = `${shop.id}:${item.id}`;
                const isArmed = armed === key;
                const price = stroopsFromXlm(item.priceXlm);
                const owned = boughtItems.has(item.label);
                const tooRich = price > balances.spendable;
                // Gerald's reliquary ladder (Bri): fingers sell out at 8,
                // unlocking the two thumbs; thumbs sell out, unlocking the
                // ten toes. Counts are village-wide, from the public graph.
                const relics = feedGraph?.relics ?? { fingers: 0, thumbs: 0, toes: 0 };
                const relicState =
                  item.id === "geralds_finger"
                    ? relics.fingers >= 8
                      ? "sold-out"
                      : "open"
                    : item.id === "geralds_thumb"
                      ? relics.fingers < 8
                        ? "locked"
                        : relics.thumbs >= 2
                          ? "sold-out"
                          : "open"
                      : item.id === "geralds_toe"
                        ? relics.thumbs < 2
                          ? "locked"
                          : relics.toes >= 10
                            ? "sold-out"
                            : "open"
                        : "open";
                const relicNote =
                  item.id === "geralds_finger"
                    ? relics.fingers >= 8
                      ? "All eight claimed. Gerald's hands are bare."
                      : `${relics.fingers} of 8 claimed by the village`
                    : item.id === "geralds_thumb"
                      ? relics.fingers < 8
                        ? "Still attached — claim all eight fingers first"
                        : relics.thumbs >= 2
                          ? "Both thumbs claimed."
                          : `${relics.thumbs} of 2 claimed by the village`
                      : item.id === "geralds_toe"
                        ? relics.thumbs < 2
                          ? "Still in his boots — claim both thumbs first"
                          : relics.toes >= 10
                            ? "All ten claimed. Gerald has no more to give."
                            : `${relics.toes} of 10 claimed by the village`
                        : null;
                // Until-spent items you still HOLD from an earlier day
                // (Bri, 2026-08-18): warn before buying another. Relics are
                // exempt — collecting Gerald is the point.
                const heldAlready =
                  item.id === "horseshoe_nail" || item.id === "pizza_party"
                    ? (serverSpend?.purchases ?? []).filter((p) => p.item === item.label).length -
                        (serverSpend?.spent?.[item.id as "horseshoe_nail" | "pizza_party"] ?? 0) >
                      0
                    : item.id === "unquiet_rest"
                      ? (serverSpend?.purchases ?? []).some((p) => p.item === item.label) &&
                        !serverSpend?.ghostVoteDecided
                      : false;
                const blocked =
                  !marketOpen || doneToday || tooRich || owned || capped || barred || relicState !== "open";
                const label = !marketOpen
                  ? "Not open yet"
                  : relicState === "locked"
                    ? "🔒 Not yet"
                    : relicState === "sold-out"
                      ? "Sold out"
                      : owned
                        ? "Bought today ✓"
                        : barred
                          ? "🔑 Locked out"
                          : doneToday
                            ? "Market closed"
                            : tooRich
                              ? "Can't afford this item"
                              : isArmed
                                ? heldAlready
                                  ? "Buy another?"
                                  : "Confirm?"
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
                      {isArmed && heldAlready && (
                        <p className="held-warning">
                          You already have one of these in your satchel, unused. Are you sure
                          you want another?
                        </p>
                      )}
                      {/* Effects are public knowledge — no reason to hide them
                          behind a hover that phones don't have. */}
                      <p className="effect">{item.effect}</p>
                      {relicNote && <p className="relic-note">{relicNote}</p>}
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
                                dayResetting ||
                                (item.aim !== "shop" && !aimTarget[item.id]) ||
                                (item.aim !== "player" && !aimShop[item.id])
                              }
                              onClick={() => void aim(item)}
                            >
                              {dayResetting ? "Too late — dawn broke" : "Aim it"}
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

      {/* The whole village's public txs, newest first: transfers (amount
          confidential) and deposits (amount visible — that's the boundary rule,
          demonstrated). Your own rows get your private detail, because this
          is your browser and it remembers what you bought. */}
      {/* ALWAYS present — no feed gate, no market gate. A box that hides
          when it has nothing to say is a box nobody can find, and the lobby
          is when buy-ins land, which is worth watching. */}
      {(
        <div className="panel activity-log">
          <div className="activity-head">
            <h3>Onchain activity</h3>
            <button className="primary" onClick={onGoMaude}>
              Ask Maude a question →
            </button>
          </div>
          {feed.length === 0 && (
            <p className="dim">
              Nothing yet — the village's transactions appear here as they land on the chain.
            </p>
          )}
          <div className="activity-rows">
            {feed.map((a, i) => (
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
      {aimResult && (
        <div className="film-overlay" role="dialog" aria-label="Your result">
          <div className="panel dawn-modal">
            <h2>🕯 Only you see this</h2>
            <p className="dawn-note">{aimResult}</p>
            <div className="row">
              <button className="primary" onClick={() => setAimResult(null)}>
                Got it
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Narrow screens have no sidebar; the tracker lives here instead
          (it lived in My Ledger until that tab retired). */}
      <div className="six-inline">
        <div className="panel">
          <SixSteps
            balances={balances}
            purchases={loadHistory(wallet.address, loadGameId()).length}
            owedStroops={dead ? 0n : deficit}
          />
        </div>
      </div>
    </div>
  );
}
