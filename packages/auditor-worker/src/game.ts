/**
 * One Durable Object per game — deliberately minimal for the moderated
 * playtest (the GM drives phases over a video call): roster, round windows
 * (ledger ranges), the one-question-per-round flag, and the ask log.
 * Full room/phase automation is a post-playtest project.
 */
import { DurableObject } from "cloudflare:workers";

import { answerQuestion, type AskOutcome } from "./ask";
import { CHAPEL_ID } from "./catalog";
import {
  indexerLatestLedger,
  loadPurchases,
  syncIndexer,
  type FactContext,
  type PlayerRef,
  type Purchase,
  type RoundWindow,
} from "./facts";
import type { Env } from "./env";

interface AskRecord {
  round: number;
  asker: string;
  question: string;
  tool: string;
  args: Record<string, unknown>;
  fact: Record<string, unknown>;
  answer: string;
  at: string;
}

interface GameState {
  players: PlayerRef[];
  /** 0 = lobby/setup; rounds are 1-based. */
  round: number;
  rounds: RoundWindow[];
  questionUsed: boolean;
  askLog: AskRecord[];
  createdAt: string;
}

const freshState = (): GameState => ({
  players: [],
  round: 0,
  rounds: [],
  questionUsed: false,
  askLog: [],
  createdAt: new Date().toISOString(),
});

export class GameRoom extends DurableObject<Env> {
  private state: GameState = freshState();
  private loaded = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      const stored = await ctx.storage.get<GameState>("state");
      if (stored) this.state = stored;
      this.loaded = true;
    });
  }

  private async persist(): Promise<void> {
    await this.ctx.storage.put("state", this.state);
  }

  /** Seat the roster. Refuses to clobber a game in progress unless forced. */
  async newGame(
    players: { name: string; address: string }[],
    force = false,
  ): Promise<{ players: PlayerRef[] }> {
    if (this.state.players.length > 0 && this.state.round > 0 && !force) {
      throw new Error("game already in progress — pass force:true to reset it");
    }
    if (!Array.isArray(players) || players.length < 2) {
      throw new Error("players must be a list of {name, address} (2+)");
    }
    const names = new Set<string>();
    for (const p of players) {
      if (!p?.name || !p?.address) throw new Error("each player needs name and address");
      const key = p.name.trim().toLowerCase();
      if (names.has(key)) throw new Error(`duplicate player name "${p.name}"`);
      names.add(key);
    }
    this.state = {
      ...freshState(),
      players: players.map((p, i) => ({
        seat: i + 1,
        name: p.name.trim(),
        address: p.address.trim(),
        alive: true,
      })),
    };
    await this.persist();
    return { players: this.state.players };
  }

  /**
   * Open the next round: everything on the ledger from here belongs to it.
   * Also resets the one-question seal and names the round's asker.
   */
  async startRound(): Promise<{ round: number; startLedger: number; asker: string }> {
    this.requireGame();
    await syncIndexer(this.env);
    const latest = await indexerLatestLedger(this.env);
    const startLedger = latest + 1;
    const prev = this.state.rounds.find((w) => w.round === this.state.round);
    if (prev && prev.endLedger === null) prev.endLedger = latest;
    this.state.round += 1;
    this.state.rounds.push({ round: this.state.round, startLedger, endLedger: null });
    this.state.questionUsed = false;
    await this.persist();
    return { round: this.state.round, startLedger, asker: this.suggestedAsker().name };
  }

  /** Mark a player eliminated (lynched or eaten). */
  async eliminate(playerName: string): Promise<{ player: string; alive: boolean }> {
    this.requireGame();
    const p = this.state.players.find(
      (x) => x.name.toLowerCase() === String(playerName).trim().toLowerCase(),
    );
    if (!p) throw new Error(`no player named "${playerName}"`);
    p.alive = false;
    await this.persist();
    return { player: p.name, alive: p.alive };
  }

  /** The round's ONE question to Maude. */
  async ask(question: string, asker?: string): Promise<AskOutcome & { asker: string; round: number }> {
    this.requireGame();
    if (this.state.round < 1) throw new Error("no round in progress — start round 1 first");
    if (this.state.questionUsed) {
      throw new Error("the seal is spent — one question per round (starts fresh next round)");
    }
    if (typeof question !== "string" || question.trim().length === 0) {
      throw new Error("question must be a non-empty string");
    }
    const who = (asker && asker.trim()) || this.suggestedAsker().name;

    await syncIndexer(this.env);
    const ctx = await this.factContext();
    const outcome = await answerQuestion(this.env, ctx, question.trim(), who);

    // Persist the spent seal BEFORE returning — a crash after the model call
    // must not grant a free second question.
    this.state.questionUsed = true;
    this.state.askLog.push({
      round: this.state.round,
      asker: who,
      question: question.trim(),
      tool: outcome.tool,
      args: outcome.args,
      fact: outcome.fact,
      answer: outcome.answer,
      at: new Date().toISOString(),
    });
    await this.persist();
    return { ...outcome, asker: who, round: this.state.round };
  }

  /**
   * GM god-view of the current round: every player's decrypted purchases and
   * tithes. Pure code — no LLM. The GM applies the night rules (the
   * tithe-encoding scheme is a printed rule, still being finalized).
   */
  async resolveNight(): Promise<Record<string, unknown>> {
    this.requireGame();
    if (this.state.round < 1) throw new Error("no round in progress");
    await syncIndexer(this.env);
    const purchases = await this.loadAll();
    const round = this.state.round;
    const inRound = purchases.filter((p) => p.round === round);

    const players = this.state.players.map((pl) => {
      const mine = inRound.filter((p) => p.from === pl.address);
      const shop = mine.filter((p) => p.shopId !== CHAPEL_ID);
      const tithes = mine.filter((p) => p.shopId === CHAPEL_ID);
      return {
        seat: pl.seat,
        name: pl.name,
        alive: pl.alive,
        purchases: shop.map((p) => ({
          shop: p.toLabel,
          amountXlm: p.amountXlm,
          item: p.itemGuess ?? "no exact price match",
        })),
        tithes: tithes.map((p) => p.amountXlm),
      };
    });
    const strangers = inRound
      .filter((p) => p.player === null)
      .map((p) => ({ from: p.from, to: p.toLabel, amountXlm: p.amountXlm }));

    return {
      round,
      players,
      strangers,
      note: "GM-only. Apply the printed tithe rule to pick the victim; itemGuess is an exact catalog-price match.",
    };
  }

  /** Public payment graph — who paid whom, NO amounts. Spectator-safe. */
  async graphView(): Promise<Record<string, unknown>> {
    const purchases = await this.loadAll();
    return {
      round: this.state.round,
      players: this.state.players.map((p) => ({ seat: p.seat, name: p.name, alive: p.alive })),
      edges: purchases.map((p) => ({
        round: p.round,
        ledger: p.ledger,
        from: p.player ?? `${p.from.slice(0, 4)}…${p.from.slice(-4)}`,
        to: p.toLabel,
      })),
    };
  }

  /** GM debug view of the stored state (no decryption). */
  async getState(): Promise<GameState & { suggestedAsker: string | null }> {
    return {
      ...this.state,
      suggestedAsker: this.state.players.length > 0 ? this.suggestedAsker().name : null,
    };
  }

  // -------------------------------------------------------------------------

  private requireGame(): void {
    if (!this.loaded) throw new Error("state not loaded"); // unreachable after blockConcurrencyWhile
    if (this.state.players.length === 0) throw new Error("no game here — POST /new with the roster first");
  }

  /** Rotating asker: alive players by seat, round-robin from round 1. */
  private suggestedAsker(): PlayerRef {
    const alive = this.state.players.filter((p) => p.alive).sort((a, b) => a.seat - b.seat);
    const pool = alive.length > 0 ? alive : this.state.players;
    return pool[Math.max(0, this.state.round - 1) % pool.length]!;
  }

  private async loadAll(): Promise<Purchase[]> {
    return loadPurchases(this.env, this.state.players, this.state.rounds);
  }

  private async factContext(): Promise<FactContext> {
    return {
      purchases: await this.loadAll(),
      players: this.state.players,
      currentRound: this.state.round,
    };
  }
}
