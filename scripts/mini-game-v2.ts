/**
 * v2 exit exam — a full scripted AUTOMATED game against the deployed stack:
 *
 *   Day 0: three villagers provision (50 XLM buy-in); GM seats + DEALS ROLES;
 *          each player privately fetches their fate with a signed message.
 *   Day 1: the werebear buys venison + musk salve; villager A buys the
 *          silver charm; villager B buys decoys. Villager A spends a private
 *          Maude seal on "who bought fresh venison today?" (and is refused a
 *          second). The vote TIES on purpose; the werebear picks villager A.
 *          Resolution: charm saves the life, musk hides the announcement —
 *          the village sees only "a quiet night."
 *   Day 2: the village votes the werebear out. Village wins.
 *
 * Usage: npm run mini-game:v2      (~6 min: ZK proofs + testnet txs)
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Keypair } from "@stellar/stellar-sdk";
import {
  ChainClient,
  keypairSigner,
  deriveKeys,
  addressToField,
  randomScalar,
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
const shops = JSON.parse(readFileSync(join(repoRoot, "config/shops.testnet.json"), "utf8"));
const gm = JSON.parse(readFileSync(join(repoRoot, "config/local.gm.json"), "utf8"));

const AUDITOR_URL = "https://gerald-auditor.briana-761.workers.dev";
const GAME_ID = `bear-${Date.now().toString(36)}`;
const XLM = 10_000_000n;

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  console.log(`  ${ok ? "✓" : "✗"} ${name}${ok ? "" : ` — ${JSON.stringify(detail)}`}`);
  if (!ok) failures++;
}

async function gmCall<T>(action: string, body?: unknown, method = "POST"): Promise<T> {
  const resp = await fetch(`${AUDITOR_URL}/games/${GAME_ID}/${action}`, {
    method,
    headers: {
      authorization: `Bearer ${gm.gmToken}`,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const out = (await resp.json()) as T & { error?: string };
  if (!resp.ok) throw new Error(`${action}: ${out.error ?? resp.status}`);
  return out;
}

class Bot {
  readonly address: string;
  readonly sig: string;
  private engine: StateEngine;
  private signer: Signer;
  role: "villager" | "werebear" | null = null;

  constructor(
    readonly name: string,
    readonly keys: CtdKeyPair,
    readonly kp: Keypair,
    private client: ChainClient,
  ) {
    this.address = kp.publicKey();
    this.sig = kp.sign(Buffer.from(playerAuthMessage(GAME_ID, this.address), "utf8")).toString("base64");
    this.signer = keypairSigner(kp.secret(), dep.networkPassphrase);
    this.engine = new StateEngine({
      client,
      store: new MemoryStore(),
      keys,
      address: this.address,
      fromLedger: dep.deployedAtLedger,
    });
  }

  async playerCall<T>(action: string, extra: Record<string, unknown> = {}): Promise<T> {
    const resp = await fetch(`${AUDITOR_URL}/games/${GAME_ID}/p/${action}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address: this.address, signature: this.sig, ...extra }),
    });
    const out = (await resp.json()) as T & { error?: string };
    if (!resp.ok) throw new Error(`${this.name} ${action}: ${out.error ?? resp.status}`);
    return out;
  }

  async provision(registerProver: CircuitProver, budget: bigint): Promise<void> {
    await fetch(`https://friendbot.stellar.org?addr=${encodeURIComponent(this.address)}`);
    const rw = buildRegisterWitness(this.keys);
    const { proof } = await registerProver.prove(rw.inputs);
    await submitRegister(this.client, this.signer, this.address, dep.auditorId, rw, proof);
    await submitDeposit(this.client, this.signer, this.address, this.address, budget);
    await submitMerge(this.client, this.signer, this.address);
    console.log(`  ${this.name} seated (${this.address.slice(0, 6)}…)`);
  }

  async pay(transferProver: CircuitProver, to: string, amount: bigint): Promise<void> {
    const recipient = await this.client.confidentialBalance(to);
    if (!recipient) throw new Error(`${to} not registered`);
    const kAud = await this.client.auditorKey(dep.auditorId);
    const s = await this.engine.sync();
    const w = buildTransferWitness({
      keys: this.keys,
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

async function main() {
  const client = new ChainClient({
    rpcUrl: dep.rpcUrl,
    networkPassphrase: dep.networkPassphrase,
    contracts: { token: dep.token, verifier: dep.verifier, auditor: dep.auditor },
  });
  const registerProver = proverFromArtifact(registerCircuit);
  const transferProver = proverFromArtifact(transferCircuit);

  try {
    console.log(`MINI-GAME v2 "${GAME_ID}" — the game runs itself\n`);

    // Day 0 — provision, seat, deal, private role fetch.
    const addrF = addressToField(dep.token);
    const bots = ["Ada", "Bram", "Cleo"].map(
      (name) => new Bot(name, deriveKeys(randomScalar(), addrF), Keypair.random(), client),
    );
    for (const b of bots) await b.provision(registerProver, 50n * XLM);

    await gmCall("new", {
      players: bots.map((b) => ({ name: b.name, address: b.address })),
      force: true,
    });
    await gmCall("deal", {});
    for (const b of bots) {
      const r = await b.playerCall<{ dealt: boolean; role: "villager" | "werebear" }>("role");
      b.role = r.role;
    }
    const bear = bots.find((b) => b.role === "werebear");
    const villagers = bots.filter((b) => b.role === "villager");
    check("exactly one werebear dealt", bear !== undefined && villagers.length === 2, bots.map((b) => b.role));
    const [vA, vB] = villagers as [Bot, Bot];
    console.log(`  the werebear is ${bear!.name} (shh)\n`);

    // A villager may not use the hunt.
    const sneak = await vA.playerCall("night-pick", { target: vB.name }).then(
      () => false,
      () => true,
    );
    check("villager cannot night-pick", sneak);

    // Day 1 — shopping by role.
    const day1 = await gmCall<{ round: number }>("round/start", {});
    check("day 1 opened", day1.round === 1, day1);
    console.log("  shopping (5 confidential transfers)…");
    await bear!.pay(transferProver, shops.general_store, 21n * XLM); // venison
    await bear!.pay(transferProver, shops.apothecary, 13n * XLM); // musk salve
    await vA.pay(transferProver, shops.blacksmith, 30n * XLM); // silver charm
    await vB.pay(transferProver, shops.liquor_store, 1n * XLM); // a nip
    await vB.pay(transferProver, shops.apothecary, 4n * XLM); // bandages

    // Maude, privately: who bought the venison?
    const ask = await vA.playerCall<{ answer: string; fact: { buyers?: string[] } }>("ask", {
      question: "Who bought fresh venison today?",
    });
    console.log(`  Maude (privately, to ${vA.name}): “${ask.answer}”`);
    check("venison fact names the werebear", JSON.stringify(ask.fact.buyers) === JSON.stringify([bear!.name]), ask.fact);
    const second = await vA.playerCall("ask", { question: "And the musk salve?" }).then(
      () => false,
      () => true,
    );
    check("second question refused (seal spent)", second);

    // The vote ties on purpose; the bear marks the charm-holder.
    await vA.playerCall("vote", { target: vB.name });
    await vB.playerCall("vote", { target: vA.name });
    await bear!.playerCall("night-pick", { target: vA.name });

    const m1 = await gmCall<{
      banished: string | null;
      eaten: string | null;
      notes: string[];
      winner: string | null;
    }>("resolve-day", {});
    console.log(`  morning 1: ${JSON.stringify(m1.notes)}`);
    check("tie → nobody banished", m1.banished === null, m1);
    check("charm + musk → nobody eaten, quiet night", m1.eaten === null, m1);
    check(
      "musk hides the silver save (no scorched-charm announcement)",
      !m1.notes.some((n) => n.includes("silver charm")),
      m1.notes,
    );
    check("game continues", m1.winner === null, m1);

    // Day 2 — the village catches on.
    await gmCall("round/start", {});
    await vA.playerCall("vote", { target: bear!.name });
    await vB.playerCall("vote", { target: bear!.name });
    await bear!.playerCall("vote", { target: vA.name });
    await bear!.playerCall("night-pick", { target: vA.name });
    const m2 = await gmCall<{
      banished: string | null;
      banishedRole: string | null;
      eaten: string | null;
      winner: string | null;
    }>("resolve-day", {});
    check("werebear banished", m2.banished === bear!.name && m2.banishedRole === "werebear", m2);
    check("banished bear does not eat", m2.eaten === null, m2);
    check("village wins", m2.winner === "village", m2);

    console.log(
      failures === 0 ? "\n✅ MINI-GAME v2 CLEAN — the game runs itself" : `\n❌ ${failures} failure(s)`,
    );
    if (failures > 0) process.exit(1);
  } finally {
    await Promise.all([registerProver.destroy(), transferProver.destroy()]);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
