/**
 * Player-tier API to the gerald-auditor worker. Identity = a Freighter
 * SEP-53 signature over a fixed per-(game, address) message — MUST match
 * auth.ts in the worker byte-for-byte. Signed once, cached locally.
 */
import { AUDITOR_URL, DEPLOYMENT } from "./deployment";
import type { VillagerWallet } from "./wallet";
import type { MorningReport } from "./types";

export function playerAuthMessage(gameId: string, address: string): string {
  return [
    "Who Ate Gerald? — player auth v1",
    "",
    "Signing this message proves your seat to the village record-keeper.",
    "Only sign it on Who Ate Gerald?.",
    "",
    `Game: ${gameId}`,
    `Address: ${address}`,
  ].join("\n");
}

const GAME_KEY = "gerald:game-id";

export function loadGameId(): string {
  return localStorage.getItem(GAME_KEY) ?? "playtest-1";
}

export function saveGameId(id: string): void {
  localStorage.setItem(GAME_KEY, id.trim());
}

/** Get (or create and cache) this player's auth signature for one game. */
export async function authSignature(wallet: VillagerWallet, gameId: string): Promise<string> {
  const key = `gerald:psig:${DEPLOYMENT.token}:${gameId}:${wallet.address}`;
  const cached = localStorage.getItem(key);
  if (cached) return cached;
  const sig = await wallet.signAuthMessage(playerAuthMessage(gameId, wallet.address));
  const b64 = btoa(String.fromCharCode(...sig));
  localStorage.setItem(key, b64);
  return b64;
}

async function playerCall<T>(
  wallet: VillagerWallet,
  gameId: string,
  action: string,
  extra: Record<string, unknown> = {},
): Promise<T> {
  const signature = await authSignature(wallet, gameId);
  const resp = await fetch(`${AUDITOR_URL}/games/${encodeURIComponent(gameId)}/p/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address: wallet.address, signature, ...extra }),
  });
  const body = (await resp.json()) as T & { error?: string };
  if (!resp.ok) {
    // A stale cached signature (e.g. worker auth scheme changed) → re-sign once.
    if (resp.status === 401) {
      localStorage.removeItem(`gerald:psig:${DEPLOYMENT.token}:${gameId}:${wallet.address}`);
    }
    throw new Error(body.error ?? `${action}: HTTP ${resp.status}`);
  }
  return body;
}

/** Is the auth signature already cached (no Freighter popup needed)? */
export function hasCachedAuth(wallet: VillagerWallet, gameId: string): boolean {
  return (
    localStorage.getItem(`gerald:psig:${DEPLOYMENT.token}:${gameId}:${wallet.address}`) !== null
  );
}

export const playerApi = {
  join: (w: VillagerWallet, game: string, name: string, character: string) =>
    playerCall<{ seat: number; name: string }>(w, game, "join", { name, character }),

  ready: (w: VillagerWallet, game: string, ready: boolean) =>
    playerCall<{ ready: boolean; readyCount: number; started: boolean }>(w, game, "ready", {
      ready,
    }),

  doneShopping: (w: VillagerWallet, game: string) =>
    playerCall<{ round: number }>(w, game, "done"),

  myRole: (w: VillagerWallet, game: string) =>
    playerCall<{ dealt: boolean; role: "villager" | "werebear" | null; name: string | null }>(
      w,
      game,
      "role",
    ),

  claimCharacter: (w: VillagerWallet, game: string, character: string) =>
    playerCall<{ character: string }>(w, game, "character", { character }),

  ask: (w: VillagerWallet, game: string, question: string) =>
    playerCall<{ answer: string; asker: string; round: number }>(w, game, "ask", { question }),

  vote: (w: VillagerWallet, game: string, target: string) =>
    playerCall<{ voted: string }>(w, game, "vote", { target }),

  nightPick: (w: VillagerWallet, game: string, target: string) =>
    playerCall<{ picked: string }>(w, game, "night-pick", { target }),
};

/** Public game view — no auth. */
export async function fetchPublicView(gameId: string): Promise<PublicView> {
  const resp = await fetch(`${AUDITOR_URL}/games/${encodeURIComponent(gameId)}/public`);
  const body = (await resp.json()) as PublicView & { error?: string };
  if (!resp.ok) throw new Error(body.error ?? `public: HTTP ${resp.status}`);
  return body;
}

/** Public graph — no auth, no amounts. */
export async function fetchGraph(gameId: string): Promise<GraphView> {
  const resp = await fetch(`${AUDITOR_URL}/games/${encodeURIComponent(gameId)}/graph`);
  const body = (await resp.json()) as GraphView & { error?: string };
  if (!resp.ok) throw new Error(body.error ?? `graph: HTTP ${resp.status}`);
  return body;
}

export interface PublicView {
  round: number;
  phase: "lobby" | "day" | "ended";
  dealt: boolean;
  winner: "village" | "werebear" | null;
  players: {
    seat: number;
    name: string;
    address: string;
    alive: boolean;
    character?: string | null;
    ready?: boolean;
    doneToday?: boolean;
    askedToday?: boolean;
  }[];
  readyCount?: number;
  minPlayers?: number;
  mornings: MorningReport[];
  incomeXlm: number;
}

export interface GraphView {
  round: number;
  players: { seat: number; name: string; address: string; alive: boolean }[];
  edges: { round: number; ledger: number; from: string; to: string }[];
}
