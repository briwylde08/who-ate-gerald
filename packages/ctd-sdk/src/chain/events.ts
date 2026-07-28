/**
 * Event ingestion over the Soroban RPC `getEvents` API — the ONLY source of
 * the protocol's client-visible secrets (encrypted amounts, salts, balance
 * checkpoints). There is no indexer.
 *
 * ⚠️ Retention: `getEvents` only serves roughly the last 7 days of ledgers.
 * Because spending requires re-deriving `v`/`r` from these events, a client
 * that misses an event before it expires can permanently lose the ability to
 * open the affected balance. The state engine (`state/`) therefore persists
 * decrypted state locally and must sync within the retention window. This is
 * the central, deliberate limitation of the demo.
 *
 * Events are soroban-sdk 26 `#[contractevent]` Map-format: `#[topic]` fields
 * become topics (after the event-name symbol), the rest become a data `ScMap`.
 *
 * VENDORED SPLIT (2026-07-28, Who Ate Gerald?): the pure event-shape types and
 * decoders live in `event-shapes.ts` (no stellar-sdk — Worker-bundleable) and
 * are re-exported here, so this module's public API is unchanged. Only the
 * RPC/XDR-backed fetching stays here.
 */

import { xdr, Address, scValToNative, rpc } from "@stellar/stellar-sdk";

import { fromBytesBE } from "../crypto/field.js";
import { pointFromBytes } from "../crypto/grumpkin.js";
import type { ChainClient } from "./client.js";
import {
  KNOWN,
  buildConfidentialEvent,
  cursorLedger,
  naturalEventId,
  rpcEventCoords,
  type ConfidentialEvent,
  type EventDataAccessor,
  type EventRef,
  type FetchEventsResult,
} from "./event-shapes.js";

export * from "./event-shapes.js";

/**
 * Fetch and parse all confidential-token events from `startLedger` (or resume
 * from `startCursor`), following pagination to the end. Unknown event types
 * (config setters, spender ops) are skipped.
 */
export async function fetchEvents(
  client: ChainClient,
  opts: { startLedger?: number; startCursor?: string; pageLimit?: number; contractId?: string },
): Promise<FetchEventsResult> {
  const tokenId = opts.contractId ?? client.cfg.contracts.token;
  const limit = opts.pageLimit ?? 100;
  const out: ConfidentialEvent[] = [];
  let pageCursor = opts.startCursor;
  let resumeCursor = opts.startCursor;
  let latestLedger = 0;

  if (pageCursor === undefined && opts.startLedger === undefined) {
    throw new Error("fetchEvents requires either startLedger or startCursor");
  }

  // VENDORED PATCH (2026-07-15, Axe & Ember): the RPC hard-rejects any
  // startLedger older than its ~7-day retention window (-32600 "startLedger
  // must be within the ledger range"). Events past the window are gone from
  // this source either way, so clamp to the oldest retained ledger — trading
  // a hard error for an explicitly best-effort scan. The same applies to a
  // persisted resume cursor that has aged out (handled in the catch below).
  const health = await client.server.getHealth();
  const oldestRetained = (health as unknown as { oldestLedger?: number }).oldestLedger;
  let startLedger = opts.startLedger;
  if (startLedger !== undefined && oldestRetained !== undefined && startLedger < oldestRetained) {
    startLedger = oldestRetained;
  }

  for (;;) {
    const filters = [{ type: "contract" as const, contractIds: [tokenId] }];
    const req: rpc.Api.GetEventsRequest = pageCursor
      ? { filters, cursor: pageCursor, limit }
      : { filters, startLedger: startLedger!, limit };

    let resp: Awaited<ReturnType<typeof client.server.getEvents>>;
    try {
      resp = await client.server.getEvents(req);
    } catch (err) {
      // Stale resume cursor (older than the retention window): restart the
      // scan from the oldest retained ledger instead of failing the sync.
      if (pageCursor !== undefined && isLedgerRangeError(err) && oldestRetained !== undefined) {
        pageCursor = undefined;
        resumeCursor = undefined;
        startLedger = oldestRetained;
        continue;
      }
      throw err;
    }
    latestLedger = resp.latestLedger;

    for (const ev of resp.events) {
      const parsed = parseEvent(ev);
      if (parsed) out.push(parsed);
    }
    // GetEventsResponse.cursor is the canonical resume token for the next page.
    const prevCursor = resumeCursor;
    resumeCursor = resp.cursor;
    pageCursor = resp.cursor;

    // A short — even empty — page does NOT mean we reached the chain head:
    // the RPC scans a bounded window of ledgers (~10k) per request and stops
    // there, returning a cursor at the end of the SCANNED range. Page until
    // that cursor catches up with the RPC's latest ledger.
    if (!resp.cursor) break;
    if (cursorLedger(resp.cursor) >= resp.latestLedger) break;
    if (resp.cursor === prevCursor) break; // defensive: no forward progress
  }

  return { events: out, cursor: resumeCursor, latestLedger };
}

/**
 * Resolve an {@link EventRef} to the single on-chain event it names, reading
 * ONLY the referenced ledger from the RPC (ledger-range mode). Returns `null`
 * if no token-contract event with that id exists there — including when the
 * ledger has aged out of the RPC's ~7-day retention window, which is this
 * demo's accepted limitation. The disclosure verifier (disclosure/verify.ts)
 * treats the result as the sole source of event-derived public inputs.
 */
export async function resolveEventRef(
  client: ChainClient,
  ref: EventRef,
): Promise<ConfidentialEvent | null> {
  const resp = await client.server.getEvents({
    filters: [{ type: "contract", contractIds: [client.cfg.contracts.token] }],
    startLedger: ref.ledger,
    endLedger: ref.ledger + 1,
    limit: 200,
  });
  // Match on the normalized id (parseEvent sets cursor = naturalEventId), so a
  // ref pinned from either source resolves here.
  const matches = resp.events
    .map(parseEvent)
    .filter((ev): ev is ConfidentialEvent => ev !== null && ev.cursor === ref.id);
  if (matches.length !== 1) return null;
  const ev = matches[0]!;
  if (ev.txHash !== ref.txHash) return null;
  return ev;
}

/** RPC -32600 "startLedger/cursor must be within the ledger range". */
function isLedgerRangeError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : JSON.stringify(err);
  return msg.includes("within the ledger range") || msg.includes("-32600");
}

function parseEvent(ev: rpc.Api.EventResponse): ConfidentialEvent | null {
  const topics = ev.topic;
  if (topics.length === 0) return null;
  const name = topics[0]!.sym().toString();
  if (!KNOWN.has(name)) return null;

  const { opIndex, eventIndex } = rpcEventCoords(ev.id);
  const base = {
    ledger: ev.ledger,
    txHash: ev.txHash,
    cursor: naturalEventId({ ledger: ev.ledger, txHash: ev.txHash, opIndex, eventIndex }),
  };
  const addr = (i: number): string => Address.fromScVal(topics[i]!).toString();
  return buildConfidentialEvent(name, base, addr, dataMap(ev.value));
}

/** XDR-backed {@link EventDataAccessor} over a Map-format event's data `ScMap`. */
function dataMap(value: xdr.ScVal): EventDataAccessor {
  const byName = new Map<string, xdr.ScVal>();
  for (const e of value.map() ?? []) byName.set(e.key().sym().toString(), e.val());
  const get = (name: string): xdr.ScVal => {
    const v = byName.get(name);
    if (!v) throw new Error(`event data missing field "${name}"`);
    return v;
  };
  return {
    field: (name) => fromBytesBE(new Uint8Array(get(name).bytes())),
    point: (name) => pointFromBytes(new Uint8Array(get(name).bytes())),
    i128: (name) => scValToNative(get(name)) as bigint,
    u32: (name) => get(name).u32(),
  };
}
