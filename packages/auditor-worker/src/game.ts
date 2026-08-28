/**
 * One Durable Object per game: the game runs itself. The DO deals roles,
 * enforces one private Maude question per player per day, collects votes and
 * the werebear's night pick, and resolves each morning in code — knife-doubled
 * tallies, nail tie-excusals, socked mouths, the curfew bell, barred doors,
 * and the dawn readings. Days open themselves on a 60s alarm.
 *
 * The shelf these rules act on is config/catalog.json; docs/CATALOG.md
 * explains why each ware exists. Retired shelves live in git history, not in
 * parallel files — so this comment names no catalog version, and
 * `npm run test:catalog` checks that every item the rules act on is still
 * sold.
 */
import { DurableObject } from "cloudflare:workers";

import { answerQuestion, type AskOutcome } from "./ask";
import { SHOP_BY_ID, ORDER_ADDRESS, stroopsFromXlm, xlmString, STARTING_BUDGET_XLM, DAILY_INCOME_XLM } from "./catalog";
import { countTills } from "./tills";
import {
  indexerLatestLedger,
  loadChain,
  syncIndexer,
  type DepositRec,
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
  chat: { round: number; name: string; text: string; at: string; ghost?: boolean }[];
  /** Whispers: fully private player-to-player notes (Bri: completely
   *  secret for now — no public trace that a whisper even happened). */
  dms: { round: number; from: string; to: string; text: string; at: string }[];
  /** Rounds whose tills were counted — the shopkeepers' own dawn merges
   *  (step 5 of a confidential payment, performed for real). */
  tills: { round: number; shops: string[]; at: string }[];
  /** The season's takings per shop, from Maude's audit — set once, when the
   *  game finds its winner. Step 6 (withdraw) needs a proof this worker
   *  cannot run, so the reckoning shows the auditor's ledger instead. */
  takings: { shop: string; xlm: string }[] | null;
  /** Tied-vote consequence: address → round in which they must disclose. */
  /** address -> round they were found drinking, snapshotted at market close. */
  drunkards: Record<string, number>;
  /** Round whose drunkard snapshot has been taken (0 = none yet). */
  drunkSnapshotRound: number;
  /** Indexer height when the last dawn resolved: purchases at or below it
   *  were seen (and applied) by that dawn; anything above belongs to the
   *  NEXT day. Solves both the double-fire re-bucket and the 60s dawn-gap
   *  coin trap (issue #20.1/.6). */
  lastDawnLedger: number;
  /** Ledger height at the FIRST join — this game's birth certificate.
   *  Deposits from before it belong to other games, not this feed. */
  createdLedger: number;
  /** The Order called the game off; the bear won by default, not by play. */
  calledOff: boolean;
  askLog: AskRecord[];
  /** This round's votes: voter address → target player name. */
  votes: Record<string, string>;
  /** This round's werebear pick: target player name, or null. */
  nightPick: string | null;
  /** Freeze-proofing: wall-clock ms when the day opened, and when its market
   *  first closed — so a straggler can never stall the game forever. */
  dayOpenedAt: number;
  marketClosedAt: number | null;
  /** address → round they spend in critical condition (no vote) after a save. */
  recovering: Record<string, number>;
  /** address → horseshoe nails spent (each purchase = one tie won). */
  nailUsed: Record<string, number>;
  /** address → pizza parties already thrown (each purchase = one save). */
  pizzaUsed: Record<string, number>;
  /** address → tooth-sharpener offerings the beast has already accepted. */
  offeringUsed: Record<string, number>;
  /** address → whether a paid-for ghost got its vote. Decided once, at death. */
  ghostVote: Record<string, "granted" | "refused">;
  /** Aimed items: a purchase carries only an amount, so the target is stated
   *  separately and privately (p/aim), like a vote or a night pick. */
  aims: { round: number; by: string; item: string; target?: string; shop?: string }[];
  /** Doors shut for a day: shop closures (everyone) and per-player locks. */
  closures: { round: number; shop: string; player?: string }[];
  /** address → private dawn facts — readable only by that player. */
  privateNotes: Record<string, { round: number; text: string }[]>;
  mornings: MorningReport[];
  phase: "lobby" | "day" | "ended";
  winner: "village" | "werebear" | null;
  createdAt: string;
}

const freshState = (): GameState => ({
  players: [],
  tills: [],
  takings: null,
  roles: null,
  round: 0,
  rounds: [],
  asked: {},
  doneShopping: {},
  chat: [],
  dms: [],
  drunkards: {},
  drunkSnapshotRound: 0,
  lastDawnLedger: 0,
  createdLedger: 0,
  calledOff: false,
  askLog: [],
  votes: {},
  nightPick: null,
  dayOpenedAt: 0,
  marketClosedAt: null,
  recovering: {},
  nailUsed: {},
  pizzaUsed: {},
  offeringUsed: {},
  ghostVote: {},
  aims: [],
  closures: [],
  privateNotes: {},
  mornings: [],
  phase: "lobby",
  winner: null,
  createdAt: new Date().toISOString(),
});

/** Minimum lobby size before ready-up can start the game (7 for the real thing). */
// A real game is a FULL table: all eight faces claimed (Bri, 2026-08-04).
// Smaller tables still exist — the GM's force-deal and the item exam use
// them — but the automatic start waits for the whole village.
const MIN_PLAYERS = 8;

/**
 * Name an item in running prose. Catalog labels carry their own articles
 * ("A bottle", "The ledger book"), so a bare `the ${label}` produced "the a
 * bottle" and "the the ledger book" — swap the label's article for ours.
 */
function itemPhrase(label: string): string {
  return `the ${label.toLowerCase().replace(/^(the|a|an)\s+/, "")}`;
}

/** Name a shop in running prose — "The Butcher's" already has its article. */
function placePhrase(label: string): string {
  return `the ${label.replace(/^The\s+/i, "")}`;
}

/** Uniform random index from real randomness (same source as the role deal). */
function randomIndex(n: number): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0]! % n;
}

/** The clock: if the werebear survives the dusk of this day, it wins. */

/** itemId → { shopId, price, aim, label } (prices are globally unique). */
const ITEM_INDEX = new Map<
  string,
  { shopId: string; price: bigint; aim?: string; label: string }
>();
for (const shop of SHOP_BY_ID.values()) {
  for (const item of shop.items) {
    ITEM_INDEX.set(item.id, {
      shopId: shop.id,
      price: stroopsFromXlm(item.priceXlm),
      aim: item.aim,
      label: item.label,
    });
  }
}

export class GameRoom extends DurableObject<Env> {
  private state: GameState = freshState();
  /** Last time we poked the indexer's /sync. Eight players pressing Done at
   *  once used to be eight sync POSTs; now it is one. */
  private lastSync = 0;
  /**
   * This game's decrypted window on the shared token.
   * 3s memo — plenty to collapse an 8-tab poll stampede into one
   * read, and every write path calls sync() first, which drops it. Remove it
   * if a read ever has to be transactional with a write in the same request.
   */
  private chain: { at: number; data: { purchases: Purchase[]; deposits: DepositRec[] } } | null =
    null;
  /** In-flight lock: resolveDay awaits external I/O, and the DO delivers new
   * events during those awaits — without this, a vote and the bear's pick
   * landing together can resolve the same day twice. */
  private resolving = false;

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
    // Names are display strings that also land verbatim in Maude's
    // fact-selection prompt (rebuilt for EVERY player's question) — so strip
    // anything that isn't display material. A newline in a name was a prompt
    // injection against the whole table's daily questions (issue #11).
    const cleanName = String(name)
      .replace(/[^\p{L}\p{N} '._-]/gu, "")
      .trim()
      .slice(0, 24);
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
    // First seat taken = the game is born. Deposits before this ledger are
    // some OTHER game's business (Bri's wallet had 12 of them on the feed).
    if (!this.state.createdLedger && this.state.players.length === 0) {
      this.state.createdLedger = await indexerLatestLedger(this.env).catch(() => 0);
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
    // force is the GM saying "this table is complete": it waives the full-8
    // requirement for demos and tests, not just the re-deal guard.
    if (this.state.players.length < MIN_PLAYERS && !force) {
      throw new Error(
        `only ${this.state.players.length} seated — the game starts at ${MIN_PLAYERS}, or the GM can force-deal a smaller table`,
      );
    }
    if (this.state.players.length < 3) {
      throw new Error("even a forced game needs three villagers");
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
    // Faces lock when roles are dealt: a mid-game character swap would let a
    // player shed the identity everyone's suspicions are attached to.
    if (this.state.roles) throw new Error("the game is underway — your face is set");
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
    // Never skip a day's resolution: opening the next day before the current
    // one has a morning would silently drop its trial and night (audit
    // footgun). Resolve the day first (dawn, or GM resolve-day / the vote
    // deadline) — only then may the next day open.
    if (
      this.state.round >= 1 &&
      !this.state.mornings.some((m) => m.round === this.state.round)
    ) {
      throw new Error("resolve the current day before opening the next");
    }
    await this.sync();
    const latest = await indexerLatestLedger(this.env);
    // Open the new day exactly where the last dawn stopped seeing: anything
    // the dawn already applied stays in its round; a purchase that slipped
    // into the 60-second gap (or that the lagging mirror hadn't shown dawn)
    // falls into TODAY's window and works, instead of double-firing or
    // dying inert (issue #20.1/.6).
    const startLedger = Math.max(latest, this.state.lastDawnLedger ?? 0) + 1;
    const prev = this.state.rounds.find((w) => w.round === this.state.round);
    if (prev && prev.endLedger === null) prev.endLedger = latest;
    this.state.round += 1;
    this.state.rounds.push({ round: this.state.round, startLedger, endLedger: null });
    this.state.votes = {};
    this.state.nightPick = null;
    this.state.phase = "day";
    // Freeze-proofing: arm the market deadline so the day can never stall on a
    // straggler who never clicks Done.
    this.state.dayOpenedAt = Date.now();
    this.state.marketClosedAt = null;
    await this.ctx.storage.setAlarm(this.state.dayOpenedAt + this.marketDeadlineMs());
    await this.persist();
    // Count the just-closed day's tills here — deterministically at every roll,
    // rather than via a near-term alarm the market deadline would clobber. A
    // no-op on the first day (no morning yet) and idempotent per round; never
    // throws (see countLatestTills).
    await this.countLatestTills();
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
    // The dead don't vote — and a vote left behind fed the knife-announce
    // arithmetic and could even be "banished" a second time (issue #20.4).
    delete this.state.votes[p.address];
    // A death can be what shuts the market — don't let the barrel slip through.
    await this.closeMarketIfDone();
    await this.persist();
    // Eliminating the last player who owed a vote must not hang the day.
    await this.maybeResolve();
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
    await this.sync();
    const ledger = await indexerLatestLedger(this.env);
    this.state.doneShopping[address] = { round: this.state.round, ledger };
    // If that was the last villager, the barrel takes effect now — no second
    // click, same as every other item that fires straight from its purchase.
    await this.closeMarketIfDone();
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
    // Cap like chat does (280): an uncapped question was an uncapped model
    // bill, and a failed ask never spends the seal, so retries were free
    // (issue #11). Seal-on-success stays — kinder to a player whose question
    // died to a gateway blip; the cap bounds what a retry can cost.
    question = question.trim().slice(0, 500);

    await this.sync();
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
    question = String(question ?? "").trim().slice(0, 500); // same cap as p/ask
    if (!question) throw new Error("question must be a non-empty string");
    const who = (asker && asker.trim()) || "the GM";
    await this.sync();
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
    // The dead do not vote — unless they paid the Mayor in advance and the
    // Order happened to honour it.
    if (!voter.alive && this.state.ghostVote?.[voterAddress] !== "granted") {
      throw new Error("the dead do not vote");
    }
    if (this.drunkToday(voterAddress)) {
      throw new Error("you are dead drunk in the road — the trial will manage without you");
    }
    if (this.state.recovering[voterAddress] === this.state.round) {
      throw new Error("you are in critical condition — too weak to raise a hand at today's trial");
    }
    // Locked in (Bri, 2026-08-17): one vote, no take-backs. The bear's
    // night pick stays changeable; the rope does not.
    if (this.state.votes[voterAddress] !== undefined) {
      throw new Error("your vote is cast — the rope remembers");
    }
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
   * closes at dawn. The dead may speak — as ghosts. (Everyone dead mid-game
   * is a certified villager, so ghost counsel mildly helps the village;
   * counterweighted on the werebear's shelf.)
   */
  async chat(address: string, text: string): Promise<{ posted: boolean }> {
    // ALWAYS open (Bri, 2026-08-17, reversing the 2-minute clock after one
    // playtest): the square chats in the lobby, through the market, and all
    // the way to dawn. Timed argument added ceremony, not tension.
    if (this.state.phase === "ended") throw new Error(`game over — ${this.state.winner} won`);
    const player = this.playerByAddress(address);
    if (!player) throw new Error("that address holds no seat in this game");
    const clean = String(text).trim().slice(0, 280);
    if (!clean) throw new Error("say something or say nothing");
    this.state.chat.push({
      round: this.state.round,
      name: player.name,
      text: clean,
      at: new Date().toISOString(),
      ghost: !player.alive || undefined,
    });
    if (this.state.chat.length > 500) this.state.chat = this.state.chat.slice(-500);
    await this.persist();
    return { posted: true };
  }

  /**
   * Stand-accused disclosure: the accused PICKS the purchase (by tx hash),
   * Maude does the revealing — the server decrypts that exact transaction,
   * so the reveal cannot lie. Clears the accusation and unlocks their vote.
   */
  /**
   * Point an aimed item at its victim. The purchase itself carries only an
   * amount, so the target lives here — server-side and private, exactly like a
   * vote or the bear's night pick. Verified against the decrypted ledger: you
   * must actually own an unaimed copy of that item, bought today.
   */
  async aimItem(
    address: string,
    itemId: string,
    target?: string,
    shop?: string,
  ): Promise<{ aimed: string; at: string; result?: string }> {
    this.requireDay();
    this.requireUnresolved();
    const player = this.playerByAddress(address);
    if (!player) throw new Error("that address holds no seat in this game");
    if (!player.alive) throw new Error("the dead aim at nothing");
    const item = ITEM_INDEX.get(itemId);
    if (!item?.aim) throw new Error("that item does not need aiming");

    const round = this.state.round;
    // The purchase is seconds old: poke the mirror before looking for it.
    await this.sync();
    let purchases = await this.loadAll();
    const countOwned = () => this.countBought(purchases, address, itemId, { round });
    const alreadyAimed = this.state.aims.filter(
      (a) => a.round === round && a.by === address && a.item === itemId,
    ).length;
    if (countOwned() <= alreadyAimed) {
      // sync() is throttled ACROSS callers (3s), so a buy-then-aim can look
      // at a mirror somebody else refreshed moments before the purchase
      // landed — and a true "buy it first" becomes a false one (seen live:
      // a bot's cold iron key rejected seconds after buying it). One
      // unthrottled retry before we accuse the player of not shopping.
      await syncIndexer(this.env);
      this.chain = null;
      purchases = await this.loadAll();
      if (countOwned() <= alreadyAimed) {
        throw new Error(`buy ${item.label} today before you aim it`);
      }
    }

    let targetName: string | undefined;
    if (item.aim === "player" || item.aim === "player+shop") {
      const t = target ? this.playerByName(target) : null;
      if (!t || !t.alive) throw new Error(`no living villager named "${target ?? ""}"`);
      if (t.address === address) throw new Error("aim it at somebody else");
      targetName = t.name;
    }
    let shopId: string | undefined;
    if (item.aim === "shop" || item.aim === "player+shop") {
      if (!shop || !SHOP_BY_ID.has(shop)) throw new Error("name one of the village stores");
      shopId = shop;
    }

    this.state.aims.push({ round, by: address, item: itemId, target: targetName, shop: shopId });

    // The long candle answers NOW (Bri: a dawn delivery arrived a whole
    // trial too late to think with). Roles are dealt whenever aiming is
    // possible, so the answer already exists — roll it, note it, return it
    // in the aim response, which only the aimer ever sees. A purchase
    // voided by a barred door still burns nothing: no roll, no answer.
    let result: string | undefined;
    if (itemId === "the_long_candle" && targetName) {
      const myCandle = purchases.find(
        (x) => x.from === address && x.round === round && x.itemGuess === item.label,
      );
      if (myCandle && !this.isVoided(myCandle, round)) {
        const read = this.playerByName(targetName)!;
        const shows = randomIndex(2) === 0;
        const isBear = this.state.roles?.[read.address] === "werebear";
        result = shows
          ? `🕯 The candle worked: ${read.name} is ${isBear ? "THE WEREBEAR" : "not the werebear"}.`
          : `🕯 The candle failed: it told you nothing about ${read.name}.`;
        ((this.state.privateNotes ??= {})[address] ??= []).push({ round, text: result });
      }
    }
    await this.persist();
    return { aimed: item.label, at: [targetName, shopId].filter(Boolean).join(" @ "), result };
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
    // Everyone with a hand to raise: the living, plus any ghost the Order
    // granted a vote. Dawn waits for all of them.
    const voters = this.state.players.filter(
      (p) => p.alive || this.state.ghostVote?.[p.address] === "granted",
    );
    // Players in critical condition CANNOT vote today — dawn doesn't wait
    // for a hand that can't be raised.
    const allVoted = voters.every(
      (p) =>
        this.state.votes[p.address] !== undefined ||
        this.drunkToday(p.address) ||
        // The vote gate refuses a recovering player, so dawn must not wait
        // for them — this was a latent deadlock if `recovering` is ever
        // revived (issue #20.5).
        this.state.recovering[p.address] === this.state.round,
    );
    const alive = this.state.players.filter((p) => p.alive);
    const roles = this.state.roles ?? {};
    const bear = alive.find((p) => roles[p.address] === "werebear");
    const bearReady = !bear || this.state.nightPick !== null;
    if (allVoted && bearReady) {
      try {
        await this.resolveDay();
      } catch {
        // Either dawn is already breaking on another request, or it failed
        // outright. Don't guess which — ask the state below.
      }
      // Dawn happened only if a morning exists. Reporting `true` on a failed
      // dawn told the app to wait for a report that was never coming, and
      // nothing would ever retry: every vote was already in.
      if (this.state.mornings.some((m) => m.round === this.state.round)) return true;
      // Dawn was due and did not come. Nothing else will trigger it — the last
      // hand is already up — so ask the crier to try again shortly.
      await this.ctx.storage.setAlarm(Date.now() + 15_000);
      return false;
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
    if (this.resolving) throw new Error("dawn is already breaking");
    this.resolving = true;
    try {
      return await this.resolveDayInner();
    } catch (err) {
      // resolveDayInner mutates `this.state` as it goes — it banishes, it
      // kills, it spends nails — and persists only at the very end. An error
      // partway (loadAll and loadDeposits are network calls) leaves those
      // deaths live in memory but unsaved, and the NEXT persist() from any
      // path (a chat line, a vote) would write that half-dawn to storage
      // forever. Storage is still clean here: reload from it.
      const stored = await this.ctx.storage.get<GameState>("state");
      this.state = stored ? { ...freshState(), ...stored } : freshState();
      throw err;
    } finally {
      this.resolving = false;
    }
  }

  private async resolveDayInner(): Promise<MorningReport> {
    const round = this.state.round;
    await this.sync();
    const purchases = await this.loadAll();
    const roles = this.state.roles!;
    const notes: string[] = [];
    const violations: string[] = [];

    // A door barred yesterday voids what you buy behind it today: the chain
    // cannot refuse a transfer, so the shopkeeper keeps the coin and the item
    // does nothing. Audits still see the spend; only EFFECTS are voided.
    const isVoided = (p: Purchase): boolean => this.isVoided(p, round);
    const effective = purchases.filter((p) => !isVoided(p));
    for (const p of purchases.filter(isVoided)) {
      ((this.state.privateNotes ??= {})[p.from] ??= []).push({
        // round + 1, like every other dawn note: the app only ever renders
        // notes for the round it is CURRENTLY in, and this one is written as
        // the round closes. Filed under `round` it was never once readable.
        round: round + 1,
        text: `🔒 The ${p.toLabel} door would not open for you yesterday. Your coin bought nothing, and the shopkeeper kept it.`,
      });
    }

    const boughtThisRound = (address: string, itemId: string): boolean =>
      this.bought(effective, address, itemId, { round });
    const boughtEver = (address: string, itemId: string): boolean =>
      this.bought(effective, address, itemId, {});
    const aimsToday = this.state.aims.filter((a) => a.round === round);
    /** Aims of one item this round, skipping any whose purchase was voided. */
    const aimedToday = (itemId: string) =>
      aimsToday.filter(
        (a) => a.item === itemId && this.bought(effective, a.by, itemId, { round }),
      );

    // --- TRIAL: knife-doubled plurality, minus any stopped mouths. ---------
    // Dead drunk: villagers who declared a barrel today. The beast is too big
    // for beer, so its own declaration does nothing at all.
    //
    // Read the SNAPSHOT, not the chain. The snapshot is what the vote gate
    // answered "are you drunk?" from when the hand went up, and what the
    // roster and awaitingVotes are built on. Re-deriving here from live
    // purchases let a barrel that surfaced late — declareDone's syncIndexer is
    // best-effort and swallows its own errors — drop a vote the gate had
    // already accepted, silently, after six people watched the roster expect
    // it. Refresh it first from the purchases we have already loaded, so a
    // late barrel still counts rather than counting differently.
    await this.snapshotDrunkards(purchases);
    const drunk = new Set(
      this.state.players.filter((p) => this.drunkToday(p.address)).map((p) => p.name),
    );
    const socked = new Set(
      aimsToday
        .filter((a) => a.item === "sock_in_mouth" && this.bought(effective, a.by, "sock_in_mouth", { round }))
        .map((a) => a.target)
        .filter((n): n is string => !!n),
    );
    const weights = new Map<string, number>();
    let knifeCast = false;
    for (const [voterAddr, targetName] of Object.entries(this.state.votes)) {
      const voter = this.playerByAddress(voterAddr);
      // A granted ghost is counted with the living at the trial.
      if (!voter || (!voter.alive && this.state.ghostVote?.[voterAddr] !== "granted")) continue;
      // Asleep in the road. Say so — a vote vanishing from the tally with no
      // explanation is how a trial hangs a different person than the table
      // expected. The sock, three lines down, already announces itself.
      if (drunk.has(voter.name)) {
        notes.push(
          `🍺 ${voter.name} was dead drunk in the road: their vote did not count today.`,
        );
        continue;
      }
      // A sock in the mouth: they spoke all day, but the tally cannot hear
      // it. (The naming happens below, from the aim — a victim who never
      // voted is still named; 32 XLM never buys invisible nothing.)
      if (socked.has(voter.name)) continue;
      // The knife is sharp for ONE trial — the day it was bought.
      const weight = boughtThisRound(voterAddr, "butchers_knife") ? 2 : 1;
      if (weight === 2) knifeCast = true;
      weights.set(targetName, (weights.get(targetName) ?? 0) + weight);
    }
    // Ruling #19.4 (Bri, 2026-08-06): the public effects fire EVERY time.
    for (const name of socked) {
      notes.push(
        `🧦 Someone bought a sock in mouth for ${name}: their vote did not count today.`,
      );
    }
    if (knifeCast) {
      notes.push(
        "🔪 Someone's butcher's knife counted their vote twice at today's trial. Nobody is told whose.",
      );
    }
    let banished: PlayerRef | null = null;
    if (weights.size > 0) {
      const max = Math.max(...weights.values());
      const top = [...weights.entries()].filter(([, w]) => w === max).map(([n]) => n);
      if (top.length === 1) {
        const b = this.playerByName(top[0]!);
        // A GM-eliminated player can still lead the tally — a corpse cannot
        // be banished a second time (issue #20.4).
        banished = b?.alive ? b : null;
      }
      else {
        notes.push(
          `The vote tied between ${top.join(" and ")}.`,
        );
        // Lucky iron decides a deadlock: a nail steps its holder OUT of the
        // tie, so the rope looks for whoever is left. If exactly one villager
        // remains in the tie, they hang; if several do, nobody hangs and they
        // all owe the village a purchase.
        const stillTied: PlayerRef[] = [];
        for (const name of top) {
          const p = this.playerByName(name);
          if (!p?.alive) continue;
          // Every nail bought (any day) grants one excuse; re-buying on a
          // later day restocks. Same-day repeats are audit violations anyway.
          const nailsOwned = this.countBought(effective, p.address, "horseshoe_nail");
          const nailsSpent = (this.state.nailUsed ??= {})[p.address] ?? 0;
          if (nailsOwned > nailsSpent) {
            this.state.nailUsed[p.address] = nailsSpent + 1;
            notes.push(
              `🍀 ${p.name} had a horseshoe nail: the tie skips them. The nail is spent.`,
            );
          } else {
            stillTied.push(p);
          }
        }
        if (stillTied.length === 1) {
          banished = stillTied[0]!;
          notes.push(`The tie fell on ${banished.name}.`);
        } else if (stillTied.length === 0) {
          notes.push("Everyone in the tie had a horseshoe nail: nobody is banished today.");
        } else {
          // A tie means nobody dies (Bri, 2026-08-05). The disclosure debt
          // this used to create was low-impact and confusing; retired.
          notes.push("The vote tied: nobody is banished today.");
        }
      }
    } else {
      notes.push("Nobody voted. Nobody is banished today.");
    }
    // The pizza party: hard to hang the host. Fires on ANY banishment —
    // plurality or the tie's rope — consumes one purchase, and names the
    // host publicly. (Strong bear utility, damning receipt: this is the
    // bear-tempting shape the watch list wanted.)
    if (banished) {
      const partiesBought = this.countBought(effective, banished.address, "pizza_party", {});
      const partiesThrown = (this.state.pizzaUsed ??= {})[banished.address] ?? 0;
      if (partiesBought > partiesThrown) {
        this.state.pizzaUsed[banished.address] = partiesThrown + 1;
        notes.push(
          `🍕 ${banished.name} threw a pizza party: the village ate, drank, and forgot the whole business. Nobody is banished today.`,
        );
        banished = null;
      }
    }
    let banishedRole: Role | null = null;
    if (banished) {
      banished.alive = false;
      delete this.state.recovering[banished.address];
      banishedRole = roles[banished.address] ?? "villager";
      if (banishedRole === "werebear") {
        this.state.winner = "village";
        this.state.phase = "ended";
      }
    }

    // --- NIGHT: the pick through the gear order. ---------------------------
    let eaten: PlayerRef | null = null;
    const bearAddress = Object.entries(roles).find(([, r]) => r === "werebear")?.[0];
    const bear = bearAddress ? this.playerByAddress(bearAddress) : null;
    // The curfew bell: rung by anyone today (alive or hanged since — it pays
    // on purchase), the whole village hears it and the beast stays home.
    const bellTonight = this.state.players.some((p) =>
      this.bought(effective, p.address, "curfew_bell", { round }),
    );
    // The bell is a coin flip now (Bri, 2026-08-17 — a guaranteed bell was
    // still too strong even at 44). Both outcomes are announced: a failed
    // ring must be distinguishable from no bell at all.
    const bellWorked = bellTonight && randomIndex(2) === 0;
    if (this.state.winner === null && bear?.alive && bearAddress && bellTonight && bellWorked) {
      notes.push("🔔 Someone rang the curfew bell: the werebear had to stay home. Nobody died tonight.");
    }
    if (this.state.winner === null && bear?.alive && bearAddress && bellTonight && !bellWorked) {
      notes.push("🔔 The curfew bell rang — but something ignored it.");
    }
    if (this.state.winner === null && bear?.alive && bearAddress && !bellWorked) {
      let target = this.state.nightPick ? this.playerByName(this.state.nightPick) : null;
      // A sharpened tooth in the beast's mouth: only the barrel is beyond it.
      const sharpTonight = boughtThisRound(bearAddress, "tooth_sharpener");
      // A bone at somebody else's gate: one chance in two the beast is
      // distracted on its way. Never onto the beast itself, never onto a corpse.
      if (target) {
        const bone = aimedToday("soup_bone").find((a) => a.by === target!.address);
        const elsewhere = bone?.target ? this.playerByName(bone.target) : null;
        if (
          bone &&
          // The bone deflects even a sharpened bear (Bri, 2026-08-17): the
          // sharpener means the kill can't be BARGAINED away (offerings die
          // with their owner) — not that it can't be pointed elsewhere. The
          // redirected victim faces the same sharpened teeth.
          !drunk.has(target.name) && // nothing was going to happen anyway
          elsewhere?.alive &&
          elsewhere.address !== bearAddress &&
          randomIndex(2) === 0
        ) {
          ((this.state.privateNotes ??= {})[target.address] ??= []).push({
            round: round + 1,
            text: "🦴 Your soup bone worked: the werebear came for you and was turned aside.",
          });
          target = elsewhere;
        }
      }
      // The same purchase in villager hands is an offering left on the step.
      // Scoped to TODAY, like the bear's half of the item three lines up and
      // like the shelf's own words: "if the werebear targets you tonight".
      // Unscoped, a sharpener bought on day 1 was still saving lives on day 5,
      // while the bear paid the same 33 for exactly one night.
      const hasOffering =
        target !== null &&
        this.countBought(effective, target.address, "tooth_sharpener", { round }) >
          ((this.state.offeringUsed ??= {})[target.address] ?? 0);
      if (!target || !target.alive) {
        // The pick only accepts the living, so the one way prey pre-dies is
        // that day's trial — say so precisely (Bri).
        notes.push("A quiet night: the werebear's chosen prey had already been banished.");
      } else if (drunk.has(target.name)) {
        // Nothing wakes a drunk villager, the beast included. The save is
        // announced but never NAMED — who was protected, and how, stays theirs.
        notes.push(
          "A quiet night: the werebear attacked, but its prey survived. Only they know why.",
        );
        ((this.state.privateNotes ??= {})[target.address] ??= []).push({
          round: round + 1,
          text: "🍺 Your barrel of beer saved you: the werebear came for you and left you sleeping.",
        });
      } else if (!sharpTonight && hasOffering && randomIndex(2) === 0) {
        // The beast took the gift and went. Publicly this is just a quiet
        // night; the villager who paid learns why, and only them.
        this.state.offeringUsed[target.address] =
          (this.state.offeringUsed[target.address] ?? 0) + 1;
        notes.push(
          "A quiet night: the werebear attacked, but its prey survived. Only they know why.",
        );
        ((this.state.privateNotes ??= {})[target.address] ??= []).push({
          round: round + 1,
          text: "🦷 Your tooth sharpener saved you: the werebear took it instead of you.",
        });
      } else {
        eaten = target;
        target.alive = false;
        delete this.state.recovering[target.address];
        if (sharpTonight) {
          notes.push(
            `🦷 The werebear used a tooth sharpener: nothing ${target.name} carried could save them.`,
          );
        }
      }
    }

    // --- THE UNQUIET DEAD: a paid-for ghost learns whether it kept its vote. --
    for (const dead of [banished, eaten]) {
      if (!dead) continue;
      if (!boughtEver(dead.address, "unquiet_rest")) continue;
      if ((this.state.ghostVote ??= {})[dead.address]) continue; // decided once
      const granted = randomIndex(2) === 0;
      this.state.ghostVote[dead.address] = granted ? "granted" : "refused";
      notes.push(
        granted
          ? `👻 ${dead.name} bought unquiet rest and won the coin flip: their ghost keeps its vote.`
          : `👻 ${dead.name} bought unquiet rest and lost the coin flip: no ghost vote.`,
      );
    }

    // --- DAWN READINGS: the information items fire. -------------------------
    // Information items pay out on PURCHASE, not on survival: a villager
    // hanged at today's trial still paid for the reading, and the village
    // still hears it. (Gating this on `alive` silently voided a buyer's coin
    // when the same day's tie hanged them — invisible and unguessable.)
    const boughtToday = (itemId: string): PlayerRef[] =>
      this.state.players.filter((p) => boughtThisRound(p.address, itemId));

    // Locks and holidays take effect TOMORROW; the village sees the door, never
    // the hand. A key names no one; a holiday shuts the shop for everybody.
    for (const a of aimedToday("cold_iron_key")) {
      if (!a.shop || !a.target) continue;
      this.state.closures.push({ round: round + 1, shop: a.shop, player: a.target });
      notes.push(
        `🔒 Someone bought a cold iron key: one villager is locked out of ${placePhrase(SHOP_BY_ID.get(a.shop)?.label ?? a.shop)} tomorrow.`,
      );
    }


    // --- AUDITS: the Order notices. ----------------------------------------
    // Deposit audit: deposits made DURING THIS GAME vs the allowance
    // schedule. Pre-game history is irrelevant (the Order's desk normalizes
    // balances and the spend audit caps usage) — this tripwire exists for
    // mid-game top-ups only.
    const deposits = await this.loadDepositsCached();
    const allowedTotal = stroopsFromXlm(STARTING_BUDGET_XLM + DAILY_INCOME_XLM * (round - 1));
    for (const p of this.state.players) {
      const depTotal = deposits
        .filter((d) => d.to === p.address && d.round >= 1)
        .reduce((a, d) => a + d.amountStroops, 0n);
      if (depTotal > allowedTotal) {
        violations.push(
          `${p.name} has deposited ${xlmString(depTotal)} XLM in total — the schedule allows ${xlmString(allowedTotal)} by day ${round}. The Treasury notices.`,
        );
      }
      // THE fairness audit: in-game spending vs the allowance schedule.
      // Surrenders to the Order don't count — that's old money going home.
      const spent = purchases
        .filter((x) => x.from === p.address && x.round >= 1 && !x.isSurrender)
        .reduce((a, x) => a + x.amountStroops, 0n);
      if (spent > allowedTotal) {
        violations.push(
          `${p.name} has spent ${xlmString(spent)} XLM this game — the allowance is ${xlmString(allowedTotal)} by day ${round}. Old money, new suspicion. The Treasury notices.`,
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
            `${p.name} came to market carrying ${xlmString(preBalance)} XLM — the law allows ${xlmString(allowedAtBuy)}. Old coin must be surrendered to the Town Treasury before shopping.`,
          );
        }
      }
      const beforeOpening = purchases.filter(
        (x) => x.from === p.address && x.round === 0 && !x.isSurrender,
      ).length;
      // Report lobby spending once, at the first dawn — not forever (#20.3).
      if (beforeOpening > 0 && round === 1) {
        violations.push(
          `${p.name} spent coin at ${beforeOpening} shop${beforeOpening === 1 ? "" : "s"} before the game began — the stores were shut, and the money bought nothing.`,
        );
      }
      // Once per DAY, not once per game (Bri's ruling, 2026-08-04): the
      // shelf resets each morning, so only a same-day repeat is a violation.
      const byWareDay = new Map<string, number>();
      // TODAY only: a day-1 double-buy used to reappear in every remaining
      // morning's report (issue #20.3).
      for (const x of purchases.filter((q) => q.from === p.address && q.round === round && !q.isSurrender)) {
        if (x.itemGuess) {
          const k = `${x.round}:${x.itemGuess}`;
          byWareDay.set(k, (byWareDay.get(k) ?? 0) + 1);
        }
      }
      for (const [k, n] of byWareDay) {
        if (n > 1) {
          const ware = k.slice(k.indexOf(":") + 1);
          violations.push(
            `${p.name} bought the ${ware.toLowerCase()} ${n} times in one day — once a day is the custom. The Treasury notices.`,
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
        // The indexer trails the chain by a ledger or two, so a purchase
        // already on-chain when Done was clicked can surface after the pin.
        // Grace, not amnesty — this is the one audit that calls someone a
        // liar by name (issue #20.2).
        const LATE_BUY_GRACE = 2;
        const lateBuys = purchases.filter(
          (x) =>
            x.from === p.address &&
            x.round === round &&
            !x.isSurrender &&
            x.ledger > done.ledger + LATE_BUY_GRACE,
        ).length;
        if (lateBuys > 0) {
          violations.push(
            `${p.name} declared their shopping done, then bought ${lateBuys} more thing${lateBuys === 1 ? "" : "s"}. The Mayor notices little lies especially.`,
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
        // Parity counts the LIVING, not the dead (Bri, 2026-08-25): a granted
        // ghost vote lets a dead villager still speak at a trial, but a ghost
        // is not a living person for the win check. Counting ghosts here
        // deadlocked "anothergame" — the bear had eaten every living villager,
        // but two dead bot-ghosts (who never cast a vote) held the count above
        // parity, so the werebear win never fired and no trial could ever
        // resolve it. Ghosts still vote in trials that happen; they no longer
        // keep a village that has no living members from losing.
        const livingVillagers = this.state.players.filter(
          (p) => p.alive && roles[p.address] !== "werebear",
        ).length;
        if (livingVillagers <= 1) {
          // Parity: one living villager cannot win a vote against one bear. The
          // game is decided — and the bear doesn't leave leftovers.
          this.state.winner = "werebear";
          this.state.phase = "ended";
          const last = this.state.players.filter(
            (p) => p.alive && roles[p.address] !== "werebear",
          );
          for (const villager of last) {
            villager.alive = false;
            // The last villager dies ON CAMERA like everyone else: marking
            // them eaten makes the death film, the notices row, and the fate
            // label all work for the endgame (issue #18.3). The ghost-vote
            // loop already ran — moot anyway, the game is over.
            eaten ??= villager;
            notes.push(
              `With no one left to stand between them, the werebear stopped pretending. ${villager.name} never saw another dawn. The village belongs to the bear.`,
            );
          }
          if (last.length === 0) {
            notes.push("The werebear stands alone in an empty village. It has won.");
          }
        }
        // The six-day clock is gone (Bri, 2026-08-17): the game runs until
        // it ends naturally — the rope finds the bear, or parity finds the
        // village.
      }
    }

    // Ruling #19.2 (Bri, 2026-08-06): the audit reaches the villager it
    // names — privately, in their dawn results. The public report stays pure
    // story; the GM console keeps its copy as a debugging view, not a policy.
    // (Every finding starts with the player's name; see the strings above.)
    for (const p of this.state.players) {
      for (const v of violations.filter((x) => x.startsWith(`${p.name} `))) {
        ((this.state.privateNotes ??= {})[p.address] ??= []).push({
          round: round + 1,
          text: `📕 The Order's audit named you: ${v}`,
        });
      }
    }

    // Where this dawn stood: everything it could see ends here (issue #20).
    this.state.lastDawnLedger = await indexerLatestLedger(this.env).catch(() => this.state.lastDawnLedger ?? 0);

    // Uncredited relic buys get told at dawn (like a barred door): the
    // ladder replay is the law, and coin that bought no relic says so.
    {
      const credits = this.relicCredits(purchases);
      const relicGuesses = new Set(["Gerald's finger", "Gerald's thumb", "Gerald's toe"]);
      for (const p of purchases.filter(
        (x) =>
          x.round === round &&
          x.itemGuess !== null &&
          relicGuesses.has(x.itemGuess) &&
          !credits.credited.has(x.txHash),
      )) {
        ((this.state.privateNotes ??= {})[p.from] ??= []).push({
          round: round + 1,
          text: `☝️ Gerald had nothing more to give: the ${p.itemGuess} was not his to sell yet. The Chapel kept your coin.`,
        });
      }
    }

    // The season's takings, from the auditor's own ledger: revealed only
    // when the game is over, when confidentiality has nothing left to guard.
    if (this.state.winner !== null && this.state.takings === null) {
      const sums = new Map<string, bigint>();
      for (const x of purchases.filter((q) => q.round >= 1 && !q.isSurrender && q.shopId !== null)) {
        sums.set(x.toLabel, (sums.get(x.toLabel) ?? 0n) + x.amountStroops);
      }
      this.state.takings = [...sums.entries()]
        .sort((l, r) => (r[1] > l[1] ? 1 : -1))
        .map(([shop, stroops]) => ({ shop, xlm: xlmString(stroops) }));
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
    // The countdown is housekeeping, not story — the Start-new-day button
    // already carries it ("Waiting for the day to reset…"), so the morning
    // report no longer ends every story on scheduling (issue #18.4).
    this.state.mornings.push(report);
    if (this.state.phase !== "ended") {
      this.state.phase = "day"; // stays until the next day opens
      // Dawn rolls into morning by itself: open the next day in 60s.
      // 15s, down from 60 (Bri): films and the crier carry the morning now;
      // a full minute read as a stall.
      await this.ctx.storage.setAlarm(Date.now() + 15_000);
    } else {
      // The last tills still deserve counting: one more alarm, then quiet.
      await this.ctx.storage.setAlarm(Date.now() + 15_000);
    }
    await this.persist();
    return report;
  }

  /**
   * The town crier. Two jobs: open the next day a minute after dawn, and —
   * because nothing else can — retry a dawn that was due but failed. Without
   * the second job an indexer blip on the last vote of the day stalled the
   * game permanently: every hand was already up, so no request would ever
   * call maybeResolve again.
   */
  async alarm(): Promise<void> {
    if (this.state.roles === null) return;
    if (this.state.phase === "ended") {
      await this.countLatestTills(); // the final morning's tills
      return;
    }
    if (this.state.phase !== "day") return;
    if (this.state.mornings.some((m) => m.round === this.state.round)) {
      // Roll into the next day. startDay arms the next deadline AND counts this
      // day's tills, so nothing else is needed here.
      await this.startDay();
      return;
    }

    const now = Date.now();

    // FREEZE-PROOFING 1 — the market cannot stay open forever on a straggler
    // who never clicks Done. Past the deadline, close it for everyone and
    // start the vote clock; before it, just wait.
    if (!this.marketClosed()) {
      const marketDeadline = (this.state.dayOpenedAt || now) + this.marketDeadlineMs();
      if (now >= marketDeadline) {
        this.forceCloseMarket();
        await this.closeMarketIfDone(); // snapshots drunkards + arms the vote clock
        await this.persist();
        await this.maybeResolve(); // bots/players may already have voted
      } else {
        await this.ctx.storage.setAlarm(marketDeadline);
      }
      return;
    }

    // FREEZE-PROOFING 2 — dawn cannot stall forever on a vote or the bear's
    // pick that never comes. Past the deadline, resolve with whatever votes
    // are in (the same path GM resolve uses; a null pick simply eats no one).
    const voteDeadline = (this.state.marketClosedAt || now) + this.voteDeadlineMs();
    if (now >= voteDeadline) {
      try {
        await this.resolveDay();
      } catch {
        /* already breaking, or a transient failure — the retry below covers it */
      }
      if (!this.state.mornings.some((m) => m.round === this.state.round)) {
        await this.ctx.storage.setAlarm(now + 15_000);
      }
      return;
    }

    // Before the deadline: everyone may already have voted — try to resolve;
    // otherwise wait for the deadline to force it.
    const resolved = await this.maybeResolve();
    if (!resolved && !this.state.mornings.some((m) => m.round === this.state.round)) {
      await this.ctx.storage.setAlarm(voteDeadline);
    }
  }

  /**
   * Count the tills of every shop paid on the latest resolved morning: sign
   * a merge AS each shopkeeper, folding its receiving balance into its
   * spendable balance. The one confidential-token step a player never
   * performs (step 5) becomes a real transaction on the shop's own account.
   * A merge sweeps the whole pending balance, so a failed count self-heals
   * at the next dawn. Never throws — dawn owes this nothing.
   */
  private async countLatestTills(): Promise<void> {
    try {
      const morning = this.state.mornings.at(-1);
      if (!morning) return;
      const round = morning.round;
      if ((this.state.tills ??= []).some((t) => t.round === round)) return;
      const purchases = await this.loadAll();
      const todays = purchases.filter((q) => q.round === round);
      const paid = new Map<string, string>(); // id -> address
      for (const x of todays) {
        if (x.shopId !== null) {
          const address = SHOP_BY_ID.get(x.shopId)?.address;
          if (address) paid.set(x.shopId, address);
        } else if (x.isSurrender && ORDER_ADDRESS) {
          paid.set("maudes_office", ORDER_ADDRESS);
        }
      }
      const wanted = [...paid.entries()].map(([id, address]) => ({ id, address }));
      const counted = await countTills(wanted, this.env.SHOP_SECRETS);
      if (counted.failed.length > 0) {
        console.error("till count failures", { round, failed: counted.failed });
      }
      // Record the round as counted even when no shop was paid — an empty
      // market is not an error, and there is nothing to retry.
      if (wanted.length === 0 || counted.merged.length > 0) {
        this.state.tills.push({ round, shops: counted.merged, at: new Date().toISOString() });
        if (counted.merged.length > 0) {
          morning.notes.push(
            "🧮 The shopkeepers counted their tills before sunrise. It's on the public ledger — look for yourself.",
          );
        }
        await this.persist();
      }
    } catch (err) {
      console.error("till count failed", String(err));
    }
  }

  /** GM: close a game outright — lobby abandoned, playtest done, etc.
   *  No winner is declared; the room just stops being a game. */
  async endGame(): Promise<{ ended: true }> {
    this.state.phase = "ended";
    // A game cut short still has a story worth telling: unmask the bear
    // rather than just going quiet. The village failed to find it, so the
    // beast takes the win — but calledOff records that nobody earned it.
    if (this.state.roles && this.state.winner === null) {
      this.state.winner = "werebear";
      this.state.calledOff = true;
    }
    await this.ctx.storage.deleteAlarm();
    await this.persist();
    return { ended: true };
  }

  /**
   * The reliquary ladder, enforced at the ledger (Bri, 2026-08-18: bots were
   * buying thumbs before the fingers sold out — the ladder lived only in the
   * human UI). Replay every purchase in ledger order and credit a relic only
   * if it was legal AT THAT MOMENT: fingers up to 8 always; a thumb only once
   * all 8 fingers are claimed, up to 2; a toe only once both thumbs are, up
   * to 10. Anything else is coin the Chapel keeps — no relic.
   */
  private relicCredits(purchases: Purchase[]): {
    fingers: number;
    thumbs: number;
    toes: number;
    credited: Set<string>;
  } {
    const c = { fingers: 0, thumbs: 0, toes: 0 };
    const credited = new Set<string>();
    const relicBuys = purchases
      .filter((p) => p.round >= 1)
      .sort((a, b) => a.ledger - b.ledger || (a.txHash < b.txHash ? -1 : 1));
    for (const p of relicBuys) {
      if (p.itemGuess === "Gerald's finger" && c.fingers < 8) {
        c.fingers += 1;
        credited.add(p.txHash);
      } else if (p.itemGuess === "Gerald's thumb" && c.fingers >= 8 && c.thumbs < 2) {
        c.thumbs += 1;
        credited.add(p.txHash);
      } else if (p.itemGuess === "Gerald's toe" && c.thumbs >= 2 && c.toes < 10) {
        c.toes += 1;
        credited.add(p.txHash);
      }
    }
    return { ...c, credited };
  }

  // -------------------------------------------------------------- public --

  /** Public game view — safe for every player and spectator. */
  async publicView(): Promise<Record<string, unknown>> {
    return {
      round: this.state.round,
      phase: this.state.phase,
      dealt: this.state.roles !== null,
      // Latest counted till round with actual merges — SixSteps' proof line.
      tills: [...(this.state.tills ?? [])].reverse().find((t) => t.shops.length > 0) ?? null,
      // Non-null only once the game has ended (set at the winning dawn).
      takings: this.state.takings,
      winner: this.state.winner,
      calledOff: this.state.calledOff === true,
      // The game is over: the masks come off. Until then, roles are sealed.
      bear:
        this.state.winner !== null && this.state.roles
          ? (this.state.players.find(
              (p) => this.state.roles?.[p.address] === "werebear",
            )?.name ?? null)
          : null,
      players: this.state.players.map((p) => ({
        seat: p.seat,
        name: p.name,
        address: p.address, // public on-chain anyway; lets the app find itself
        alive: p.alive,
        character: p.character ?? null,
        ready: p.ready === true,
        doneToday: this.state.doneShopping[p.address]?.round === this.state.round,
        askedToday: (this.state.asked[p.address] ?? 0) >= this.state.round && this.state.round >= 1,
        recovering: this.state.recovering[p.address] === this.state.round,
        /** A ghost the Order granted a vote — public by design. */
        ghostVoter: this.state.ghostVote?.[p.address] === "granted",
        /** Declared a barrel today: no vote, and nothing can wake them. */
        drunkToday: this.drunkToday(p.address),
      })),
      readyCount: this.state.players.filter((p) => p.ready).length,
      minPlayers: MIN_PLAYERS,
      /** Maude's office opens only when every living villager is done shopping. */
      marketClosed:
        this.state.round >= 1 &&
        this.state.players
          .filter((p) => p.alive)
          .every((p) => this.state.doneShopping[p.address]?.round === this.state.round),
      /** Living (and ghost-voting) players who still owe a vote today. */
      awaitingVotes:
        this.state.round >= 1
          ? this.state.players
              .filter(
                (p) =>
                  (p.alive || this.state.ghostVote?.[p.address] === "granted") &&
                  this.state.votes[p.address] === undefined &&
                  !this.drunkToday(p.address),
              )
              .map((p) => p.name)
          : [],
      /** Has the werebear chosen tonight? Never says who is choosing. */
      nightDecided: this.state.nightPick !== null,
      stillShopping: this.state.players
        .filter((p) => p.alive && this.state.doneShopping[p.address]?.round !== this.state.round)
        .map((p) => p.name),
      /** Shops shut for everyone today (a holiday). Per-player locks stay
       *  secret: the barred villager finds out at the door. */
      closedShops: this.state.closures
        .filter((c) => c.round === this.state.round && !c.player)
        .map((c) => c.shop),
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
    // An empty roster has no graph: return before touching the network. The
    // app polls /graph for a game id it hasn't joined yet, and this route is
    // unauthenticated — without this, GET /games/<anything>/graph spun up a DO
    // and pulled the whole token feed for a game that does not exist.
    if (this.state.players.length === 0) {
      return { round: 0, players: [], edges: [], deposits: [] };
    }
    // Keep the sightings fresh; sync() throttles for every caller now.
    await this.sync();
    const purchases = await this.loadAll();
    const nameOf = (addr: string) =>
      this.state.players.find((p) => p.address === addr)?.name ??
      `${addr.slice(0, 4)}…${addr.slice(-4)}`;
    // Deposits are the PUBLIC side of the token — amounts included. Only the
    // seated players' deposits belong in this game's feed.
    const roster = new Set(this.state.players.map((p) => p.address));
    const born = this.state.createdLedger ?? 0;
    const deposits = (await this.loadDepositsCached()).filter(
      (d) =>
        roster.has(d.to) &&
        // In-game rounds are already this game's ledger windows; round-0
        // (lobby) deposits count only after the game was born. Games from
        // before this field existed fall back to in-game rounds only.
        (d.round >= 1 || (born > 0 && d.ledger >= born)),
    );
    return {
      round: this.state.round,
      players: this.state.players.map((p) => ({
        seat: p.seat,
        name: p.name,
        address: p.address,
        alive: p.alive,
      })),
      // Round 0 is setup (funding, registration, settling up with the Order) —
      // not a sighting anyone should be reading tea leaves from.
      edges: purchases
        .filter((p) => p.round >= 1)
        .map((p) => ({
          round: p.round,
          ledger: p.ledger,
          txHash: p.txHash,
          from: p.player ?? `${p.from.slice(0, 4)}…${p.from.slice(-4)}`,
          to: p.toLabel,
        })),
      // Gerald's reliquary: village-wide extremity counts drive the unlock
      // ladder (8 fingers → 2 thumbs → 10 toes; Bri, 2026-08-17).
      relics: (({ fingers, thumbs, toes }) => ({ fingers, thumbs, toes }))(
        this.relicCredits(purchases),
      ),
      deposits: deposits.map((d) => ({
        round: d.round,
        ledger: d.ledger,
        txHash: d.txHash,
        player: nameOf(d.to),
        amountXlm: d.amountXlm,
      })),
    };
  }

  /** Did this villager declare a barrel today? (The beast is unaffected.) */
  private drunkToday(address: string): boolean {
    if (this.state.roles?.[address] === "werebear") return false;
    return (this.state.drunkards ?? {})[address] === this.state.round;
  }

  /**
   * A door barred yesterday voids what you buy behind it today: the chain
   * cannot refuse a transfer, so the shopkeeper keeps the coin and the item
   * does nothing. Audits still see the spend; only EFFECTS are voided.
   */
  private isVoided(p: Purchase, round: number): boolean {
    return (
      p.round === round &&
      p.shopId !== null &&
      this.state.closures.some(
        (c) => c.round === round && c.shop === p.shopId && (!c.player || c.player === p.player),
      )
    );
  }

  /**
   * The market has just shut: read the day's ledger ONCE and remember who is
   * drinking. The vote gate has to answer "are you drunk?" the instant a hand
   * goes up, and decrypting the chain mid-vote is far too slow — so the barrel
   * needs no declaration, only a purchase.
   */
  /** Idempotent per round, and reachable from any path that shuts the market. */
  private async closeMarketIfDone(): Promise<void> {
    if (this.state.drunkSnapshotRound === this.state.round) return;
    if (!this.marketClosed()) return;
    await this.snapshotDrunkards();
    this.state.drunkSnapshotRound = this.state.round;
    // The market just closed → start the vote clock so dawn can never stall on
    // a vote (or the bear's pick) that never comes.
    this.state.marketClosedAt = Date.now();
    await this.ctx.storage.setAlarm(this.state.marketClosedAt + this.voteDeadlineMs());
  }

  /** Freeze-proofing: end shopping for every living straggler so the day can
   *  proceed. A forced-done player is pinned at a sentinel ledger, so the
   *  "bought after Done" audit never falsely accuses them. */
  private forceCloseMarket(): void {
    const round = this.state.round;
    for (const p of this.state.players) {
      if (p.alive && this.state.doneShopping[p.address]?.round !== round) {
        this.state.doneShopping[p.address] = { round, ledger: Number.MAX_SAFE_INTEGER };
      }
    }
  }

  private marketDeadlineMs(): number {
    return Number(this.env.MARKET_DEADLINE_MS ?? "") || 300_000;
  }
  private voteDeadlineMs(): number {
    return Number(this.env.VOTE_DEADLINE_MS ?? "") || 120_000;
  }

  /** `known` lets a caller that has already loaded the day's purchases reuse
   *  them rather than pay for a second read. */
  private async snapshotDrunkards(known?: Purchase[]): Promise<void> {
    const round = this.state.round;
    const effective = (known ?? (await this.loadAll())).filter((p) => !this.isVoided(p, round));
    for (const p of this.state.players) {
      if (!p.alive || this.state.roles?.[p.address] === "werebear") continue;
      if (this.bought(effective, p.address, "barrel_of_beer", { round })) {
        (this.state.drunkards ??= {})[p.address] = round;
      }
    }
  }

  /**
   * This player's own purchases, decrypted server-side — the authoritative
   * answer to "what have I spent this game?" The app's money maths used to
   * be localStorage-only, so a second device thought you'd spent nothing and
   * invited you to re-collect your whole allowance, walking you into the
   * dawn audit (issue #16). Identity pre-verified; only ever your own rows.
   */
  async myPurchases(address: string): Promise<{
    spentStroops: string;
    spent: { horseshoe_nail: number; pizza_party: number };
    ghostVoteDecided: boolean;
    /** Shops a cold iron key barred for THIS player today (Bri, 2026-08-18:
     *  the victim sees big X's — no more blind coin into a locked door). */
    lockedShops: string[];
    /** This player's ladder-legal relic credits — the reliquary's truth. */
    relics: { fingers: number; thumbs: number; toes: number };
    purchases: {
      round: number;
      ledger: number;
      txHash: string;
      shopId: string | null;
      shopLabel: string;
      item: string | null;
      amountStroops: string;
      amountXlm: string;
    }[];
  }> {
    const player = this.playerByAddress(address);
    if (!player) throw new Error("that address holds no seat in this game");
    const all = await this.loadAll();
    const purchases = all.filter((x) => x.from === address && x.round >= 1 && !x.isSurrender);
    // Ladder legality is a village-wide replay: my thumb counts only if the
    // village's fingers were sold out when I bought it.
    const credits = this.relicCredits(all);
    const mine = (guess: string) =>
      purchases.filter((x) => x.itemGuess === guess && credits.credited.has(x.txHash)).length;
    return {
      relics: {
        fingers: mine("Gerald's finger"),
        thumbs: mine("Gerald's thumb"),
        toes: mine("Gerald's toe"),
      },
      spentStroops: purchases.reduce((a, x) => a + x.amountStroops, 0n).toString(),
      // What the satchel needs: which until-spent items have already fired.
      spent: {
        horseshoe_nail: (this.state.nailUsed ?? {})[address] ?? 0,
        pizza_party: (this.state.pizzaUsed ?? {})[address] ?? 0,
      },
      ghostVoteDecided: Boolean((this.state.ghostVote ?? {})[address]),
      lockedShops: this.state.closures
        .filter((c) => c.round === this.state.round && c.player === player.name)
        .map((c) => c.shop),
      purchases: purchases.map((x) => ({
        round: x.round,
        ledger: x.ledger,
        txHash: x.txHash,
        shopId: x.shopId,
        shopLabel: x.toLabel,
        item: x.itemGuess,
        amountStroops: x.amountStroops.toString(),
        amountXlm: x.amountXlm,
      })),
    };
  }

  /** Send a whisper. Completely secret: no public event, no sighting —
   *  only sender and recipient ever see it. Capped like chat. */
  async sendDm(address: string, toName: string, text: string): Promise<{ sent: boolean }> {
    if (this.state.phase === "ended") throw new Error(`game over — ${this.state.winner} won`);
    const from = this.playerByAddress(address);
    if (!from) throw new Error("that address holds no seat in this game");
    // No liveness check by design (Bri, 2026-08-27): the dead already speak in
    // the public square as ghosts, so they may whisper too. A security-audit
    // note flagged the missing alive-check — this comment records that it is
    // intentional, not an oversight.
    const to = this.playerByName(String(toName));
    if (!to) throw new Error(`no villager named "${String(toName)}"`);
    if (to.address === address) throw new Error("whispering to yourself draws looks");
    const clean = String(text).trim().slice(0, 280);
    if (!clean) throw new Error("whisper something");
    (this.state.dms ??= []).push({
      round: this.state.round,
      from: from.name,
      to: to.name,
      text: clean,
      at: new Date().toISOString(),
    });
    if (this.state.dms.length > 500) this.state.dms.splice(0, this.state.dms.length - 500);
    await this.persist();
    return { sent: true };
  }

  /** Your whispers, both directions. Identity pre-verified. */
  async myDms(address: string): Promise<{
    dms: { round: number; from: string; to: string; text: string; at: string }[];
  }> {
    const me = this.playerByAddress(address);
    if (!me) throw new Error("that address holds no seat in this game");
    return {
      dms: (this.state.dms ?? []).filter((d) => d.from === me.name || d.to === me.name),
    };
  }

  /** Private dawn facts (the dogs) for ONE player — identity pre-verified. */
  notesFor(address: string): { round: number; text: string }[] {
    return (this.state.privateNotes ?? {})[address] ?? [];
  }

  /** GM god-view of the current round: decrypted purchases + votes + pick. */
  async godView(): Promise<Record<string, unknown>> {
    this.requireGame();
    await this.sync();
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

  /**
   * Poke the indexer and drop the memo. Throttled: eight players clicking Done
   * in the same second produced eight sync POSTs to a single-instance worker.
   * 3s (not the old graph path's 20s) because aimItem and declareDone are
   * looking for a purchase that is seconds old.
   */
  private async sync(): Promise<void> {
    this.chain = null; // the caller wants fresh — always invalidate
    if (Date.now() - this.lastSync < 3_000) return;
    this.lastSync = Date.now();
    await syncIndexer(this.env);
  }

  /** The ledger this game was born at; 0 for games predating the field. */
  private startLedger(): number {
    return this.state.createdLedger || 0;
  }

  private async loadChainCached(): Promise<{ purchases: Purchase[]; deposits: DepositRec[] }> {
    if (this.chain && Date.now() - this.chain.at < 3_000) return this.chain.data;
    const data = await loadChain(
      this.env,
      this.state.players,
      this.state.rounds,
      this.startLedger(),
    );
    this.chain = { at: Date.now(), data };
    return data;
  }

  private async loadAll(): Promise<Purchase[]> {
    return (await this.loadChainCached()).purchases;
  }

  private async loadDepositsCached(): Promise<DepositRec[]> {
    return (await this.loadChainCached()).deposits;
  }

  private async factContext(): Promise<FactContext> {
    return {
      purchases: await this.loadAll(),
      players: this.state.players,
      currentRound: this.state.round,
    };
  }
}
