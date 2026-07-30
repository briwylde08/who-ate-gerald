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
  /** address → {round, ledger} of their "done shopping" declaration. */
  doneShopping: Record<string, { round: number; ledger: number }>;
  /** The town square chat — per-day threads, capped. */
  chat: { round: number; name: string; text: string; at: string }[];
  askLog: AskRecord[];
  /** This round's votes: voter address → target player name. */
  votes: Record<string, string>;
  /** This round's werebear pick: target player name, or null. */
  nightPick: string | null;
  /** Werebear wounded by a trap — its next night is skipped. */
  wounded: boolean;
  /** address → bearsbane already consumed. */
  baneConsumed: Record<string, boolean>;
  /** address → silver charms shattered (each purchase = one save). */
  charmUsed: Record<string, number>;
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
  doneShopping: {},
  chat: [],
  askLog: [],
  votes: {},
  nightPick: null,
  wounded: false,
  baneConsumed: {},
  charmUsed: {},
  venisonUsed: 0,
  mornings: [],
  phase: "lobby",
  winner: null,
  createdAt: new Date().toISOString(),
});

/** Minimum lobby size before ready-up can start the game (7 for the real thing). */
const MIN_PLAYERS = 3;

/** The clock: if the werebear survives the dusk of this day, it wins. */
const MAX_DAYS = 5;

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
    // Fairness is enforced on SPENDING, not wallet history: Maude decrypts
    // every purchase, and resolve-day flags anyone whose in-game spending
    // exceeds the allowance schedule. Any wallet may join; old balances are
    // dead weight.
    const existing = this.playerByAddress(address);
    const clash = this.state.players.find(
      (p) => p.name.toLowerCase() === cleanName.toLowerCase() && p.address !== address,
    );
    if (clash) throw new Error(`someone here is already called "${cleanName}" — pick another name`);
    const cleanCharacter = String(character).trim().slice(0, 32);
    if (cleanCharacter && this.characterTaken(cleanCharacter, address)) {
      throw new Error("that villager is already claimed — pick another face");
    }
    if (existing) {
      existing.name = cleanName;
      existing.character = cleanCharacter || existing.character;
      await this.persist();
      return { seat: existing.seat, name: existing.name };
    }
    const player: PlayerRef = {
      seat: this.state.players.length + 1,
      name: cleanName,
      address,
      alive: true,
      character: cleanCharacter || undefined,
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
    if (this.characterTaken(c, address)) {
      throw new Error("that villager is already claimed — pick another face");
    }
    player.character = c;
    await this.persist();
    return { character: c };
  }

  /** One face per game: is this character claimed by someone else? */
  private characterTaken(character: string, exceptAddress: string): boolean {
    return this.state.players.some(
      (p) => p.character === character && p.address !== exceptAddress,
    );
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

  /**
   * Declare the day's shopping finished (identity pre-verified). Locks your
   * stores and unlocks your Maude question — and records the ledger height,
   * so buying after "done" is provable at dawn.
   */
  async declareDone(address: string): Promise<{ round: number }> {
    this.requireDay();
    const player = this.playerByAddress(address);
    if (!player) throw new Error("that address holds no seat in this game");
    if (!player.alive) throw new Error("the dead are, by definition, done shopping");
    await syncIndexer(this.env);
    const ledger = await indexerLatestLedger(this.env);
    this.state.doneShopping[address] = { round: this.state.round, ledger };
    await this.persist();
    return { round: this.state.round };
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
    if (this.state.doneShopping[askerAddress]?.round !== this.state.round) {
      throw new Error(
        "Maude sees you mid-errand — finish your shopping first (declare Done in the Shops)",
      );
    }
    // The market closes for everyone at once: Maude opens her office only
    // when every living villager has finished shopping.
    const stillShopping = this.state.players.filter(
      (p) => p.alive && this.state.doneShopping[p.address]?.round !== this.state.round,
    );
    if (stillShopping.length > 0) {
      throw new Error(
        `the market is still open — Maude waits for ${stillShopping.map((p) => p.name).join(", ")}`,
      );
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

  /**
   * Cast/overwrite your vote for who the werebear is. Identity pre-verified.
   * Votes open once the market has closed; dawn comes by itself when the
   * last living vote and the werebear's pick are in.
   */
  async vote(voterAddress: string, targetName: string): Promise<{ voted: string; dawn: boolean }> {
    this.requireDay();
    this.requireUnresolved();
    if (!this.marketClosed()) {
      throw new Error("the market is still open — the trial begins when everyone is done shopping");
    }
    const voter = this.playerByAddress(voterAddress);
    if (!voter) throw new Error("that address holds no seat in this game");
    if (!voter.alive) throw new Error("the dead do not vote");
    const target = this.playerByName(targetName);
    if (!target || !target.alive) throw new Error(`no living player named "${targetName}"`);
    this.state.votes[voterAddress] = target.name;
    await this.persist();
    return { voted: target.name, dawn: await this.maybeResolve() };
  }

  /** The werebear's secret pick. Identity pre-verified; role checked here. */
  async nightPick(
    bearAddress: string,
    targetName: string,
  ): Promise<{ picked: string; dawn: boolean }> {
    this.requireDay();
    this.requireUnresolved();
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
    return { picked: target.name, dawn: await this.maybeResolve() };
  }

  /**
   * Town square chat (identity pre-verified). Opens when the market closes,
   * closes at dawn; the dead hold their peace. Say anything — convincing
   * people is the whole game.
   */
  async chat(address: string, text: string): Promise<{ posted: boolean }> {
    this.requireDay();
    this.requireUnresolved();
    if (!this.marketClosed()) {
      throw new Error("the square is empty until the market closes — finish shopping first");
    }
    const player = this.playerByAddress(address);
    if (!player) throw new Error("that address holds no seat in this game");
    if (!player.alive) throw new Error("the dead hold their peace");
    const clean = String(text).trim().slice(0, 280);
    if (!clean) throw new Error("say something or say nothing");
    this.state.chat.push({
      round: this.state.round,
      name: player.name,
      text: clean,
      at: new Date().toISOString(),
    });
    if (this.state.chat.length > 500) this.state.chat = this.state.chat.slice(-500);
    await this.persist();
    return { posted: true };
  }

  /** True once every living villager has finished today's shopping. */
  private marketClosed(): boolean {
    return (
      this.state.round >= 1 &&
      this.state.players
        .filter((p) => p.alive)
        .every((p) => this.state.doneShopping[p.address]?.round === this.state.round)
    );
  }

  /** Dawn already came for this round? */
  private requireUnresolved(): void {
    if (this.state.mornings.some((m) => m.round === this.state.round)) {
      throw new Error("dawn has already come — wait for the next day");
    }
  }

  /** Dawn comes by itself when the last vote and the bear's pick are in. */
  private async maybeResolve(): Promise<boolean> {
    const alive = this.state.players.filter((p) => p.alive);
    const allVoted = alive.every((p) => this.state.votes[p.address] !== undefined);
    const roles = this.state.roles ?? {};
    const bear = alive.find((p) => roles[p.address] === "werebear");
    const bearReady = !bear || this.state.nightPick !== null;
    if (allVoted && bearReady) {
      await this.resolveDay();
      return true;
    }
    return false;
  }

  /**
   * Close the day: tally the (knife-doubled) vote, banish, run the night
   * through the gear order, audit the rules, and publish the morning report.
   */
  async resolveDay(): Promise<MorningReport> {
    this.requireDay();
    this.requireUnresolved(); // one dawn per day (guards GM double-clicks too)
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
        notes.push(
          "⚒ Steel glinted at the trial: the tally counts more voices than hands. Somebody bought a hunting knife — ask the Blacksmith's door who visited.",
        );
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
    // Silver burns: the werebear that buys the charm wounds itself — the
    // charm rule stops being an honor system without leaking who the bear is.
    if (this.state.winner === null && bear?.alive && bearAddress) {
      if (boughtThisRound(bearAddress, "silver_charm")) {
        this.state.wounded = true;
        notes.push(
          "Someone in the village smells of burnt fur and shame. Honest metal does not forgive.",
        );
      }
    }
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
      } else if (
        this.countBought(purchases, target.address, "silver_charm") >
        (this.state.charmUsed[target.address] ?? 0)
      ) {
        // Silver is absolute — venison does not pierce it — but the charm
        // SHATTERS: one save per charm bought.
        this.state.charmUsed[target.address] =
          (this.state.charmUsed[target.address] ?? 0) + 1;
        announceFail(
          `${target.name} was attacked in the night — and stands at dawn among the shards of a silver charm. It shattered on the werebear's hide, and it will not save them twice.`,
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
          if (pierced) {
            this.state.venisonUsed += 1;
            // The victim is dead — their trap/bane is safe to name; the
            // venison line tells the village what BEAT it (bear-anonymous).
            notes.push(
              `🥩 ${target.name}'s defenses were ready — and useless: scraps of fresh venison at the scene. Something came prepared.`,
            );
          }
          if (hasTrap && !pierced) {
            this.state.wounded = true;
            notes.push(
              `🪤 ${target.name}'s bear trap snapped shut on something big: there is blood at the scene that does not belong to the victim.`,
            );
          }
          if (boughtEver(target.address, "lantern_oil")) {
            const fact = this.lanternFact(purchases, bearAddress);
            notes.push(`🏮 By ${target.name}'s still-lit lantern, Maude reads one true thing: ${fact}`);
          }
        }
      }
    }

    // --- AUDITS: the Order notices. ----------------------------------------
    // Deposit audit: deposits made DURING THIS GAME vs the allowance
    // schedule. Pre-game history is irrelevant (the Order's desk normalizes
    // balances and the spend audit caps usage) — this tripwire exists for
    // mid-game top-ups only.
    const deposits = await loadDeposits(this.env, this.state.rounds);
    const allowedTotal = stroopsFromXlm(STARTING_BUDGET_XLM + DAILY_INCOME_XLM * (round - 1));
    for (const p of this.state.players) {
      const depTotal = deposits
        .filter((d) => d.to === p.address && d.round >= 1)
        .reduce((a, d) => a + d.amountStroops, 0n);
      if (depTotal > allowedTotal) {
        violations.push(
          `${p.name} has deposited ${xlmString(depTotal)} XLM in total — the schedule allows ${xlmString(allowedTotal)} by day ${round}. The Order notices.`,
        );
      }
      // THE fairness audit: in-game spending vs the allowance schedule.
      // Surrenders to the Order don't count — that's old money going home.
      const spent = purchases
        .filter((x) => x.from === p.address && x.round >= 1 && !x.isSurrender)
        .reduce((a, x) => a + x.amountStroops, 0n);
      if (spent > allowedTotal) {
        violations.push(
          `${p.name} has spent ${xlmString(spent)} XLM this game — the allowance is ${xlmString(allowedTotal)} by day ${round}. Old money, new suspicion. The Order notices.`,
        );
      }
      // Budget normalization check: your FIRST purchase reveals (to Maude)
      // your balance going into it. Walking into the market holding more
      // than the schedule allows means you skipped the surrender.
      const firstBuy = purchases
        .filter((x) => x.from === p.address && x.round >= 1 && !x.isSurrender)
        .sort((a, b) => a.ledger - b.ledger)[0];
      if (firstBuy) {
        const preBalance = firstBuy.senderBalanceStroops + firstBuy.amountStroops;
        const allowedAtBuy = stroopsFromXlm(
          STARTING_BUDGET_XLM + DAILY_INCOME_XLM * (firstBuy.round - 1),
        );
        if (preBalance > allowedAtBuy) {
          violations.push(
            `${p.name} came to market carrying ${xlmString(preBalance)} XLM — the law allows ${xlmString(allowedAtBuy)}. Old coin must be surrendered to the Order before shopping.`,
          );
        }
      }
      const shopsVisited = new Set(
        purchases
          .filter((x) => x.from === p.address && x.round === round && x.shopId !== null)
          .map((x) => x.shopId),
      );
      if (shopsVisited.size > 2) {
        violations.push(
          `${p.name} visited ${shopsVisited.size} shops today — the village is small, but not that small. Two is the custom.`,
        );
      }
      // Shopping after declaring "done" is provable: the declaration pinned
      // a ledger height, and purchases carry theirs.
      const done = this.state.doneShopping[p.address];
      if (done?.round === round) {
        const lateBuys = purchases.filter(
          (x) => x.from === p.address && x.round === round && !x.isSurrender && x.ledger > done.ledger,
        ).length;
        if (lateBuys > 0) {
          violations.push(
            `${p.name} declared their shopping done, then bought ${lateBuys} more thing${lateBuys === 1 ? "" : "s"}. The Order notices little lies especially.`,
          );
        }
      }
    }

    // --- WIN CHECK: parity, then the clock. ---------------------------------
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
        } else if (round >= MAX_DAYS) {
          // The clock: outlast the village and the moon keeps its secret.
          this.state.winner = "werebear";
          this.state.phase = "ended";
          notes.push(
            `${MAX_DAYS} days, and the village never found it. The whispers were right all along — and they will stay whispers. The werebear has won.`,
          );
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
        doneToday: this.state.doneShopping[p.address]?.round === this.state.round,
        askedToday: (this.state.asked[p.address] ?? 0) >= this.state.round && this.state.round >= 1,
      })),
      readyCount: this.state.players.filter((p) => p.ready).length,
      minPlayers: MIN_PLAYERS,
      maxDays: MAX_DAYS,
      /** Maude's office opens only when every living villager is done shopping. */
      marketClosed:
        this.state.round >= 1 &&
        this.state.players
          .filter((p) => p.alive)
          .every((p) => this.state.doneShopping[p.address]?.round === this.state.round),
      stillShopping: this.state.players
        .filter((p) => p.alive && this.state.doneShopping[p.address]?.round !== this.state.round)
        .map((p) => p.name),
      /** Today's town-square thread (yesterday's arguments died at dawn). */
      chat: this.state.chat.filter((m) => m.round === this.state.round),
      // Players get the story; the Order's audit findings (violations) are
      // GM-only — resolve-day response + game state — announced at the GM's
      // discretion, in the GM's voice.
      mornings: this.state.mornings.map(({ violations: _violations, ...story }) => story),
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
