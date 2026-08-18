/**
 * Bot villagers — fill a game with computer players so humans can playtest
 * with fewer than a full table. Bots genuinely play: provision, join, ready,
 * collect income, shop within the rules (≤2 stores, within allowance),
 * declare done, mutter in the square, vote, and hunt if dealt the werebear.
 * They never ask Maude (bots don't gossip with fortune tellers).
 *
 * Keys persist to config/local.bots.<gameId>.json so a restarted runner
 * resumes the same villagers (balances rebuild from chain events).
 *
 * Usage: npx tsx scripts/bots.ts <gameId> [count=3]   (runs until the game ends)
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Keypair } from "@stellar/stellar-sdk";
import {
  ChainClient,
  keypairSigner,
  deriveKeys,
  generateKeys,
  addressToField,
  toHex32,
  fromHex,
  buildRegisterWitness,
  buildTransferWitness,
  submitRegister,
  submitDeposit,
  submitMerge,
  submitTransfer,
  proverFromArtifact,
  StateEngine,
  MemoryStore,
  type CircuitProver,
  type KeyPair as CtdKeyPair,
  type Signer,
} from "@ctd/sdk";

import { playerAuthMessage } from "../packages/auditor-worker/src/auth";

const require = createRequire(import.meta.url);
const registerCircuit = require("@ctd/sdk/circuits/register.json") as { bytecode: string } & Record<string, unknown>;
const transferCircuit = require("@ctd/sdk/circuits/transfer.json") as { bytecode: string } & Record<string, unknown>;

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dep = JSON.parse(readFileSync(join(repoRoot, "config/deployment.testnet.json"), "utf8"));
const shopsAddr = JSON.parse(readFileSync(join(repoRoot, "config/shops.testnet.json"), "utf8"));
const catalog = JSON.parse(readFileSync(join(repoRoot, "config/catalog.json"), "utf8"));

const AUDITOR_URL =
  process.env.AUDITOR_URL ?? "https://gerald-auditor.briana-761.workers.dev";
const XLM = 10_000_000n;
const START = BigInt(catalog.startingBudgetXlm) * XLM;
const INCOME = BigInt(catalog.dailyIncomeXlm) * XLM;

const [gameId, countArg] = process.argv.slice(2);
const BOT_COUNT = Math.max(1, Math.min(8, Number(countArg ?? 3)));
if (!gameId) {
  console.error("usage: npx tsx scripts/bots.ts <gameId> [count=3]");
  process.exit(1);
}

const BOT_POOL = [
  { name: "Digger Moss", character: "gravedigger" },
  { name: "Nan Petal", character: "midwife" },
  { name: "Quiet Rob", character: "poacher" },
  { name: "Bea Winters", character: "beekeeper" },
  { name: "Whiskers Kate", character: "ratcatcher" },
  { name: "Crusty Pim", character: "baker" },
  { name: "Sozzled Finn", character: "drunk" },
  { name: "Wick Tallow", character: "lamplighter" },
];

const ALL_CHARACTERS = [
  "baker",
  "midwife",
  "gravedigger",
  "drunk",
  "poacher",
  "beekeeper",
  "ratcatcher",
  "lamplighter",
];

const CHAT_LINES = [
  "I saw someone near the treeline at dusk. Just saying.",
  "My money's on whoever bought the most at the Apothecary.",
  "Gerald owed me three XLM. May he rest.",
  "I only bought rope. For... rope reasons.",
  "The Blacksmith's been busy this week, hasn't he?",
  "I don't trust anyone who tithes quietly.",
  "The bear could be ANY of us. Except me.",
  "Somebody's spending like they've got something to prepare for.",
];

/** Pointed fingers — feeds the herd: mentions raise suspicion for everyone. */
const ACCUSE_LINES: ((n: string) => string)[] = [
  (n) => `I've had my eye on ${n} all day.`,
  (n) => `${n} has been awfully quiet about where their coin goes.`,
  (n) => `Did anyone else see ${n} near the Butcher's? Just asking.`,
  (n) => `Something about ${n} doesn't sit right with me.`,
  (n) => `If it isn't ${n}, I'll eat my hat.`,
];

/** Shop list with full items from the catalog — ids, prices, aim needs. */
interface BotWare {
  id: string;
  price: bigint;
  aim?: string;
}
const STORES: { id: string; address: string; items: BotWare[] }[] = Object.entries(
  catalog.shops as Record<string, { items?: { id: string; priceXlm: number; aim?: string }[] }>,
).map(([id, s]) => ({
  id,
  address: shopsAddr[id],
  items: (s.items ?? []).map((it) => ({
    id: it.id,
    price: BigInt(it.priceXlm) * XLM,
    aim: it.aim,
  })),
}));

interface BotSecrets {
  secret: string;
  sk: string;
  lastIncomeRound: number;
  provisioned: boolean;
}
const secretsPath = join(repoRoot, "config", `local.bots.${gameId}.json`);
const store: Record<string, BotSecrets> = existsSync(secretsPath)
  ? JSON.parse(readFileSync(secretsPath, "utf8"))
  : {};
const save = () => writeFileSync(secretsPath, JSON.stringify(store, null, 2));

const rand = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]!;

class BotVillager {
  readonly address: string;
  readonly sig: string;
  private engine: StateEngine;
  private signer: Signer;
  role: "villager" | "werebear" | null = null;
  doneRound = 0;
  votedRound = 0;
  chattedRound = 0;
  pickedRound = 0;
  /** Bear memory: last night's target — if they're still breathing, pick elsewhere. */
  lastPick: string | null = null;

  constructor(
    readonly name: string,
    readonly character: string,
    readonly secrets: BotSecrets,
    private client: ChainClient,
  ) {
    const kp = Keypair.fromSecret(secrets.secret);
    this.address = kp.publicKey();
    this.sig = kp
      .sign(Buffer.from(playerAuthMessage(gameId!, this.address), "utf8"))
      .toString("base64");
    this.signer = keypairSigner(secrets.secret, dep.networkPassphrase);
    this.engine = new StateEngine({
      client,
      store: new MemoryStore(),
      keys: deriveKeys(fromHex(secrets.sk), addressToField(dep.token)),
      address: this.address,
      fromLedger: dep.deployedAtLedger,
    });
  }

  async call<T>(action: string, extra: Record<string, unknown> = {}): Promise<T> {
    const resp = await fetch(`${AUDITOR_URL}/games/${gameId}/p/${action}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address: this.address, signature: this.sig, ...extra }),
    });
    const out = (await resp.json()) as T & { error?: string };
    if (!resp.ok) throw new Error(`${this.name} ${action}: ${out.error ?? resp.status}`);
    return out;
  }

  async provision(registerProver: CircuitProver): Promise<void> {
    if (this.secrets.provisioned) return;
    console.log(`  ${this.name}: provisioning…`);
    await fetch(`https://friendbot.stellar.org?addr=${encodeURIComponent(this.address)}`);
    const existing = await this.client.confidentialBalance(this.address);
    if (!existing) {
      const keys: CtdKeyPair = deriveKeys(fromHex(this.secrets.sk), addressToField(dep.token));
      const w = buildRegisterWitness(keys);
      const { proof } = await registerProver.prove(w.inputs);
      await submitRegister(this.client, this.signer, this.address, dep.auditorId, w, proof);
    }
    await submitDeposit(this.client, this.signer, this.address, this.address, START);
    await submitMerge(this.client, this.signer, this.address);
    this.secrets.provisioned = true;
    save();
    console.log(`  ${this.name}: seated with ${catalog.startingBudgetXlm} XLM`);
  }

  async collectIncome(round: number): Promise<void> {
    if (round < 2 || this.secrets.lastIncomeRound >= round) return;
    await submitDeposit(this.client, this.signer, this.address, this.address, INCOME);
    await submitMerge(this.client, this.signer, this.address);
    this.secrets.lastIncomeRound = round;
    save();
    console.log(`  ${this.name}: collected income (day ${round})`);
  }

  /** 1–2 purchases in ≤2 stores, within spendable — never the shelf's
   *  cheapest when there's a real choice, and aimed items get aimed. */
  async shop(transferProver: CircuitProver, round: number, others: string[]): Promise<void> {
    const state = await this.engine.sync();
    let budget = state.spendable.v;
    // The reliquary ladder (the graph's relic counts are the credited ones):
    // no thumb before the fingers sell out, no toe before the thumbs, and
    // nothing that is already sold out. Bots obey the same shelf as humans.
    let relics = { fingers: 0, thumbs: 0, toes: 0 };
    try {
      const g = (await (await fetch(`${AUDITOR_URL}/games/${gameId}/graph`)).json()) as {
        relics?: { fingers: number; thumbs: number; toes: number };
      };
      if (g.relics) relics = g.relics;
    } catch {
      /* a missing graph just means the bot shops conservatively */
    }
    const relicOpen = (id: string): boolean =>
      id === "geralds_finger"
        ? relics.fingers < 8
        : id === "geralds_thumb"
          ? relics.fingers >= 8 && relics.thumbs < 2
          : id === "geralds_toe"
            ? relics.thumbs >= 2 && relics.toes < 10
            : true;
    const storeCount = 1 + Math.floor(Math.random() * 2);
    const chosen = [...STORES].sort(() => Math.random() - 0.5).slice(0, storeCount);
    for (const s of chosen) {
      let affordable = s.items.filter((it) => it.price <= budget && relicOpen(it.id));
      if (affordable.length === 0) continue;
      if (affordable.length > 1) {
        const cheapest = affordable.reduce((a, b) => (a.price < b.price ? a : b));
        affordable = affordable.filter((it) => it !== cheapest);
      }
      const pick = rand(affordable);
      try {
        await this.pay(transferProver, s.address, pick.price);
        budget -= pick.price;
        console.log(`  ${this.name}: bought something at the ${s.id} (day ${round})`);
        if (pick.aim) await this.aimBought(pick, others);
      } catch (e) {
        console.log(`  ${this.name}: shopping failed (${e instanceof Error ? e.message : e})`);
      }
    }
  }

  /** Point a fresh purchase at somebody (or somewhere) — random but legal. */
  private async aimBought(item: BotWare, others: string[]): Promise<void> {
    const wantsPlayer = item.aim === "player" || item.aim === "player+shop";
    const wantsShop = item.aim === "shop" || item.aim === "player+shop";
    if (wantsPlayer && others.length === 0) return;
    const target = wantsPlayer ? rand(others) : undefined;
    const shop = wantsShop ? rand(STORES).id : undefined;
    try {
      await this.call("aim", { item: item.id, target, shop });
      // Say nothing specific: aims are secrets, and a human player may be
      // watching this very terminal. (Same etiquette as the werebear deal.)
      console.log(`  ${this.name}: aimed something, somewhere`);
    } catch (e) {
      console.log(`  ${this.name}: aim failed (${e instanceof Error ? e.message : e})`);
    }
  }

  private async pay(transferProver: CircuitProver, to: string, amount: bigint): Promise<void> {
    const recipient = await this.client.confidentialBalance(to);
    if (!recipient) throw new Error("shop not registered");
    const kAud = await this.client.auditorKey(dep.auditorId);
    const s = await this.engine.sync();
    if (s.spendable.v < amount) throw new Error("insufficient");
    const w = buildTransferWitness({
      keys: deriveKeys(fromHex(this.secrets.sk), addressToField(dep.token)),
      v: s.spendable.v,
      r: s.spendable.r,
      amount,
      pvkB: recipient.viewingPublicKey,
      kAudR: kAud,
      kAudS: kAud,
    });
    const { proof } = await transferProver.prove(w.inputs);
    await submitTransfer(this.client, this.signer, this.address, to, w, proof);
    await this.engine.setSpendable(w.next);
  }
}

interface PublicView {
  round: number;
  phase: string;
  dealt: boolean;
  winner: string | null;
  marketClosed?: boolean;
  players: {
    name: string;
    address: string;
    alive: boolean;
    character?: string | null;
    ready?: boolean;
    doneToday?: boolean;
    recovering?: boolean;
    ghostVoter?: boolean;
  }[];
  mornings: { round: number; eaten?: string | null; notes?: string[] }[];
  chat?: { name: string; text: string }[];
}

interface GraphView {
  round: number;
  players: { name: string; address: string }[];
  edges: { round: number; from: string; to: string }[];
}

async function publicView(): Promise<PublicView> {
  const resp = await fetch(`${AUDITOR_URL}/games/${gameId}/public`);
  return (await resp.json()) as PublicView;
}

async function graphView(): Promise<GraphView | null> {
  try {
    const resp = await fetch(`${AUDITOR_URL}/games/${gameId}/graph`);
    return (await resp.json()) as GraphView;
  } catch {
    return null;
  }
}

/** "Widow Marta" is mentioned by "Marta" too — match full name or last token. */
function mentions(text: string, name: string): boolean {
  const t = text.toLowerCase();
  const lower = name.toLowerCase();
  if (t.includes(lower)) return true;
  const parts = lower.split(" ");
  return parts.length > 1 && t.includes(parts[parts.length - 1]!);
}

/**
 * Village instincts: score each living candidate's suspicion the way a
 * distractible neighbor would — believe the square, distrust the Butcher's
 * door, never doubt the proven-innocent.
 */
function scoreSuspicion(
  view: PublicView,
  graph: GraphView | null,
  self: { name: string; address: string },
): Map<string, number> {
  const scores = new Map<string, number>();
  const candidates = view.players.filter((p) => p.alive && p.address !== self.address);
  for (const c of candidates) scores.set(c.name, Math.random()); // jitter breaks symmetry

  // The square talks: every mention of a name today is a point of suspicion.
  for (const m of view.chat ?? []) {
    for (const c of candidates) {
      if (m.name !== c.name && mentions(m.text, c.name)) {
        scores.set(c.name, (scores.get(c.name) ?? 0) + 2);
      }
    }
  }

  // The Butcher's door: carnivore-aisle visits raise eyebrows (capped).
  if (graph) {
    for (const c of candidates) {
      const visits = graph.edges.filter(
        (e) => e.from === c.name && e.to === "The Butcher's",
      ).length;
      scores.set(c.name, (scores.get(c.name) ?? 0) + Math.min(visits * 2, 4));
    }
  }

  // Disclosures that smelled of meat.
  for (const m of view.chat ?? []) {
    if (m.name !== "the Order") continue;
    for (const c of candidates) {
      if (m.text.includes(c.name) && /tooth sharpener|musk salve/i.test(m.text)) {
        scores.set(c.name, (scores.get(c.name) ?? 0) + 3);
      }
    }
  }

  // Certified innocents: a charm save proves villagerhood (the bear cannot
  // buy silver). Never vote for the recovering or the once-saved.
  for (const c of candidates) {
    if (c.recovering) scores.set(c.name, -100);
  }
  for (const morning of view.mornings ?? []) {
    for (const note of morning.notes ?? []) {
      if (note.includes("silver charm")) {
        for (const c of candidates) {
          if (note.startsWith(c.name)) scores.set(c.name, -100);
        }
      }
    }
  }
  return scores;
}

function topSuspect(scores: Map<string, number>): string | null {
  let best: string | null = null;
  let bestScore = -Infinity;
  for (const [name, score] of scores) {
    if (score > bestScore) {
      best = name;
      bestScore = score;
    }
  }
  return best;
}

async function main() {
  const client = new ChainClient({
    rpcUrl: dep.rpcUrl,
    networkPassphrase: dep.networkPassphrase,
    contracts: { token: dep.token, verifier: dep.verifier, auditor: dep.auditor },
  });
  const registerProver = proverFromArtifact(registerCircuit);
  const transferProver = proverFromArtifact(transferCircuit);

  try {
    // Which characters are free? Don't collide with the humans.
    const view0 = await publicView();
    const takenNames = new Set(view0.players.map((p) => p.name.toLowerCase()));
    // ...and don't collide with a human's FACE either. The server enforces one
    // character per game, so a bot reaching for a claimed villager (a human on
    // the drunk, say) would take the whole run down with it.
    const takenFaces = new Set(
      view0.players.map((p) => p.character).filter((c): c is string => Boolean(c)),
    );
    const pool = BOT_POOL.filter(
      (b) => !takenNames.has(b.name.toLowerCase()) && !takenFaces.has(b.character),
    ).slice(0, BOT_COUNT);
    const existing = view0.players.filter((p) => store[p.name]).map((p) => p.name);
    for (const name of existing) {
      if (!pool.some((b) => b.name === name)) {
        const meta = BOT_POOL.find((b) => b.name === name);
        if (meta) pool.unshift(meta);
      }
    }

    console.log(`BOTS for "${gameId}": ${pool.map((b) => b.name).join(", ")}\n`);
    const bots: BotVillager[] = [];
    for (const meta of pool.slice(0, BOT_COUNT)) {
      let secrets = store[meta.name];
      if (!secrets) {
        secrets = {
          secret: Keypair.random().secret(),
          sk: toHex32(generateKeys(addressToField(dep.token)).sk),
          lastIncomeRound: 1,
          provisioned: false,
        };
        store[meta.name] = secrets;
        save();
      }
      bots.push(new BotVillager(meta.name, meta.character, secrets, client));
    }

    // Provision + join. If a human already claimed a bot's face, take a free one.
    const botNames = new Set(BOT_POOL.map((b) => b.name.toLowerCase()));
    for (const bot of bots) {
      await bot.provision(registerProver);
      try {
        await bot.call("join", { name: bot.name, character: bot.character });
      } catch (e) {
        if (String(e).includes("claimed")) {
          const now = await publicView();
          const claimed = new Set(now.players.map((p) => p.character).filter(Boolean));
          const free = ALL_CHARACTERS.find((c) => !claimed.has(c));
          await bot
            .call("join", { name: bot.name, character: free ?? "" })
            .catch((e2) => console.log(`  ${String(e2)}`));
        } else if (!String(e).includes("already")) {
          console.log(`  ${String(e)}`);
        }
      }
      console.log(`  ${bot.name}: in the lobby`);
    }

    // Hold the ready — everyone-ready auto-starts the game, and a lobby of
    // nothing but bots would start it without a single human seated.
    console.log("\nwaiting for a human villager before the bots ready up…");
    for (;;) {
      const v = await publicView().catch(() => null);
      if (v?.players.some((p) => !botNames.has(p.name.toLowerCase()))) break;
      // The hold protects an un-started lobby from a bots-only auto-start.
      // If the game is already DEALT (a GM force-dealt a bots-only table),
      // there is nothing left to protect — play.
      if (v?.dealt) break;
      await new Promise((r) => setTimeout(r, 5000));
    }
    for (const bot of bots) {
      await bot.call("ready", { ready: true }).catch(() => undefined);
      console.log(`  ${bot.name}: ready`);
    }

    console.log("\nbots are playing — Ctrl-C to stop; they resume on restart\n");
    let shoppedRound = new Map<string, number>();

    for (;;) {
      const view = await publicView().catch(() => null);
      if (!view) {
        await new Promise((r) => setTimeout(r, 8000));
        continue;
      }
      if (view.winner) {
        console.log(`\nTHE ${view.winner.toUpperCase()} HAS WON — bots retiring.`);
        break;
      }
      // One look at the public sightings per poll — shared by every bot's nose.
      const graph = view.marketClosed ? await graphView() : null;

      for (const bot of bots) {
        const me = view.players.find((p) => p.address === bot.address);
        if (!me) continue;
        if (!me.alive && !me.ghostVoter) continue;
        const isGhost = !me.alive;

        // Learn our fate once dealt.
        if (view.dealt && bot.role === null) {
          const r = await bot.call<{ role: "villager" | "werebear" }>("role").catch(() => null);
          if (r) {
            bot.role = r.role;
            if (r.role === "werebear") console.log(`  (a bot is the werebear — say nothing)`);
          }
        }

        if (view.round >= 1 && view.phase === "day") {
          // Income, shopping, done — once per day. (Ghosts buy nothing.)
          if (!isGhost && (shoppedRound.get(bot.address) ?? 0) < view.round && !me.doneToday) {
            await bot.collectIncome(view.round).catch(() => undefined);
            const others = view.players
              .filter((p) => p.alive && p.address !== bot.address)
              .map((p) => p.name);
            await bot.shop(transferProver, view.round, others);
            await bot.call("done").catch(() => undefined);
            shoppedRound.set(bot.address, view.round);
            console.log(`  ${bot.name}: done shopping (day ${view.round})`);
          }

          if (view.marketClosed) {
            // Stand accused? Comply — let Maude pick the purchase to unseal.
            // Table talk, once a day — half the time, point a finger at the
            // current top suspect. (The bear frames right along with them.)
            if (!isGhost && bot.chattedRound < view.round) {
              bot.chattedRound = view.round;
              if (Math.random() < 0.8) {
                const suspect = topSuspect(scoreSuspicion(view, graph, bot));
                const text =
                  suspect && Math.random() < 0.5 ? rand(ACCUSE_LINES)(suspect) : rand(CHAT_LINES);
                await bot.call("chat", { text }).catch(() => undefined);
              }
            }
            // Vote: herd instinct over the day's chat and the graph. Votes
            // stagger across polls so later voters read the earlier fingers.
            if (
              (isGhost || bot.chattedRound >= view.round) &&
              bot.votedRound < view.round &&
              !me.recovering &&
              Math.random() < 0.6
            ) {
              const target = topSuspect(scoreSuspicion(view, graph, bot));
              if (target) {
                const ok = await bot
                  .call<{ dawn: boolean }>("vote", { target })
                  .catch(() => null);
                if (ok) {
                  bot.votedRound = view.round;
                  // NEVER name the target: a vote is private until dawn, and
                  // this log is read by a human who is playing the game.
                  console.log(`  ${bot.name}: voted${ok.dawn ? " — DAWN" : ""}`);
                }
              }
            }
            // The hunt: finish the wounded first (a shattered charm doesn't
            // grow back); otherwise never test the same door twice.
            const pickIsDead =
              bot.role === "werebear" &&
              bot.pickedRound === view.round &&
              bot.lastPick !== null &&
              view.players.some((p) => p.name === bot.lastPick && !p.alive);
            if (pickIsDead) {
              // Prey banished at the trial: choose again or waste the night
              // (game11: the bear went 0-for-5 partly from exactly this).
              bot.pickedRound = view.round - 1;
            }
            if (!isGhost && bot.role === "werebear" && bot.pickedRound < view.round) {
              let prey = view.players.filter((p) => p.alive && p.address !== bot.address);
              const weak = prey.filter((p) => p.recovering);
              if (weak.length > 0) prey = weak;
              else if (bot.lastPick && prey.length > 1)
                prey = prey.filter((p) => p.name !== bot.lastPick);
              if (prey.length > 0) {
                const target = rand(prey).name;
                const ok = await bot
                  .call<{ dawn: boolean }>("night-pick", { target })
                  .catch(() => null);
                if (ok) {
                  bot.pickedRound = view.round;
                  bot.lastPick = target;
                  console.log(`  (the bot-bear has chosen${ok.dawn ? " — DAWN" : ""})`);
                }
              }
            }
          }
        }
      }
      await new Promise((r) => setTimeout(r, 8000));
    }
  } finally {
    await Promise.all([registerProver.destroy(), transferProver.destroy()]);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
