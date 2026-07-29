/**
 * One Durable Object per game — v2 (DESIGN-V2.md): the game runs itself.
 * The DO deals roles, enforces one private Maude question per player per
 * day, collects votes and the werebear's night pick, and resolves each
 * morning in code (knife-doubled tallies, gear order: venison > bane/trap,
 * musk > announcement, charm saves the life). The GM still opens days and
 * pulls the resolve lever; timers can replace the lever later.
 */
import { DurableObject } from "cloudflare:workers";

import { answerQuestion, type AskOutcome } from "./ask";
import { SHOP_BY_ID, stroopsFromXlm, xlmString, STARTING_BUDGET_XLM, DAILY_INCOME_XLM } from "./catalog";
import {
  indexerLatestLedger,
  loadDeposits,
  loadPurchases,
  syncIndexer,
  walletHistory,
  type FactContext,
  type PlayerRef,
  type Purchase,
  type RoundWindow,
} from "./facts";
import type { Env } from "./env";

type Role = "villager" | "werebear";

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

/** Public morning bulletin — everything the whole village learns at dawn. */
export interface MorningReport {
  round: number;
  banished: string | null;
  banishedRole: Role | null;
  eaten: string | null;
  /** "quiet night" reasons stay vague on purpose. */
  notes: string[];
  violations: string[];
  winner: "village" | "werebear" | null;
  at: string;
}

interface GameState {
  players: PlayerRef[];
  /** address → role; null until dealt. NEVER returned except via my-role/GM state. */
  roles: Record<string, Role> | null;
  round: number; // 0 = lobby; rounds are game days
  rounds: RoundWindow[];
  /** address → last round in which they spent their Maude seal. */
  asked: Record<string, number>;
  askLog: AskRecord[];
  /** This round's votes: voter address → target player name. */
  votes: Record<string, string>;
  /** This round's werebear pick: target player name, or null. */
  nightPick: string | null;
  /** Werebear wounded by a trap — its next night is skipped. */
  wounded: boolean;
  /** address → bearsbane already consumed. */
  baneConsumed: Record<string, boolean>;
  /** Pierces spent — each venison purchase grants exactly one. */
  venisonUsed: number;
  mornings: MorningReport[];
  phase: "lobby" | "day" | "ended";
  winner: "village" | "werebear" | null;
  createdAt: string;
}

const freshState = (): GameState => ({
  players: [],
  roles: null,
  round: 0,
  rounds: [],
  asked: {},
  askLog: [],
  votes: {},
  nightPick: null,
  wounded: false,
  baneConsumed: {},
  venisonUsed: 0,
  mornings: [],
  phase: "lobby",
  winner: null,
  createdAt: new Date().toISOString(),
});

/** Minimum lobby size before ready-up can start the game (7 for the real thing). */
const MIN_PLAYERS = 3;

/** itemId → { shopId, price } for gear checks (prices are globally unique). */
const ITEM_INDEX = new Map<string, { shopId: string; price: bigint }>();
for (const shop of SHOP_BY_ID.values()) {
  for (const item of shop.items) {
    ITEM_INDEX.set(item.id, { shopId: shop.id, price: stroopsFromXlm(item.priceXlm) });
  }
}

export class GameRoom extends DurableObject<Env> {
  private state: GameState = freshState();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      const stored = await ctx.storage.get<GameState>("state");
      if (stored) this.state = { ...freshState(), ...stored };
    });
  }

  private async persist(): Promise<void> {
    await this.ctx.storage.put("state", this.state);
  }

  // -------------------------------------------------------------- lobby --

  /** Seat the roster. Refuses to clobber a game in progress unless forced. */
  async newGame(
    players: { name: string; address: string }[],
    force = false,
  ): Promise<{ players: PlayerRef[] }> {
    if (this.state.players.length > 0 && this.state.round > 0 && !force) {
      throw new Error("game already in progress — pass force:true to reset it");
    }
    if (!Array.isArray(players) || players.length < 3) {
      throw new Error("players must be a list of {name, address} (3+; 7 recommended)");
    }
    const names = new Set<string>();
    const addresses = new Set<string>();
    for (const p of players) {
      if (!p?.name || !p?.address) throw new Error("each player needs name and address");
      const key = p.name.trim().toLowerCase();
      if (names.has(key)) throw new Error(`duplicate player name "${p.name}"`);
      if (addresses.has(p.address.trim())) throw new Error(`duplicate address for "${p.name}"`);
      names.add(key);
      addresses.add(p.address.trim());
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
   * Self-serve lobby join — the app calls this after name + character are
   * chosen (identity pre-verified). Idempotent per address; open until the
   * roles are dealt.
   */
  async join(
    address: string,
    name: string,
    character: string,
  ): Promise<{ seat: number; name: string }> {
    if (this.state.roles) throw new Error("the game is already underway — join the next one");
    const cleanName = String(name).trim().slice(0, 24);
    if (!cleanName) throw new Error("a villager needs a name");
    // FAIRNESS GATE: everyone starts with the same spendable budget. Deposits
    // are public by protocol, so a wallet's history is checkable by anyone:
    // a fresh player has at most the starting buy-in deposited and has spent
    // nothing. Old, rich, or busy wallets are turned away at the door.
    if (!this.playerByAddress(address)) {
      await syncIndexer(this.env);
      const history = await walletHistory(this.env, address);
      const maxBuyIn = stroopsFromXlm(STARTING_BUDGET_XLM);
      if (history.depositTotal > maxBuyIn || history.sentTransfers > 0) {
        throw new Error(
          `this wallet has a past (${xlmString(history.depositTotal)} XLM deposited, ${history.sentTransfers} payments made) — the village only admits fresh accounts, so everyone verifiably starts with ${STARTING_BUDGET_XLM} XLM. Switch accounts in Freighter and rejoin.`,
        );
      }
    }
    const existing = this.playerByAddress(address);
    const clash = this.state.players.find(
      (p) => p.name.toLowerCase() === cleanName.toLowerCase() && p.address !== address,
    );
    if (clash) throw new Error(`someone here is already called "${cleanName}" — pick another name`);
    if (existing) {
      existing.name = cleanName;
      existing.character = String(character).trim().slice(0, 32) || existing.character;
      await this.persist();
      return { seat: existing.seat, name: existing.name };
    }
    const player: PlayerRef = {
      seat: this.state.players.length + 1,
      name: cleanName,
      address,
      alive: true,
      character: String(character).trim().slice(0, 32) || undefined,
    };
    this.state.players.push(player);
    await this.persist();
    return { seat: player.seat, name: player.name };
  }

  /**
   * Ready-up (identity pre-verified). When everyone seated is ready and the
   * lobby has reached quorum, the game starts itself: roles dealt, day 1 open.
   */
  async setReady(
    address: string,
    ready: boolean,
  ): Promise<{ ready: boolean; readyCount: number; started: boolean }> {
    if (this.state.roles) throw new Error("the game is already underway");
    const player = this.playerByAddress(address);
    if (!player) throw new Error("join the village before readying up");
    player.ready = ready;
    await this.persist();
    const readyCount = this.state.players.filter((p) => p.ready).length;
    const everyoneReady =
      this.state.players.length >= MIN_PLAYERS &&
      this.state.players.every((p) => p.ready === true);
    if (ready && everyoneReady) {
      await this.deal(false);
      await this.startDay();
      return { ready, readyCount, started: true };
    }
    return { ready, readyCount, started: false };
  }

  /** Deal roles: one werebear among the seated, chosen by real randomness. */
  async deal(force = false): Promise<{ dealt: true; players: number }> {
    this.requireGame();
    if (this.state.players.length < MIN_PLAYERS) {
      throw new Error(
        `only ${this.state.players.length} seated — the village needs at least ${MIN_PLAYERS}`,
      );
    }
    if (this.state.roles && !force) throw new Error("roles already dealt — pass force:true to re-deal");
    if (this.state.round > 0 && !force) throw new Error("game already started");
    const idx = new Uint32Array(1);
    crypto.getRandomValues(idx);
    const bearSeat = idx[0]! % this.state.players.length;
    const roles: Record<string, Role> = {};
    this.state.players.forEach((p, i) => {
      roles[p.address] = i === bearSeat ? "werebear" : "villager";
    });
    this.state.roles = roles;
    await this.persist();
    return { dealt: true, players: this.state.players.length };
  }

  /** Private role fetch — the "notification". Caller identity pre-verified. */
  async myRole(address: string): Promise<{ dealt: boolean; role: Role | null; name: string | null }> {
    const player = this.playerByAddress(address);
    if (!player) throw new Error("that address holds no seat in this game");
    if (!this.state.roles) return { dealt: false, role: null, name: player.name };
    return { dealt: true, role: this.state.roles[address] ?? "villager", name: player.name };
  }

  /** Claim a cosmetic character so the whole village can see who's who. */
  async claimCharacter(address: string, character: string): Promise<{ character: string }> {
    const player = this.playerByAddress(address);
    if (!player) throw new Error("that address holds no seat in this game");
    const c = String(character).trim().slice(0, 32);
    if (!c) throw new Error("character must be a non-empty id");
    player.character = c;
    await this.persist();
    return { character: c };
  }

  // ---------------------------------------------------------------- days --

  /** Open the next day: new ledger window, fresh seals, cleared votes. */
  async startDay(): Promise<{ round: number; startLedger: number; incomeXlm: number }> {
    this.requireGame();
    if (!this.state.roles) throw new Error("deal roles first (POST /deal)");
    if (this.state.phase === "ended") throw new Error(`game over — ${this.state.winner} won`);
    await syncIndexer(this.env);
    const latest = await indexerLatestLedger(this.env);
    const startLedger = latest + 1;
    const prev = this.state.rounds.find((w) => w.round === this.state.round);
    if (prev && prev.endLedger === null) prev.endLedger = latest;
    this.state.round += 1;
    this.state.rounds.push({ round: this.state.round, startLedger, endLedger: null });
    this.state.votes = {};
    this.state.nightPick = null;
    this.state.phase = "day";
    await this.persist();
    return {
      round: this.state.round,
      startLedger,
      incomeXlm: this.state.round === 1 ? STARTING_BUDGET_XLM : DAILY_INCOME_XLM,
    };
  }

  /** Manual GM override (mis-clicks, house rules). */
  async eliminate(playerName: string): Promise<{ player: string; alive: boolean }> {
    this.requireGame();
    const p = this.playerByName(playerName);
    if (!p) throw new Error(`no player named "${playerName}"`);
    p.alive = false;
    await this.persist();
    return { player: p.name, alive: p.alive };
  }

  // --------------------------------------------------------------- maude --

  /** One private question per living player per day. Identity pre-verified. */
  async ask(
    question: string,
    askerAddress: string,
  ): Promise<AskOutcome & { asker: string; round: number }> {
    this.requireGame();
    if (this.state.round < 1) throw new Error("no day in progress — the village still sleeps");
    const player = this.playerByAddress(askerAddress);
    if (!player) throw new Error("that address holds no seat in this game");
    if (!player.alive) throw new Error("the dead ask no questions");
    if ((this.state.asked[askerAddress] ?? 0) >= this.state.round) {
      throw new Error("your seal is spent — one question per villager per day");
    }
    if (typeof question !== "string" || question.trim().length === 0) {
      throw new Error("question must be a non-empty string");
    }

    await syncIndexer(this.env);
    const ctx = await this.factContext();
    const outcome = await answerQuestion(this.env, ctx, question.trim(), player.name);

    // Spend the seal BEFORE returning — a crash must not grant a free retry.
    this.state.asked[askerAddress] = this.state.round;
    this.state.askLog.push({
      round: this.state.round,
      asker: player.name,
      question: question.trim(),
      tool: outcome.tool,
      args: outcome.args,
      fact: outcome.fact,
      answer: outcome.answer,
      at: new Date().toISOString(),
    });
    await this.persist();
    return { ...outcome, asker: player.name, round: this.state.round };
  }

  /** GM ask console — unchanged from v1 (moderated fallback / testing). */
  async gmAsk(
    question: string,
    asker?: string,
  ): Promise<AskOutcome & { asker: string; round: number }> {
    this.requireGame();
    if (this.state.round < 1) throw new Error("no day in progress");
    const who = (asker && asker.trim()) || "the GM";
    await syncIndexer(this.env);
    const ctx = await this.factContext();
    const outcome = await answerQuestion(this.env, ctx, question.trim(), who);
    this.state.askLog.push({
      round: this.state.round,
      asker: `${who} (GM console)`,
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

  // --------------------------------------------------- votes & the night --

  /** Cast/overwrite your vote for who the werebear is. Identity pre-verified. */
  async vote(voterAddress: string, targetName: string): Promise<{ voted: string }> {
    this.requireDay();
    const voter = this.playerByAddress(voterAddress);
    if (!voter) throw new Error("that address holds no seat in this game");
    if (!voter.alive) throw new Error("the dead do not vote");
    const target = this.playerByName(targetName);
    if (!target || !target.alive) throw new Error(`no living player named "${targetName}"`);
    this.state.votes[voterAddress] = target.name;
    await this.persist();
    return { voted: target.name };
  }

  /** The werebear's secret pick. Identity pre-verified; role checked here. */
  async nightPick(bearAddress: string, targetName: string): Promise<{ picked: string }> {
    this.requireDay();
    if (this.state.roles?.[bearAddress] !== "werebear") {
      throw new Error("only the werebear hunts"); // and now the worker knows you tried
    }
    const bear = this.playerByAddress(bearAddress);
    if (!bear?.alive) throw new Error("the banished do not hunt");
    const target = this.playerByName(targetName);
    if (!target || !target.alive) throw new Error(`no living player named "${targetName}"`);
    if (target.address === bearAddress) throw new Error("you cannot eat yourself");
    this.state.nightPick = target.name;
    await this.persist();
    return { picked: target.name };
  }

  /**
   * Close the day: tally the (knife-doubled) vote, banish, run the night
   * through the gear order, audit the rules, and publish the morning report.
   */
  async resolveDay(): Promise<MorningReport> {
    this.requireDay();
    const round = this.state.round;
    await syncIndexer(this.env);
    const purchases = await this.loadAll();
    const roles = this.state.roles!;
    const notes: string[] = [];
    const violations: string[] = [];

    const boughtThisRound = (address: string, itemId: string): boolean =>
      this.bought(purchases, address, itemId, { round });
    const boughtEver = (address: string, itemId: string): boolean =>
      this.bought(purchases, address, itemId, {});

    // --- TRIAL: knife-doubled plurality; barrel drinkers can't vote. -------
    const weights = new Map<string, number>();
    for (const [voterAddr, targetName] of Object.entries(this.state.votes)) {
      const voter = this.playerByAddress(voterAddr);
      if (!voter?.alive) continue;
      if (boughtThisRound(voterAddr, "the_good_barrel")) {
        notes.push(`${voter.name}'s vote never arrived. (Someone was singing in the square.)`);
        continue;
      }
      const weight = boughtThisRound(voterAddr, "hunting_knife") ? 2 : 1;
      weights.set(targetName, (weights.get(targetName) ?? 0) + weight);
    }
    let banished: PlayerRef | null = null;
    if (weights.size > 0) {
      const max = Math.max(...weights.values());
      const top = [...weights.entries()].filter(([, w]) => w === max).map(([n]) => n);
      if (top.length === 1) banished = this.playerByName(top[0]!) ?? null;
      else notes.push("The vote tied. The village dithered. Somewhere, something licked its chops.");
    } else {
      notes.push("Nobody voted. Gerald would be disappointed, if he still had opinions.");
    }
    let banishedRole: Role | null = null;
    if (banished) {
      banished.alive = false;
      banishedRole = roles[banished.address] ?? "villager";
      const totalWeight = [...weights.values()].reduce((a, b) => a + b, 0);
      const voterCount = Object.keys(this.state.votes).length;
      if (totalWeight > voterCount) {
        notes.push("The tally does not add up to the hands raised. Somebody voted with a knife.");
      }
      if (banishedRole === "werebear") {
        this.state.winner = "village";
        this.state.phase = "ended";
      }
    }

    // --- NIGHT: the pick through the gear order. ---------------------------
    let eaten: PlayerRef | null = null;
    const bearAddress = Object.entries(roles).find(([, r]) => r === "werebear")?.[0];
    const bear = bearAddress ? this.playerByAddress(bearAddress) : null;
    if (this.state.winner === null && bear?.alive && bearAddress) {
      const target = this.state.nightPick ? this.playerByName(this.state.nightPick) : null;
      const muskTonight = boughtThisRound(bearAddress, "musk_salve");
      const announceFail = (line: string) => {
        if (!muskTonight) notes.push(line);
      };
      if (this.state.wounded) {
        this.state.wounded = false;
        notes.push("A quiet night. Something large limped past the mill and took nothing.");
      } else if (!target || !target.alive) {
        notes.push("A quiet night.");
      } else if (boughtThisRound(target.address, "the_good_barrel")) {
        announceFail("A quiet night — though something scratched at a door and gave up.");
      } else if (boughtEver(target.address, "silver_charm")) {
        // Silver is absolute — venison does not pierce it.
        announceFail(
          `${target.name} was attacked in the night — and stands at dawn, silver charm scorched. The werebear burned itself on honest metal.`,
        );
        if (muskTonight) notes.push("A quiet night."); // musk hides even a silver save
      } else {
        const hasBane =
          boughtEver(target.address, "bearsbane_tincture") && !this.state.baneConsumed[target.address];
        const hasTrap = boughtEver(target.address, "bear_trap");
        // Each venison purchase grants exactly ONE pierce, spent only when
        // there is actually bane or a trap to pierce.
        const venisonAvailable =
          this.countBought(purchases, bearAddress, "fresh_venison") > this.state.venisonUsed;
        const pierced = (hasBane || hasTrap) && venisonAvailable;
        if (hasBane && !pierced) {
          this.state.baneConsumed[target.address] = true;
          // Bearsbane is SILENT by design — the village sees only a quiet night.
          notes.push("A quiet night.");
        } else {
          eaten = target;
          target.alive = false;
          if (pierced) this.state.venisonUsed += 1;
          if (hasTrap && !pierced) {
            this.state.wounded = true;
            notes.push("There is blood at the scene that does not belong to the victim.");
          }
          if (boughtEver(target.address, "lantern_oil")) {
            const fact = this.lanternFact(purchases, bearAddress);
            notes.push(`By lantern light, Maude reads one true thing: ${fact}`);
          }
        }
      }
    }

    // --- AUDITS: the Order notices. ----------------------------------------
    // Cumulative deposit audit: lifetime deposits vs the full allowance
    // schedule (50 buy-in + 15/day). Cumulative, so nothing slips between
    // round windows or into the lobby.
    const deposits = await loadDeposits(this.env, this.state.rounds);
    const allowedTotal = stroopsFromXlm(STARTING_BUDGET_XLM + DAILY_INCOME_XLM * (round - 1));
    for (const p of this.state.players) {
      const depTotal = deposits
        .filter((d) => d.to === p.address)
        .reduce((a, d) => a + d.amountStroops, 0n);
      if (depTotal > allowedTotal) {
        violations.push(
          `${p.name} has deposited ${xlmString(depTotal)} XLM in total — the schedule allows ${xlmString(allowedTotal)} by day ${round}. The Order notices.`,
        );
      }
      const shopsVisited = new Set(
        purchases.filter((x) => x.from === p.address && x.round === round).map((x) => x.shopId),
      );
      if (shopsVisited.size > 2) {
        violations.push(
          `${p.name} visited ${shopsVisited.size} shops today — the village is small, but not that small. Two is the custom.`,
        );
      }
    }

    // --- WIN CHECK: parity. -------------------------------------------------
    if (this.state.winner === null && bear) {
      if (!bear.alive) {
        this.state.winner = "village";
        this.state.phase = "ended";
      } else {
        const livingVillagers = this.state.players.filter(
          (p) => p.alive && roles[p.address] !== "werebear",
        ).length;
        if (livingVillagers <= 1) {
          this.state.winner = "werebear";
          this.state.phase = "ended";
        }
      }
    }

    const report: MorningReport = {
      round,
      banished: banished?.name ?? null,
      banishedRole,
      eaten: eaten?.name ?? null,
      notes,
      violations,
      winner: this.state.winner,
      at: new Date().toISOString(),
    };
    this.state.mornings.push(report);
    if (this.state.phase !== "ended") this.state.phase = "day"; // stays until next startDay
    await this.persist();
    return report;
  }

  // -------------------------------------------------------------- public --

  /** Public game view — safe for every player and spectator. */
  async publicView(): Promise<Record<string, unknown>> {
    return {
      round: this.state.round,
      phase: this.state.phase,
      dealt: this.state.roles !== null,
      winner: this.state.winner,
      players: this.state.players.map((p) => ({
        seat: p.seat,
        name: p.name,
        address: p.address, // public on-chain anyway; lets the app find itself
        alive: p.alive,
        character: p.character ?? null,
        ready: p.ready === true,
      })),
      readyCount: this.state.players.filter((p) => p.ready).length,
      minPlayers: MIN_PLAYERS,
      mornings: this.state.mornings,
      incomeXlm: this.state.round <= 1 ? STARTING_BUDGET_XLM : DAILY_INCOME_XLM,
    };
  }

  /** Public payment graph — who paid whom, NO amounts. Spectator-safe. */
  async graphView(): Promise<Record<string, unknown>> {
    const purchases = await this.loadAll();
    return {
      round: this.state.round,
      players: this.state.players.map((p) => ({
        seat: p.seat,
        name: p.name,
        address: p.address,
        alive: p.alive,
      })),
      edges: purchases.map((p) => ({
        round: p.round,
        ledger: p.ledger,
        from: p.player ?? `${p.from.slice(0, 4)}…${p.from.slice(-4)}`,
        to: p.toLabel,
      })),
    };
  }

  /** GM god-view of the current round: decrypted purchases + votes + pick. */
  async godView(): Promise<Record<string, unknown>> {
    this.requireGame();
    await syncIndexer(this.env);
    const purchases = await this.loadAll();
    const round = this.state.round;
    const roles = this.state.roles;
    return {
      round,
      phase: this.state.phase,
      players: this.state.players.map((pl) => ({
        seat: pl.seat,
        name: pl.name,
        alive: pl.alive,
        role: roles?.[pl.address] ?? "undealt",
        purchases: purchases
          .filter((p) => p.from === pl.address && p.round === round)
          .map((p) => ({ shop: p.toLabel, amountXlm: p.amountXlm, item: p.itemGuess ?? "no exact match" })),
      })),
      votes: Object.entries(this.state.votes).map(([addr, target]) => ({
        voter: this.playerByAddress(addr)?.name ?? addr.slice(0, 6),
        target,
      })),
      nightPick: this.state.nightPick,
      wounded: this.state.wounded,
      venisonUsed: this.state.venisonUsed,
      baneConsumed: Object.keys(this.state.baneConsumed).map(
        (a) => this.playerByAddress(a)?.name ?? a.slice(0, 6),
      ),
      note: "GM eyes only. Never screen-share this panel.",
    };
  }

  /** GM debug view (roles included — GM eyes only). */
  async getState(): Promise<Record<string, unknown>> {
    return {
      ...this.state,
      roles: this.state.roles
        ? Object.fromEntries(
            Object.entries(this.state.roles).map(([a, r]) => [
              this.playerByAddress(a)?.name ?? a,
              r,
            ]),
          )
        : null,
    };
  }

  // ------------------------------------------------------------- helpers --

  private requireGame(): void {
    if (this.state.players.length === 0) {
      throw new Error("no game here — POST /new with the roster first");
    }
  }

  private requireDay(): void {
    this.requireGame();
    if (!this.state.roles) throw new Error("roles not dealt yet");
    if (this.state.phase === "ended") throw new Error(`game over — ${this.state.winner} won`);
    if (this.state.round < 1) throw new Error("no day in progress");
  }

  private playerByAddress(address: string): PlayerRef | null {
    return this.state.players.find((p) => p.address === address) ?? null;
  }

  private playerByName(name: string): PlayerRef | null {
    return (
      this.state.players.find((p) => p.name.toLowerCase() === String(name).trim().toLowerCase()) ??
      null
    );
  }

  /** Did `address` pay a shop exactly one item's price (optionally in one round)? */
  private bought(
    purchases: Purchase[],
    address: string,
    itemId: string,
    opts: { round?: number },
  ): boolean {
    return this.countBought(purchases, address, itemId, opts) > 0;
  }

  /** How many times `address` bought one item (optionally in one round). */
  private countBought(
    purchases: Purchase[],
    address: string,
    itemId: string,
    opts: { round?: number } = {},
  ): number {
    const item = ITEM_INDEX.get(itemId);
    if (!item) return 0;
    return purchases.filter(
      (p) =>
        p.from === address &&
        p.shopId === item.shopId &&
        p.amountStroops === item.price &&
        (opts.round === undefined ? p.round >= 1 : p.round === opts.round),
    ).length;
  }

  /** Lantern oil's dying gift: one true, bear-anonymous fact from the ledger. */
  private lanternFact(purchases: Purchase[], bearAddress: string): string {
    const bearBuys = purchases
      .filter((p) => p.from === bearAddress && p.round >= 1)
      .sort((a, b) => b.ledger - a.ledger);
    const latest = bearBuys[0];
    if (!latest) return "the werebear has not spent a single coin since Gerald died. Frugal, for a monster.";
    return `the werebear's most recent purchase was at the ${latest.toLabel}: ${
      latest.itemGuess ? `the ${latest.itemGuess.toLowerCase()}` : `${latest.amountXlm} XLM of something`
    }.`;
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
