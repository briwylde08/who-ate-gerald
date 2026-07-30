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

const AUDITOR_URL = "https://gerald-auditor.briana-761.workers.dev";
const XLM = 10_000_000n;
const START = BigInt(catalog.startingBudgetXlm) * XLM;
const INCOME = BigInt(catalog.dailyIncomeXlm) * XLM;

const [gameId, countArg] = process.argv.slice(2);
const BOT_COUNT = Math.max(1, Math.min(6, Number(countArg ?? 3)));
if (!gameId) {
  console.error("usage: npx tsx scripts/bots.ts <gameId> [count=3]");
  process.exit(1);
}

const BOT_POOL = [
  { name: "Old Tom", character: "gravedigger" },
  { name: "Widow Marta", character: "midwife" },
  { name: "Young Pete", character: "poacher" },
  { name: "Goodwife Anna", character: "beekeeper" },
  { name: "Sexton Grim", character: "ratcatcher" },
  { name: "Miller Jack", character: "baker" },
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

/** Shop list with priced items, from the catalog (chapel included — cover). */
const STORES: { id: string; address: string; prices: bigint[] }[] = Object.entries(
  catalog.shops as Record<string, { items?: { priceXlm: number }[] }>,
).map(([id, s]) => ({
  id,
  address: shopsAddr[id],
  prices: (s.items ?? []).map((it) => BigInt(it.priceXlm) * XLM),
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

  /** 1–2 purchases in ≤2 stores, within spendable. Bears sometimes tool up. */
  async shop(transferProver: CircuitProver, round: number): Promise<void> {
    const state = await this.engine.sync();
    let budget = state.spendable.v;
    const storeCount = 1 + Math.floor(Math.random() * 2);
    const chosen = [...STORES].sort(() => Math.random() - 0.5).slice(0, storeCount);
    for (const s of chosen) {
      const affordable = s.prices.filter((p) => p <= budget);
      if (affordable.length === 0) continue;
      // Bears lean cheap (cover); so do bots generally — they're simple folk.
      const price = rand(affordable.filter((p) => p <= 15n * XLM).concat(affordable.slice(0, 1)));
      try {
        await this.pay(transferProver, s.address, price);
        budget -= price;
        console.log(`  ${this.name}: bought something at the ${s.id} (day ${round})`);
      } catch (e) {
        console.log(`  ${this.name}: shopping failed (${e instanceof Error ? e.message : e})`);
      }
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
  players: { name: string; address: string; alive: boolean; ready?: boolean; doneToday?: boolean }[];
  mornings: { round: number }[];
}

async function publicView(): Promise<PublicView> {
  const resp = await fetch(`${AUDITOR_URL}/games/${gameId}/public`);
  return (await resp.json()) as PublicView;
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
    const pool = BOT_POOL.filter((b) => !takenNames.has(b.name.toLowerCase())).slice(0, BOT_COUNT);
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

    // Provision + join + ready.
    for (const bot of bots) {
      await bot.provision(registerProver);
      await bot.call("join", { name: bot.name, character: bot.character }).catch((e) => {
        if (!String(e).includes("already")) console.log(`  ${String(e)}`);
      });
      await bot.call("ready", { ready: true }).catch(() => undefined);
      console.log(`  ${bot.name}: in the lobby, ready`);
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

      for (const bot of bots) {
        const me = view.players.find((p) => p.address === bot.address);
        if (!me?.alive) continue;

        // Learn our fate once dealt.
        if (view.dealt && bot.role === null) {
          const r = await bot.call<{ role: "villager" | "werebear" }>("role").catch(() => null);
          if (r) {
            bot.role = r.role;
            if (r.role === "werebear") console.log(`  (a bot is the werebear — say nothing)`);
          }
        }

        if (view.round >= 1 && view.phase === "day") {
          // Income, shopping, done — once per day.
          if ((shoppedRound.get(bot.address) ?? 0) < view.round && !me.doneToday) {
            await bot.collectIncome(view.round).catch(() => undefined);
            await bot.shop(transferProver, view.round);
            await bot.call("done").catch(() => undefined);
            shoppedRound.set(bot.address, view.round);
            console.log(`  ${bot.name}: done shopping (day ${view.round})`);
          }

          if (view.marketClosed) {
            // A little table talk, once a day.
            if (bot.chattedRound < view.round && Math.random() < 0.8) {
              bot.chattedRound = view.round;
              await bot.call("chat", { text: rand(CHAT_LINES) }).catch(() => undefined);
            }
            // Vote: random living non-self (the bear frames villagers).
            if (bot.votedRound < view.round) {
              const targets = view.players.filter((p) => p.alive && p.address !== bot.address);
              if (targets.length > 0) {
                const target = rand(targets).name;
                const ok = await bot
                  .call<{ dawn: boolean }>("vote", { target })
                  .catch(() => null);
                if (ok) {
                  bot.votedRound = view.round;
                  console.log(`  ${bot.name}: voted for ${target}${ok.dawn ? " — DAWN" : ""}`);
                }
              }
            }
            // The hunt.
            if (bot.role === "werebear" && bot.pickedRound < view.round) {
              const prey = view.players.filter((p) => p.alive && p.address !== bot.address);
              if (prey.length > 0) {
                const target = rand(prey).name;
                const ok = await bot
                  .call<{ dawn: boolean }>("night-pick", { target })
                  .catch(() => null);
                if (ok) {
                  bot.pickedRound = view.round;
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
