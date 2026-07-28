/**
 * Client for the gerald-auditor worker (Maude McLedger). GM endpoints need
 * the bearer token; /graph is public.
 */
import { AUDITOR_URL } from "./deployment";

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

export const gmApi = {
  newGame: (cfg: GmConfig, players: RosterEntry[], force: boolean) =>
    call<{ players: GmPlayer[] }>(cfg, "new", { body: { players, force } }),

  startRound: (cfg: GmConfig) =>
    call<{ round: number; startLedger: number; asker: string }>(cfg, "round/start", { body: {} }),

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

  resolveNight: (cfg: GmConfig) =>
    call<{
      round: number;
      players: {
        seat: number;
        name: string;
        alive: boolean;
        purchases: { shop: string; amountXlm: string; item: string }[];
        tithes: string[];
      }[];
      strangers: { from: string; to: string; amountXlm: string }[];
      note: string;
    }>(cfg, "resolve-night", { body: {} }),

  graph: (cfg: GmConfig) =>
    call<{
      round: number;
      players: { seat: number; name: string; alive: boolean }[];
      edges: { round: number; ledger: number; from: string; to: string }[];
    }>(cfg, "graph", { method: "GET", auth: false }),

  state: (cfg: GmConfig) =>
    call<{
      players: GmPlayer[];
      round: number;
      questionUsed: boolean;
      suggestedAsker: string | null;
      askLog: { round: number; asker: string; question: string; answer: string }[];
    }>(cfg, "state", { method: "GET" }),
};
