/**
 * Phase 2 exit exam — a full scripted round against the DEPLOYED stack:
 *
 *   1. Three throwaway villagers provision themselves (register → deposit →
 *      merge), exactly like the app does, but with local keypairs in Node.
 *   2. GM seats the game and opens round 1 on the live gerald-auditor worker.
 *   3. SHOP: Rosie buys the silver charm (30), Tom a bottle (7), Petra a
 *      horseshoe nail (1). TITHE: 3.5 / 12 / 5 XLM.
 *   4. ASK: Maude answers "who bought the silver charm this round?" — the
 *      answer must name Rosie and only Rosie.
 *   5. NIGHT: resolve-night's god-view must show every amount exactly.
 *   6. TRIAL: Tom proves his bottle purchase via selective disclosure; the
 *      GM-side verifier checks it against the chain (the app's trial flow,
 *      end to end, in Node).
 *
 * Usage: npm run mini-game        (~5 minutes: 10 ZK proofs + testnet txs)
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
  hybridFetchEvents,
  IndexerClient,
  deriveEphemeralRE,
  proveSenderDisclosure,
  generateRecipientKeys,
  newDisclosureRequest,
  verifyDisclosure,
  eventRef,
  type CircuitProver,
  type KeyPair as CtdKeyPair,
  type Signer,
  type TransferEvent,
} from "@ctd/sdk";

const require = createRequire(import.meta.url);
const registerCircuit = require("@ctd/sdk/circuits/register.json") as { bytecode: string } & Record<string, unknown>;
const transferCircuit = require("@ctd/sdk/circuits/transfer.json") as { bytecode: string } & Record<string, unknown>;
const discloseSenderCircuit = require("@ctd/disclosure/artifacts/disclose_sender.json") as { bytecode: string } & Record<string, unknown>;
const discloseSenderVk = require("@ctd/disclosure/artifacts/disclose_sender.vk.json") as { vkBase64: string };

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dep = JSON.parse(readFileSync(join(repoRoot, "config/deployment.testnet.json"), "utf8"));
const shops = JSON.parse(readFileSync(join(repoRoot, "config/shops.testnet.json"), "utf8"));
const gm = JSON.parse(readFileSync(join(repoRoot, "config/local.gm.json"), "utf8"));

const AUDITOR_URL = "https://gerald-auditor.briana-761.workers.dev";
const GAME_ID = `mini-${Date.now().toString(36)}`;
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

class ScriptVillager {
  readonly address: string;
  private engine: StateEngine;
  private signer: Signer;

  constructor(
    readonly name: string,
    readonly keys: CtdKeyPair,
    readonly kp: Keypair,
    private client: ChainClient,
  ) {
    this.address = kp.publicKey();
    this.signer = keypairSigner(kp.secret(), dep.networkPassphrase);
    this.engine = new StateEngine({
      client,
      store: new MemoryStore(),
      keys,
      address: this.address,
      fromLedger: dep.deployedAtLedger,
    });
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

  async pay(transferProver: CircuitProver, to: string, amount: bigint): Promise<string> {
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
    const r = await submitTransfer(this.client, this.signer, this.address, to, w, proof);
    await this.engine.setSpendable(w.next);
    return r.hash;
  }
}

async function main() {
  const client = new ChainClient({
    rpcUrl: dep.rpcUrl,
    networkPassphrase: dep.networkPassphrase,
    contracts: { token: dep.token, verifier: dep.verifier, auditor: dep.auditor },
  });
  const indexer = new IndexerClient({ baseUrl: dep.indexerUrl });
  const registerProver = proverFromArtifact(registerCircuit);
  const transferProver = proverFromArtifact(transferCircuit);
  const discloseProver = proverFromArtifact(discloseSenderCircuit);

  try {
    console.log(`MINI-GAME "${GAME_ID}" — three villagers, one round, one wolf-shaped hole\n`);

    // 1. Villagers provision (like the app: register → deposit → merge).
    console.log("provisioning villagers…");
    const addrF = addressToField(dep.token);
    const villagers = ["Rosie", "Tom", "Petra"].map(
      (name) => new ScriptVillager(name, deriveKeys(randomScalar(), addrF), Keypair.random(), client),
    );
    for (const v of villagers) await v.provision(registerProver, 100n * XLM);
    const [rosie, tom, petra] = villagers as [ScriptVillager, ScriptVillager, ScriptVillager];

    // 2. GM seats the game and opens round 1.
    await gmCall("new", {
      players: villagers.map((v) => ({ name: v.name, address: v.address })),
      force: true,
    });
    const r1 = await gmCall<{ round: number; asker: string }>("round/start", {});
    check("round 1 opened", r1.round === 1, r1);

    // 3. SHOP + TITHE.
    console.log("\nshopping (6 confidential transfers)…");
    await rosie.pay(transferProver, shops.blacksmith, 30n * XLM); // the silver charm
    await tom.pay(transferProver, shops.liquor_store, 7n * XLM); // a bottle
    await petra.pay(transferProver, shops.blacksmith, 1n * XLM); // horseshoe nail decoy
    await rosie.pay(transferProver, shops.chapel, 3_5000000n);
    await tom.pay(transferProver, shops.chapel, 12n * XLM);
    await petra.pay(transferProver, shops.chapel, 5n * XLM);
    console.log("  purchases + tithes confirmed");

    // 4. ASK Maude.
    console.log("\nputting the question to Maude…");
    const ask = await gmCall<{ answer: string; fact: { buyers?: string[] } }>("ask", {
      question: "Who, if anyone, bought the silver charm this round?",
      asker: r1.asker,
    });
    console.log(`  Maude: “${ask.answer}”`);
    check(
      "fact names Rosie and only Rosie",
      JSON.stringify(ask.fact.buyers) === '["Rosie"]',
      ask.fact,
    );
    check("answer speaks Rosie's name", /rosie/i.test(ask.answer), ask.answer);

    // 5. NIGHT god-view.
    const night = await gmCall<{
      players: { name: string; purchases: { amountXlm: string; item: string }[]; tithes: string[] }[];
    }>("resolve-night", {});
    const byName = new Map(night.players.map((p) => [p.name, p]));
    check(
      "Rosie: silver charm 30 + tithe 3.5",
      byName.get("Rosie")?.purchases.some((p) => p.amountXlm === "30" && /silver/i.test(p.item)) ===
        true && byName.get("Rosie")?.tithes.includes("3.5") === true,
      byName.get("Rosie"),
    );
    check(
      "Tom: bottle 7 + tithe 12",
      byName.get("Tom")?.purchases.some((p) => p.amountXlm === "7") === true &&
        byName.get("Tom")?.tithes.includes("12") === true,
      byName.get("Tom"),
    );
    check(
      "Petra: nail 1 + tithe 5",
      byName.get("Petra")?.purchases.some((p) => p.amountXlm === "1") === true &&
        byName.get("Petra")?.tithes.includes("5") === true,
      byName.get("Petra"),
    );

    // 6. TRIAL: Tom disclose-proves his bottle; GM-side verify (app flow, in Node).
    console.log("\nTom stands trial (selective disclosure of the bottle)…");
    const { events } = await hybridFetchEvents(client, indexer, { fromLedger: dep.deployedAtLedger });
    const bottle = events.find(
      (e): e is TransferEvent =>
        e.type === "transfer" && e.from === tom.address && e.to === shops.liquor_store,
    );
    if (!bottle) throw new Error("Tom's bottle transfer not found in events");

    const gmKeys = generateRecipientKeys();
    const request = newDisclosureRequest(gmKeys);
    const liquor = await client.confidentialBalance(shops.liquor_store);
    const bundle = await proveSenderDisclosure({
      keys: tom.keys,
      rEScalar: deriveEphemeralRE(tom.keys.vk, bottle.sigma),
      event: bottle,
      pvkB: liquor!.viewingPublicKey,
      request,
      prover: discloseProver,
    });
    check("bundle pins the right event", bundle.refE.id === eventRef(bottle).id);

    const verified = await verifyDisclosure({
      client,
      bundle,
      request,
      keys: gmKeys,
      prover: discloseProver,
      pinnedVk: Uint8Array.from(Buffer.from(discloseSenderVk.vkBase64, "base64")),
      indexer,
    });
    check("disclosure verifies: 7 XLM, sender role", verified.amount === 7n * XLM && verified.role === "sender", {
      amount: verified.amount.toString(),
      role: verified.role,
    });
    check("disclosing account is Tom", verified.disclosingAccount === tom.address);

    console.log(
      failures === 0 ? "\n✅ MINI-GAME CLEAN — the village stands ready" : `\n❌ ${failures} failure(s)`,
    );
    if (failures > 0) process.exit(1);
  } finally {
    await Promise.all([registerProver.destroy(), transferProver.destroy(), discloseProver.destroy()]);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
