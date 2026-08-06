/**
 * Client for the gerald-auditor worker (Maude McLedger) — GM tier. Player
 * endpoints live in player.ts; /graph and /public are public.
 */
import { AUDITOR_URL } from "./deployment";
import type { MorningReport } from "./types";

export interface GmConfig {
  gameId: string;
  token: string;
}

const CFG_KEY = "gerald:gm-config";

export function loadGmConfig(): GmConfig {
  try {
    const raw = localStorage.getItem(CFG_KEY);
    if (raw) return JSON.parse(raw) as GmConfig;
  } catch {
    /* fall through */
  }
  return { gameId: "playtest-1", token: "" };
}

export function saveGmConfig(cfg: GmConfig): void {
  localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
}

async function call<T>(
  cfg: GmConfig,
  action: string,
  init?: { method?: string; body?: unknown; auth?: boolean },
): Promise<T> {
  const headers: Record<string, string> = {};
  if (init?.auth !== false) headers.authorization = `Bearer ${cfg.token}`;
  if (init?.body !== undefined) headers["content-type"] = "application/json";
  const resp = await fetch(`${AUDITOR_URL}/games/${encodeURIComponent(cfg.gameId)}/${action}`, {
    method: init?.method ?? "POST",
    headers,
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const body = (await resp.json()) as T & { error?: string };
  if (!resp.ok) throw new Error(body.error ?? `${action}: HTTP ${resp.status}`);
  return body;
}

export interface RosterEntry {
  name: string;
  address: string;
}
export interface GmPlayer {
  seat: number;
  name: string;
  address: string;
  alive: boolean;
}

export interface GmGameState {
  players: GmPlayer[];
  round: number;
  phase: "lobby" | "day" | "ended";
  winner: "village" | "werebear" | null;
  roles: Record<string, "villager" | "werebear"> | null; // keyed by NAME — GM eyes only
  askLog: { round: number; asker: string; question: string; answer: string }[];
}

export interface GodView {
  round: number;
  phase: string;
  players: {
    seat: number;
    name: string;
    alive: boolean;
    role: string;
    purchases: { shop: string; amountXlm: string; item: string }[];
  }[];
  votes: { voter: string; target: string }[];
  nightPick: string | null;
  note: string;
}

export const gmApi = {
  newGame: (cfg: GmConfig, players: RosterEntry[], force: boolean) =>
    call<{ players: GmPlayer[] }>(cfg, "new", { body: { players, force } }),

  deal: (cfg: GmConfig, force = false) =>
    call<{ dealt: true; players: number }>(cfg, "deal", { body: { force } }),

  startDay: (cfg: GmConfig) =>
    call<{ round: number; startLedger: number; incomeXlm: number }>(cfg, "round/start", {
      body: {},
    }),

  eliminate: (cfg: GmConfig, player: string) =>
    call<{ player: string; alive: boolean }>(cfg, "eliminate", { body: { player } }),

  ask: (cfg: GmConfig, question: string, asker?: string) =>
    call<{
      answer: string;
      tool: string;
      args: Record<string, unknown>;
      fact: Record<string, unknown>;
      asker: string;
      round: number;
    }>(cfg, "ask", { body: { question, asker } }),

  resolveDay: (cfg: GmConfig) => call<MorningReport>(cfg, "resolve-day", { body: {} }),

  /** Stop a game in progress. Unmasks the bear rather than going quiet. */
  end: (cfg: GmConfig) => call<{ ended: true }>(cfg, "end", { body: {} }),

  godView: (cfg: GmConfig) => call<GodView>(cfg, "god-view", { method: "GET" }),

  graph: (cfg: GmConfig) =>
    call<{
      round: number;
      players: { seat: number; name: string; address: string; alive: boolean }[];
      edges: { round: number; ledger: number; from: string; to: string }[];
    }>(cfg, "graph", { method: "GET", auth: false }),

  state: (cfg: GmConfig) => call<GmGameState>(cfg, "state", { method: "GET" }),
};
