import { DurableObject } from "cloudflare:workers";

import type { Env } from "./env";

/**
 * The town notice-board: a single well-known Durable Object that remembers
 * which game ids exist, because per-game DOs cannot be enumerated. The front
 * door touches it on every join; the /lobbies route reads it and then asks
 * each game's own DO for live truth, so this registry never needs to be more
 * than a list of names.
 *
 * Games whose id starts with "private" never appear — the escape hatch for
 * a table that would rather share its id the old way.
 */

interface Entry {
  createdAt: number;
  touchedAt: number;
}

/** Registry entries older than this are pruned — a lobby nobody joined in
 *  two days is a ghost town, not a game. */
const MAX_AGE_MS = 48 * 60 * 60 * 1000;

export class LobbyRegistry extends DurableObject<Env> {
  private games: Record<string, Entry> = {};

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.games = (await ctx.storage.get<Record<string, Entry>>("games")) ?? {};
    });
  }

  private async persist(): Promise<void> {
    await this.ctx.storage.put("games", this.games);
  }

  /** A join happened here — remember the id. */
  async touch(gameId: string): Promise<void> {
    if (gameId.toLowerCase().startsWith("private")) return;
    const now = Date.now();
    const entry = this.games[gameId];
    if (entry) entry.touchedAt = now;
    else this.games[gameId] = { createdAt: now, touchedAt: now };
    await this.persist();
  }

  /** The game started or ended — no longer lobby material. */
  async remove(gameId: string): Promise<void> {
    if (this.games[gameId]) {
      delete this.games[gameId];
      await this.persist();
    }
  }

  /** Known ids, newest first, stale ones pruned. */
  async list(): Promise<string[]> {
    const now = Date.now();
    let dirty = false;
    for (const [id, e] of Object.entries(this.games)) {
      if (now - e.touchedAt > MAX_AGE_MS) {
        delete this.games[id];
        dirty = true;
      }
    }
    if (dirty) await this.persist();
    return Object.entries(this.games)
      .sort((a, b) => b[1].touchedAt - a[1].touchedAt)
      .map(([id]) => id);
  }
}
