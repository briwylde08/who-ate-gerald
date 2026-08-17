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

/** The game this browser actually chose — null on a fresh browser, so the
 *  intro can tell a returning player from a brand-new one. */
export function storedGameId(): string | null {
  return localStorage.getItem(GAME_KEY);
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
  // Parse defensively: a Cloudflare 502/1101 is an HTML page, and resp.json()
  // throws on it BEFORE the !resp.ok branch below can produce a sane message.
  // Every player action routes through here, so that raw
  // "SyntaxError: Unexpected token '<'" reached the banner.
  const body = (await resp.json().catch(() => ({}))) as T & { error?: string };
  if (!resp.ok) {
    // A stale cached signature (e.g. worker auth scheme changed) → re-sign once.
    if (resp.status === 401) {
      localStorage.removeItem(`gerald:psig:${DEPLOYMENT.token}:${gameId}:${wallet.address}`);
      throw new Error(
        (body.error ?? "The village record-keeper does not recognize that signature") +
          " — press it again to re-sign.",
      );
    }
    throw new Error(
      body.error ?? "The village record-keeper isn't answering. Wait a moment and try again.",
    );
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

  chat: (w: VillagerWallet, game: string, text: string) =>
    playerCall<{ posted: boolean }>(w, game, "chat", { text }),

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
    playerCall<{ voted: string; dawn: boolean }>(w, game, "vote", { target }),

  nightPick: (w: VillagerWallet, game: string, target: string) =>
    playerCall<{ picked: string; dawn: boolean }>(w, game, "night-pick", { target }),

  /** Your own decrypted purchases — the server's answer to "what have I
   *  spent?", immune to fresh browsers and cleared storage. */
  myPurchases: (w: VillagerWallet, game: string) =>
    playerCall<ServerPurchases>(w, game, "purchases"),

  /** Private dawn facts — only ever your own. */
  notes: (w: VillagerWallet, game: string) =>
    playerCall<{ notes: { round: number; text: string }[] }>(w, game, "notes"),

  /** Point an aimed item (key, sock, bone, candle) at its victim. */
  aim: (w: VillagerWallet, game: string, item: string, target?: string, shop?: string) =>
    playerCall<{ aimed: string; at: string; result?: string }>(w, game, "aim", { item, target, shop }),
};

/** The notice-board: games in lobby phase, seating players right now. */
export interface OpenLobby {
  id: string;
  seated: number;
  ready: number;
  minPlayers: number;
}
export async function fetchLobbies(): Promise<OpenLobby[]> {
  const resp = await fetch(`${AUDITOR_URL}/lobbies`);
  const body = (await resp.json()) as { lobbies?: OpenLobby[] };
  return body.lobbies ?? [];
}

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
  /** The Order ended the game early — the bear won by default, not by play. */
  calledOff?: boolean;
  /** Revealed only once the game has a winner; null while roles are sealed. */
  bear?: string | null;
  players: {
    seat: number;
    name: string;
    address: string;
    alive: boolean;
    character?: string | null;
    ready?: boolean;
    doneToday?: boolean;
    askedToday?: boolean;
    recovering?: boolean;
    /** A ghost the Order granted a vote (Unquiet rest). */
    ghostVoter?: boolean;
    /** Declared a barrel today — cannot vote, cannot be killed tonight. */
    drunkToday?: boolean;
  }[];
  readyCount?: number;
  minPlayers?: number;
  /** Stores shut for everyone today (Shopkeeper's holiday). */
  closedShops?: string[];
  /** Who the trial is still waiting on. */
  awaitingVotes?: string[];
  /** Whether the night has been decided (never says by whom). */
  nightDecided?: boolean;
  /** True when every living villager has finished shopping — Maude opens. */
  marketClosed?: boolean;
  stillShopping?: string[];
  /** Today's town-square chat thread. */
  chat?: { round: number; name: string; text: string; at: string; ghost?: boolean }[];
  mornings: MorningReport[];
  incomeXlm: number;
}

export interface GraphView {
  round: number;
  players: { seat: number; name: string; address: string; alive: boolean }[];
  /** Public deposits by seated players — the visible side of the token. */
  deposits?: { round: number; ledger: number; txHash: string; player: string; amountXlm: string }[];
  edges: { round: number; ledger: number; txHash?: string; from: string; to: string }[];
}

export interface ServerPurchase {
  round: number;
  ledger: number;
  txHash: string;
  shopId: string | null;
  shopLabel: string;
  item: string | null;
  amountStroops: string;
  amountXlm: string;
}
export interface ServerPurchases {
  spentStroops: string;
  purchases: ServerPurchase[];
}

/** True when the browser tab is hidden — polls should sleep, not spend. */
export const pageHidden = (): boolean =>
  typeof document !== "undefined" && document.visibilityState === "hidden";
