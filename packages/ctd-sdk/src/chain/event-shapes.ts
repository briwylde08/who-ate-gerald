/**
 * Pure event-shape definitions and decoders shared by the RPC (XDR) path in
 * `events.ts` and the indexer (Goldsky-JSON) path in `indexer.ts`.
 *
 * VENDORED SPLIT (2026-07-28, Who Ate Gerald?): extracted from `events.ts` so
 * that Cloudflare Workers can decode indexer rows without bundling
 * `@stellar/stellar-sdk` — this module depends only on the pure crypto
 * primitives (noble-curves). `events.ts` re-exports everything here, so the
 * SDK's public API is unchanged.
 */

import { toHex32 } from "../crypto/field.js";
import { pointCoords, type Point } from "../crypto/grumpkin.js";

export type ConfidentialEventType =
  | "register"
  | "deposit"
  | "merge"
  | "withdraw"
  | "transfer"
  | ComplianceEventType;

/**
 * Compliance + policy membership events. They share one shape — topics
 * `[symbol, account]` with NO data fields — and are emitted by the
 * `token_with_compliance` contract (`frozen`/`unfrozen`) and the standalone
 * allowlist/blocklist policy contracts (`user_*`). Note the on-chain symbol is
 * the snake_case of the soroban `#[contractevent]` struct name, so the
 * allowlist's `UserAllowed` struct emits `user_allowed` (NOT `allow`, despite
 * what the library docstrings say). They do not affect balance openings, so the
 * StateEngine ignores them; the token-admin dashboard replays them.
 */
export type ComplianceEventType =
  | "frozen"
  | "unfrozen"
  | "user_allowed"
  | "user_disallowed"
  | "user_blocked"
  | "user_unblocked";

interface BaseEvent {
  type: ConfidentialEventType;
  ledger: number;
  txHash: string;
  /**
   * Source-independent event id ({@link naturalEventId}) — the SAME string
   * whether this event came from the RPC or the Goldsky indexer, so the two
   * sources dedupe and cross-resolve. This is NOT the RPC resume cursor; that
   * is the response-level {@link FetchEventsResult.cursor} (still an RPC paging
   * token), which is what the StateEngine persists between syncs.
   */
  cursor: string;
}

export interface RegisterEvent extends BaseEvent {
  type: "register";
  account: string;
  auditorId: number;
}
export interface DepositEvent extends BaseEvent {
  type: "deposit";
  from: string;
  to: string;
  amount: bigint;
}
export interface MergeEvent extends BaseEvent {
  type: "merge";
  account: string;
}
export interface WithdrawEvent extends BaseEvent {
  type: "withdraw";
  from: string;
  to: string;
  amount: bigint;
  rE: Point;
  sigma: bigint;
  bTilde: bigint;
  bAudS: bigint;
}
export interface TransferEvent extends BaseEvent {
  type: "transfer";
  from: string;
  to: string;
  rE: Point;
  vTilde: bigint;
  sigma: bigint;
  bTilde: bigint;
  vAudR: bigint;
  rAudR: bigint;
  vAudS: bigint;
  bAudS: bigint;
}

/** A compliance/policy membership event ({@link ComplianceEventType}). */
export interface ComplianceEvent extends BaseEvent {
  type: ComplianceEventType;
  /** The account that was frozen/unfrozen or added/removed from a policy list. */
  account: string;
}

export type ConfidentialEvent =
  | RegisterEvent
  | DepositEvent
  | MergeEvent
  | WithdrawEvent
  | TransferEvent
  | ComplianceEvent;

/** The event-name symbols this client understands (topic[0]). Shared by the
 * RPC (XDR) and indexer (Goldsky-JSON) decoders so both accept the same set. */
export const KNOWN: ReadonlySet<string> = new Set([
  "register",
  "deposit",
  "merge",
  "withdraw",
  "transfer",
  "frozen",
  "unfrozen",
  "user_allowed",
  "user_disallowed",
  "user_blocked",
  "user_unblocked",
]);

/**
 * Source-agnostic accessor over an event's data `ScMap`, keyed by field name.
 * The RPC decoder backs it with XDR (`events.ts` dataMap); the indexer decoder
 * backs it with Goldsky JSON. {@link buildConfidentialEvent} is written against
 * this interface alone, so the two sources share ONE event-shape definition.
 */
export interface EventDataAccessor {
  field(name: string): bigint;
  point(name: string): Point;
  i128(name: string): bigint;
  u32(name: string): number;
}

/**
 * The single source of truth for each event type's shape: which topics are
 * addresses and which data fields are field elements / points / i128 / u32.
 * Both `parseEvent` (RPC/XDR) and `parseIndexerEvent` (Goldsky/JSON) call
 * this with their own `addr`/`data` adapters, so the field mapping cannot drift
 * between sources (the invariant the parity test guards). Returns `null` for
 * names outside {@link KNOWN}.
 */
export function buildConfidentialEvent(
  name: string,
  base: { ledger: number; txHash: string; cursor: string },
  addr: (topicIndex: number) => string,
  data: EventDataAccessor,
): ConfidentialEvent | null {
  switch (name) {
    case "register":
      return { ...base, type: "register", account: addr(1), auditorId: data.u32("auditor_id") };
    case "deposit":
      return { ...base, type: "deposit", from: addr(1), to: addr(2), amount: data.i128("amount") };
    case "merge":
      return { ...base, type: "merge", account: addr(1) };
    case "withdraw":
      return {
        ...base,
        type: "withdraw",
        from: addr(1),
        to: addr(2),
        amount: data.i128("amount"),
        rE: data.point("r_e"),
        sigma: data.field("sigma"),
        bTilde: data.field("b_tilde"),
        bAudS: data.field("b_aud_s"),
      };
    case "transfer":
      return {
        ...base,
        type: "transfer",
        from: addr(1),
        to: addr(2),
        rE: data.point("r_e"),
        vTilde: data.field("v_tilde"),
        sigma: data.field("sigma"),
        bTilde: data.field("b_tilde"),
        vAudR: data.field("v_aud_r"),
        rAudR: data.field("r_aud_r"),
        vAudS: data.field("v_aud_s"),
        bAudS: data.field("b_aud_s"),
      };
    case "frozen":
    case "unfrozen":
    case "user_allowed":
    case "user_disallowed":
    case "user_blocked":
    case "user_unblocked":
      // All share the [symbol, account] / empty-data shape (data unused).
      return { ...base, type: name, account: addr(1) };
    default:
      return null;
  }
}

export interface FetchEventsResult {
  events: ConfidentialEvent[];
  /** Last RPC cursor seen — pass back as `startCursor` to resume. */
  cursor: string | undefined;
  /** Latest ledger the RPC has, for staleness/retention checks. */
  latestLedger: number;
}

/**
 * Ledger sequence encoded in an RPC paging-token cursor (`<toid>-<event index>`,
 * where `toid = ledger << 32 | ...`). The cursor the RPC returns marks the end
 * of the ledger range it SCANNED, which can be far behind the chain head. Only
 * ever called on the RPC RESUME cursor ({@link FetchEventsResult.cursor}), never
 * on a per-event {@link BaseEvent.cursor} ({@link naturalEventId}).
 */
export function cursorLedger(cursor: string): number {
  return Number(BigInt(cursor.split("-")[0]!) >> 32n);
}

/**
 * Source-independent id for one on-chain event:
 * `${ledger}-${txHash}-${opIndex}-${eventIndex}`. The RPC and the Goldsky
 * indexer encode an event's coordinates differently (RPC: a `<toid>-<eventOrder>`
 * paging token; Goldsky: a `<ledger>-<txHash>-op-N-event-M` row id), but both
 * carry the same `(ledger, txHash, opIndex, eventIndex)`. Normalizing to this
 * string lets `dedupeById` and disclosure `resolveEventRef` treat
 * events from either source as one. It is used purely as a match key (it is NOT
 * bound into any proof's public inputs), so the format is free to change.
 */
export function naturalEventId(p: {
  ledger: number;
  txHash: string;
  opIndex: number;
  eventIndex: number;
}): string {
  return `${p.ledger}-${p.txHash}-${p.opIndex}-${p.eventIndex}`;
}

/**
 * The operation and event indices carried inside an RPC event id
 * (`<toid>-<eventOrder>`): `opIndex = toid & 0xfff`, `eventIndex = eventOrder`.
 */
export function rpcEventCoords(id: string): { opIndex: number; eventIndex: number } {
  const [toidStr, eventStr] = id.split("-");
  const opIndex = Number(BigInt(toidStr!) & 0xfffn);
  const eventIndex = Number(eventStr ?? "0");
  return { opIndex, eventIndex };
}

/**
 * Event reference (SELECTIVE_DISCLOSURE.md §5.1): pins one on-chain event.
 * `id` is the source-independent {@link naturalEventId} (same value as
 * {@link BaseEvent.cursor}), so a reference pinned from an RPC event resolves
 * against the indexer and vice-versa; `ledger`/`txHash` let the verifier bound
 * the lookup and cross-check the resolution. `id` is a match key only — it is
 * never part of any proof's public inputs (disclosure/verify.ts §5.2).
 */
export interface EventRef {
  ledger: number;
  id: string;
  txHash: string;
}

export const eventRef = (ev: ConfidentialEvent): EventRef => ({
  ledger: ev.ledger,
  id: ev.cursor,
  txHash: ev.txHash,
});

/**
 * Plain-JSON projection of a parsed event (bigints → 0x-hex, points → x/y
 * hex), with its {@link EventRef} attached as `ref`. This is the
 * copy-to-clipboard format the UI exposes so any third party can re-resolve
 * and inspect the event.
 */
export function eventToJson(ev: ConfidentialEvent): Record<string, unknown> {
  const plain: Record<string, unknown> = { ref: eventRef(ev) };
  for (const [k, v] of Object.entries(ev)) {
    if (k === "cursor") continue;
    if (typeof v === "bigint") plain[k] = toHex32(v);
    else if (isPoint(v)) {
      const { x, y } = pointCoords(v);
      plain[k] = { x: toHex32(x), y: toHex32(y) };
    } else plain[k] = v;
  }
  return plain;
}

function isPoint(v: unknown): v is Point {
  return typeof v === "object" && v !== null && "toAffine" in v;
}
