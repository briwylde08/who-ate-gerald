/**
 * The truth layer. Everything the Auditor "knows" is computed HERE, in code:
 * events come from the durable indexer, transfer amounts are decrypted with
 * the auditor key, and each fact tool returns one narrow, exact result.
 * Claude never sees ciphertexts and cannot invent amounts — it only phrases
 * what this module computed (see ask.ts).
 */
import { IndexerClient } from "@ctd/sdk/chain/indexer";
import type { TransferEvent } from "@ctd/sdk/chain/event-shapes";
import { auditTransfer } from "@ctd/sdk/auditor";
import { fromHex } from "@ctd/sdk/crypto";

import {
  CHAPEL_ID,
  DEPLOYED_AT_LEDGER,
  SHOP_BY_ADDRESS,
  SHOP_BY_ID,
  findItem,
  itemByExactPrice,
  stroopsFromXlm,
  xlmString,
} from "./catalog";

export interface PlayerRef {
  seat: number;
  name: string;
  address: string;
  alive: boolean;
}

export interface RoundWindow {
  round: number;
  startLedger: number;
  endLedger: number | null;
}

/** One decrypted confidential transfer, decorated with game meaning. */
export interface Purchase {
  round: number;
  ledger: number;
  txHash: string;
  from: string;
  /** Player name if `from` is a seated player. */
  player: string | null;
  /** Shop id if `to` is one of the village shops. */
  shopId: string | null;
  toLabel: string;
  amountStroops: bigint;
  amountXlm: string;
  /** Exact catalog price match at the destination shop (never for the Chapel). */
  itemGuess: string | null;
  /** Both auditor channels decrypted to the same amount (sanity flag). */
  channelsAgree: boolean;
}

export interface FactContext {
  purchases: Purchase[];
  players: PlayerRef[];
  currentRound: number;
}

interface IndexerEnv {
  INDEXER_URL: string;
  TOKEN_CONTRACT: string;
  AUDITOR_K: string;
}

/**
 * Best-effort manual sync so a question asked seconds after a purchase sees
 * it (the indexer cron only runs every 5 minutes). Errors are swallowed —
 * the cron catches up regardless.
 */
export async function syncIndexer(env: { INDEXER_URL: string }): Promise<void> {
  try {
    await fetch(`${env.INDEXER_URL.replace(/\/$/, "")}/sync`, { method: "POST" });
  } catch {
    // non-fatal
  }
}

/** Latest ledger the indexer has mirrored for the game token. */
export async function indexerLatestLedger(env: {
  INDEXER_URL: string;
  TOKEN_CONTRACT: string;
}): Promise<number> {
  const resp = await fetch(`${env.INDEXER_URL.replace(/\/$/, "")}/health`);
  if (!resp.ok) throw new Error(`indexer /health ${resp.status}`);
  const body = (await resp.json()) as {
    latest_synced_ledger?: number;
    contracts?: Record<string, number>;
  };
  return Number(body.contracts?.[env.TOKEN_CONTRACT] ?? body.latest_synced_ledger ?? 0);
}

/** The round an event belongs to: the latest round started at or before it. */
export function roundOf(ledger: number, rounds: RoundWindow[]): number {
  let round = 0; // before round 1 = setup (funding, registration)
  for (const w of rounds) {
    if (w.startLedger <= ledger && w.round > round) round = w.round;
  }
  return round;
}

/**
 * Fetch every game-token event from the durable indexer, keep the transfers,
 * decrypt each with the auditor key, and decorate with players/shops/rounds.
 */
export async function loadPurchases(
  env: IndexerEnv,
  players: PlayerRef[],
  rounds: RoundWindow[],
): Promise<Purchase[]> {
  const indexer = new IndexerClient({ baseUrl: env.INDEXER_URL });
  const { events } = await indexer.fetchEvents({
    contractId: env.TOKEN_CONTRACT,
    startLedger: DEPLOYED_AT_LEDGER,
  });
  const k = fromHex(env.AUDITOR_K);
  const byAddress = new Map(players.map((p) => [p.address, p]));

  const purchases: Purchase[] = [];
  for (const ev of events) {
    if (ev.type !== "transfer") continue;
    const t = ev as TransferEvent;
    const audit = auditTransfer(k, t);
    const shop = SHOP_BY_ADDRESS.get(t.to) ?? null;
    const player = byAddress.get(t.from) ?? null;
    purchases.push({
      round: roundOf(t.ledger, rounds),
      ledger: t.ledger,
      txHash: t.txHash,
      from: t.from,
      player: player?.name ?? null,
      shopId: shop?.id ?? null,
      toLabel: shop?.label ?? shortAddress(t.to),
      amountStroops: audit.amount,
      amountXlm: xlmString(audit.amount),
      itemGuess:
        shop && !shop.tithe ? (itemByExactPrice(shop, audit.amount)?.label ?? null) : null,
      channelsAgree: audit.channelsAgree,
    });
  }
  return purchases;
}

function shortAddress(addr: string): string {
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

// ---------------------------------------------------------------------------
// Fact execution — one narrow, exact answer per tool. All outputs JSON-safe.
// ---------------------------------------------------------------------------

export type FactResult = Record<string, unknown>;

function resolvePlayer(ctx: FactContext, name: unknown): PlayerRef | null {
  if (typeof name !== "string") return null;
  const q = name.trim().toLowerCase();
  return ctx.players.find((p) => p.name.toLowerCase() === q) ?? null;
}

function resolveShopId(shop: unknown): string | null {
  if (typeof shop !== "string") return null;
  const q = shop.trim().toLowerCase().replace(/\s+/g, "_");
  if (SHOP_BY_ID.has(q)) return q;
  for (const s of SHOP_BY_ID.values()) {
    if (s.label.toLowerCase() === shop.trim().toLowerCase()) return s.id;
  }
  return null;
}

function roundArg(ctx: FactContext, round: unknown): number {
  const r = typeof round === "number" ? round : Number(round);
  if (!Number.isInteger(r) || r < 1 || r > ctx.currentRound) return ctx.currentRound;
  return r;
}

const project = (p: Purchase) => ({
  shop: p.toLabel,
  amountXlm: p.amountXlm,
  item: p.itemGuess,
  round: p.round,
});

/**
 * Execute one fact tool against the decrypted purchase set. Unknown players,
 * shops, or items come back as `{error}` facts so the persona layer can say
 * so in character rather than guessing.
 */
export function executeFact(
  ctx: FactContext,
  tool: string,
  args: Record<string, unknown>,
): FactResult {
  switch (tool) {
    case "purchases_of_player": {
      const player = resolvePlayer(ctx, args.player);
      if (!player) return { error: `no villager named "${String(args.player)}" on the register` };
      const round = roundArg(ctx, args.round);
      const shopId = args.shop === undefined || args.shop === null ? null : resolveShopId(args.shop);
      if (args.shop !== undefined && args.shop !== null && !shopId) {
        return { error: `no shop named "${String(args.shop)}" in the village` };
      }
      const rows = ctx.purchases.filter(
        (p) =>
          p.from === player.address &&
          p.round === round &&
          (shopId === null ? p.shopId !== CHAPEL_ID : p.shopId === shopId),
      );
      return {
        player: player.name,
        round,
        shop: shopId ? (SHOP_BY_ID.get(shopId)?.label ?? shopId) : "all shops (tithe excluded)",
        count: rows.length,
        purchases: rows.map(project),
      };
    }

    case "tithe_amount": {
      const player = resolvePlayer(ctx, args.player);
      if (!player) return { error: `no villager named "${String(args.player)}" on the register` };
      const round = roundArg(ctx, args.round);
      const rows = ctx.purchases.filter(
        (p) => p.from === player.address && p.round === round && p.shopId === CHAPEL_ID,
      );
      return {
        player: player.name,
        round,
        tithes: rows.map((p) => p.amountXlm),
        totalXlm: xlmString(rows.reduce((a, p) => a + p.amountStroops, 0n)),
        note: rows.length === 0 ? "no tithe recorded this round" : undefined,
      };
    }

    case "who_bought_item": {
      const found = findItem(String(args.item ?? ""));
      if (!found) return { error: `no ware called "${String(args.item)}" in any shop's ledger` };
      const round =
        args.round === undefined || args.round === null ? null : roundArg(ctx, args.round);
      const price = stroopsFromXlm(found.item.priceXlm);
      const rows = ctx.purchases.filter(
        (p) =>
          p.shopId === found.shop.id &&
          p.amountStroops === price &&
          (round === null || p.round === round),
      );
      return {
        item: found.item.label,
        shop: found.shop.label,
        priceXlm: String(found.item.priceXlm),
        round: round ?? "all rounds so far",
        buyers: rows.map((p) => p.player ?? shortAddress(p.from)),
      };
    }

    case "largest_tithe": {
      const round = roundArg(ctx, args.round);
      const rows = ctx.purchases.filter((p) => p.round === round && p.shopId === CHAPEL_ID);
      if (rows.length === 0) return { round, largest: null, note: "no tithes recorded this round" };
      const max = rows.reduce((a, p) => (p.amountStroops > a ? p.amountStroops : a), 0n);
      const top = rows.filter((p) => p.amountStroops === max);
      return {
        round,
        amountXlm: xlmString(max),
        payers: top.map((p) => p.player ?? shortAddress(p.from)),
      };
    }

    case "total_spent": {
      const player = resolvePlayer(ctx, args.player);
      if (!player) return { error: `no villager named "${String(args.player)}" on the register` };
      const round = roundArg(ctx, args.round);
      const rows = ctx.purchases.filter((p) => p.from === player.address && p.round === round);
      return {
        player: player.name,
        round,
        totalXlm: xlmString(rows.reduce((a, p) => a + p.amountStroops, 0n)),
        payments: rows.length,
        includesTithe: rows.some((p) => p.shopId === CHAPEL_ID),
      };
    }

    case "paid_at_least": {
      const player = resolvePlayer(ctx, args.player);
      if (!player) return { error: `no villager named "${String(args.player)}" on the register` };
      const shopId = resolveShopId(args.shop);
      if (!shopId) return { error: `no shop named "${String(args.shop)}" in the village` };
      const round = roundArg(ctx, args.round);
      const min = stroopsFromXlm(Number(args.min_xlm ?? 0));
      const hit = ctx.purchases.some(
        (p) =>
          p.from === player.address &&
          p.round === round &&
          p.shopId === shopId &&
          p.amountStroops >= min,
      );
      return {
        player: player.name,
        shop: SHOP_BY_ID.get(shopId)?.label ?? shopId,
        round,
        minXlm: String(args.min_xlm),
        answer: hit,
      };
    }

    default:
      return { error: `unknown fact tool "${tool}"` };
  }
}
