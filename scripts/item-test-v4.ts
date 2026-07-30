/**
 * Catalog v4 item exam — a scripted game whose only purpose is to make every
 * new item's effect actually fire, then assert the morning report says so.
 *
 * The failure this exists to catch is an item that quietly does nothing: the
 * smoked ham once checked a retired item id and would never have fired, and
 * the venison's copy outlived the mechanics it referenced. Neither breaks a
 * build; both just eat a player's coin in silence.
 *
 *   Day 1  nail excuses a tie · bottle rumour · charm save + shattering ·
 *          the dogs whisper privately · Maude's seal spends once
 *   Day 2  ledger book names the big spender · unsealing ritual reads the
 *          accused · smoked ham masks a charm save · musk hoods the sightings
 *   Day 3  forced disclosure after a tie · bear trap wounds the beast ·
 *          votive candle speaks · lantern oil reads the bear
 *
 * Players are provisioned above the normal allowance so one scripted villager
 * can hold several items at once — this exam covers item RESOLUTION, not the
 * allowance audits (those are exercised by the game itself and the GM view).
 *
 * Usage: npm run mini-game:v4      (several minutes: ZK proofs + testnet txs)
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
const registerCircuit = require("@ctd/sdk/circuits/register.json") as { bytecode: string } & Record<
  string,
  unknown
>;
const transferCircuit = require("@ctd/sdk/circuits/transfer.json") as { bytecode: string } & Record<
  string,
  unknown
>;

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dep = JSON.parse(readFileSync(join(repoRoot, "config/deployment.testnet.json"), "utf8"));
const shops = JSON.parse(readFileSync(join(repoRoot, "config/shops.testnet.json"), "utf8"));
const gm = JSON.parse(readFileSync(join(repoRoot, "config/local.gm.json"), "utf8"));
const catalog = JSON.parse(readFileSync(join(repoRoot, "config/catalog.json"), "utf8")) as {
  shops: Record<string, { items: { id: string; priceXlm: number }[] }>;
};

const AUDITOR_URL = "https://gerald-auditor.briana-761.workers.dev";
const GAME_ID = `items-${Date.now().toString(36)}`;
const XLM = 10_000_000n;

/** Price lookup straight from the catalog, so the exam can never drift. */
const PRICE = new Map<string, { shop: string; stroops: bigint }>();
for (const [shopId, shop] of Object.entries(catalog.shops)) {
  for (const item of shop.items ?? []) {
    PRICE.set(item.id, { shop: shopId, stroops: BigInt(item.priceXlm) * XLM });
  }
}

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  console.log(`  ${ok ? "✓" : "✗"} ${name}${ok ? "" : ` — ${JSON.stringify(detail)}`}`);
  if (!ok) failures++;
}
const hasNote = (notes: string[], text: string) => notes.some((n) => n.includes(text));

interface Morning {
  round: number;
  banished: string | null;
  banishedRole: string | null;
  eaten: string | null;
  notes: string[];
  winner: string | null;
}

interface PublicPlayer {
  name: string;
  address: string;
  alive: boolean;
  recovering?: boolean;
  standsAccused?: boolean;
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

async function publicView(): Promise<{
  round: number;
  players: PublicPlayer[];
  mornings: Morning[];
}> {
  const resp = await fetch(`${AUDITOR_URL}/games/${GAME_ID}/public`);
  return (await resp.json()) as { round: number; players: PublicPlayer[]; mornings: Morning[] };
}

/**
 * Close the day and hand back its morning. When every living player has voted
 * and the bear has picked, the game breaks dawn ITSELF — so the GM lever may
 * find the work already done. That is the automated game behaving correctly,
 * not an error: read the morning it wrote.
 */
async function finishDay(round: number): Promise<Morning> {
  try {
    return await gmCall<Morning>("resolve-day", {});
  } catch (e) {
    if (!String(e).includes("dawn has already come")) throw e;
    const morning = (await publicView()).mornings.find((m) => m.round === round);
    if (!morning) throw new Error(`round ${round} resolved itself but wrote no morning`);
    console.log("  (dawn broke on its own — the last vote and the pick were in)");
    return morning;
  }
}

async function graphEdges(): Promise<{ round: number; from: string; to: string }[]> {
  const resp = await fetch(`${AUDITOR_URL}/games/${GAME_ID}/graph`);
  const g = (await resp.json()) as { edges: { round: number; from: string; to: string }[] };
  return g.edges;
}

class Player {
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
    this.sig = kp
      .sign(Buffer.from(playerAuthMessage(GAME_ID, this.address), "utf8"))
      .toString("base64");
    this.signer = keypairSigner(kp.secret(), dep.networkPassphrase);
    this.engine = new StateEngine({
      client,
      store: new MemoryStore(),
      keys,
      address: this.address,
      fromLedger: dep.deployedAtLedger,
    });
  }

  async call<T>(action: string, extra: Record<string, unknown> = {}): Promise<T> {
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

  /** Buy one catalog item by id — the amount IS the item. */
  async buy(transferProver: CircuitProver, itemId: string): Promise<void> {
    const item = PRICE.get(itemId);
    if (!item) throw new Error(`no such item: ${itemId}`);
    const to = shops[item.shop] as string;
    const recipient = await this.client.confidentialBalance(to);
    if (!recipient) throw new Error(`${item.shop} not registered`);
    const kAud = await this.client.auditorKey(dep.auditorId);
    const s = await this.engine.sync();
    const w = buildTransferWitness({
      keys: this.keys,
      v: s.spendable.v,
      r: s.spendable.r,
      amount: item.stroops,
      pvkB: recipient.viewingPublicKey,
      kAudR: kAud,
      kAudS: kAud,
    });
    const { proof } = await transferProver.prove(w.inputs);
    await submitTransfer(this.client, this.signer, this.address, to, w, proof);
    await this.engine.setSpendable(w.next);
    console.log(`    ${this.name} → ${itemId}`);
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
    console.log(`CATALOG v4 ITEM EXAM "${GAME_ID}"\n`);

    // ---- seat four players, deal, learn roles -----------------------------
    const addrF = addressToField(dep.token);
    const all = ["Ada", "Bram", "Cleo", "Dov"].map(
      (name) => new Player(name, deriveKeys(randomScalar(), addrF), Keypair.random(), client),
    );
    for (const p of all) await p.provision(registerProver, 150n * XLM);

    await gmCall("new", {
      players: all.map((p) => ({ name: p.name, address: p.address })),
      force: true,
    });
    await gmCall("deal", {});
    for (const p of all) {
      const r = await p.call<{ role: "villager" | "werebear" }>("role");
      p.role = r.role;
    }
    const bear = all.find((p) => p.role === "werebear")!;
    const [v1, v2, v3] = all.filter((p) => p.role === "villager") as [Player, Player, Player];
    check("one werebear, three villagers", bear !== undefined && v3 !== undefined);
    console.log(`  (the beast is ${bear.name})\n`);

    const done = async (players: Player[]) => {
      for (const p of players) await p.call("done").catch(() => undefined);
    };

    // ---- DAY 1 -----------------------------------------------------------
    console.log("DAY 1 — nail, bottle, charm, the dogs");
    await gmCall("round/start", {});
    await v1.buy(transferProver, "horseshoe_nail");
    await v2.buy(transferProver, "a_bottle");
    await v3.buy(transferProver, "soup_bone");
    await v3.buy(transferProver, "silver_charm");
    await bear.buy(transferProver, "musk_salve");
    await done(all);

    // V2 speaks, so the votive candle has last words to quote on day 3.
    const LAST_WORDS = "If I die, I want it minuted.";
    await v2.call("chat", { text: LAST_WORDS });

    const ask = await v1.call<{ answer: string; fact: { buyers?: string[] } }>("ask", {
      question: "Did anyone buy the silver charm this game?",
    });
    check("Maude names the charm buyer", (ask.fact.buyers ?? []).includes(v3.name), ask.fact);
    const twice = await v1.call("ask", { question: "And the musk salve?" }).then(
      () => false,
      () => true,
    );
    check("second question refused — one seal a day", twice);

    // A two-way tie: the nail-holder should walk, the other should be accused.
    await v1.call("vote", { target: v2.name });
    await v2.call("vote", { target: v1.name });
    await bear.call("night-pick", { target: v3.name });
    const m1 = await finishDay(1);
    console.log(`  morning: ${JSON.stringify(m1.notes)}`);
    check("tie banishes nobody", m1.banished === null, m1);
    check("horseshoe nail excuses the tie", hasNote(m1.notes, "lucky iron"), m1.notes);
    check("the un-nailed villager stands accused", hasNote(m1.notes, "stands accused"), m1.notes);
    check("bottle pours a rumour", hasNote(m1.notes, "Tavern talk"), m1.notes);
    check("silver charm saves and shatters", hasNote(m1.notes, "shards of a silver charm"), m1.notes);
    check("nobody eaten", m1.eaten === null, m1);
    const dogs = await v3.call<{ notes: { round: number; text: string }[] }>("notes");
    check(
      "the dogs whisper privately to the soup-bone buyer",
      dogs.notes.some((n) => n.text.includes("came to YOUR door")),
      dogs.notes,
    );

    // ---- DAY 2 -----------------------------------------------------------
    console.log("\nDAY 2 — ledger book, ritual, ham, musk");
    await gmCall("round/start", {});
    const beforeDay2 = await publicView();
    check(
      "the saved villager spends the day abed",
      beforeDay2.players.find((p) => p.name === v3.name)?.recovering === true,
      beforeDay2.players,
    );
    await v1.buy(transferProver, "silver_charm");
    await v1.buy(transferProver, "unsealing_ritual");
    await v3.buy(transferProver, "ledger_book");
    await bear.buy(transferProver, "smoked_ham");
    await bear.buy(transferProver, "soup_bone");
    await done([v1, v2, v3, bear]);

    // Tie again (nobody banished) so the ritual still has a most-accused to read.
    await v1.call("vote", { target: v2.name });
    await bear.call("vote", { target: v1.name });
    await bear.call("night-pick", { target: v1.name });
    const m2 = await finishDay(2);
    console.log(`  morning: ${JSON.stringify(m2.notes)}`);
    check("ledger book names the day's big spender", hasNote(m2.notes, "ledger book falls open"), m2.notes);
    check("ledger book fingers the actual spender", hasNote(m2.notes, v1.name), m2.notes);
    check("the ritual unseals the accused", hasNote(m2.notes, "ritual unseals"), m2.notes);
    check("smoked ham keeps the night quiet", hasNote(m2.notes, "A quiet night"), m2.notes);
    check(
      "ham hides the silver save entirely",
      !hasNote(m2.notes, "silver charm") && m2.eaten === null,
      m2.notes,
    );
    const edges2 = await graphEdges();
    const round2 = edges2.filter((e) => e.round === 2);
    check(
      "musk salve hoods the wearer's next-day sightings",
      round2.some((e) => e.from === "a hooded figure") && !round2.some((e) => e.from === bear.name),
      round2,
    );

    // ---- DAY 3 -----------------------------------------------------------
    console.log("\nDAY 3 — disclosure, trap, candle, lantern");
    await gmCall("round/start", {});
    const beforeDay3 = await publicView();
    check(
      "a ham-masked save leaves no visible recovery",
      beforeDay3.players.find((p) => p.name === v1.name)?.recovering !== true,
      beforeDay3.players,
    );
    check(
      "yesterday's tie leaves both sides accused",
      beforeDay3.players.filter((p) => p.standsAccused).length === 2,
      beforeDay3.players,
    );
    await v2.buy(transferProver, "bear_trap");
    await v2.buy(transferProver, "votive_candle");
    await v2.buy(transferProver, "lantern_oil");
    await done([v1, v2, v3, bear]);

    // The accused must unseal a purchase before their vote counts again.
    const reveal1 = await v1.call<{ revealed: string }>("disclose", { txHash: "" });
    const reveal2 = await v2.call<{ revealed: string }>("disclose", { txHash: "" });
    check("the accused can unseal to regain their vote", !!reveal1.revealed && !!reveal2.revealed, {
      reveal1,
      reveal2,
    });

    await v1.call("vote", { target: v2.name });
    await v2.call("vote", { target: v1.name });
    await v3.call("vote", { target: bear.name });
    await bear.call("vote", { target: v3.name });
    await bear.call("night-pick", { target: v2.name });
    const m3 = await finishDay(3);
    console.log(`  morning: ${JSON.stringify(m3.notes)}`);
    check("the trap-holder is eaten", m3.eaten === v2.name, m3);
    check("bear trap draws blood", hasNote(m3.notes, "bear trap snapped shut"), m3.notes);
    check("votive candle speaks for the dead", hasNote(m3.notes, "By candlelight"), m3.notes);
    check("the candle quotes their actual last words", hasNote(m3.notes, LAST_WORDS), m3.notes);
    check("lantern oil reads the beast", hasNote(m3.notes, "still-lit lantern"), m3.notes);

    console.log(
      failures === 0
        ? `\n✅ CATALOG v4 CLEAN — every item did what it says\n   (game "${GAME_ID}" left on the ledger for inspection)`
        : `\n❌ ${failures} failure(s) — game "${GAME_ID}"`,
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
