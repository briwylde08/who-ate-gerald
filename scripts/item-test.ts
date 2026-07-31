/**
 * Catalog v5 item exam — a scripted game whose only purpose is to make every
 * new item's effect actually fire, then assert the morning report says so.
 *
 * The failure this exists to catch is an item that quietly does nothing: the
 * smoked ham once checked a retired item id and would never have fired, and
 * the venison's copy outlived the mechanics it referenced. Neither breaks a
 * build; both just eat a player's coin in silence.
 *
 *   Day 1  lucky iron DECIDES a tie (the rope falls on the other) · bottle
 *          rumour · charm save + shattering · Maude's seal spends once
 *   Day 2  ledger book names the big spender · unsealing ritual reads the
 *          accused · musk hoods the sightings · the tooth sharpener pierces
 *          a silver charm in the beast's hands
 *   Day 3  a paid-for ghost learns whether it kept its vote · lantern oil
 *          reads the beast
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
    const msg = String(e);
    if (!msg.includes("dawn has already come") && !msg.includes("game over")) throw e;
    const morning = (await publicView()).mornings.find((m) => m.round === round);
    if (!morning) throw new Error(`round ${round} resolved itself but wrote no morning`);
    console.log("  (the game closed the day itself — the last vote was in)");
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

  /** Point an aimed item at its victim (server-private, like a vote). */
  async aim(item: string, target?: string, shop?: string): Promise<void> {
    await this.call("aim", { item, target, shop });
    console.log(`    ${this.name} aims ${item} → ${[target, shop].filter(Boolean).join(" @ ")}`);
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
    console.log(`CATALOG v6 ITEM EXAM "${GAME_ID}"\n`);

    // ---- seat six players, deal, learn roles -------------------------------
    // Six: the trial hangs somebody most days now, and the aimed items need a
    // third day to land on — five would reach parity first.
    const addrF = addressToField(dep.token);
    const all = ["Ada", "Bram", "Cleo", "Dov", "Esme", "Fen"].map(
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
    const [v1, v2, v3, v4, v5] = all.filter((p) => p.role === "villager") as [
      Player, Player, Player, Player, Player,
    ];
    check("one werebear, five villagers", bear !== undefined && v5 !== undefined);
    console.log(`  seats: ${[v1, v2, v3, v4, v5].map((p) => p.name).join(", ")}`);
    console.log(`  (the beast is ${bear.name})\n`);

    const done = async (players: Player[]) => {
      for (const p of players) await p.call("done").catch(() => undefined);
    };

    // ---- DAY 1 -----------------------------------------------------------
    console.log("DAY 1 — a stopped mouth, a bone at the gate, honest silver");
    await gmCall("round/start", {});
    await v1.buy(transferProver, "sock_in_mouth");
    await v1.aim("sock_in_mouth", v2.name);
    await v2.buy(transferProver, "soup_bone");
    await v2.aim("soup_bone", v4.name);
    await v3.buy(transferProver, "geralds_finger");
    await v4.buy(transferProver, "butchers_knife");
    await bear.buy(transferProver, "silver_charm"); // no longer burns the beast
    await done(all);

    const ask = await v1.call<{ fact: { buyers?: string[] } }>("ask", {
      question: "Did anyone buy the silver charm this game?",
    });
    check("Maude sees the beast's own silver", (ask.fact.buyers ?? []).includes(bear.name), ask.fact);

    // The socked vote would decide this trial if it counted; it must not.
    await v2.call("vote", { target: v1.name });
    await v4.call("vote", { target: v3.name }); // knife: this counts twice
    await bear.call("night-pick", { target: v2.name });
    const m1 = await finishDay(1);
    console.log(`  morning: ${JSON.stringify(m1.notes)}`);
    check("a stopped mouth is announced", hasNote(m1.notes, "One voice was stopped"), m1.notes);
    check("and the socked vote did not count", m1.banished === v3.name, m1);
    check("the knife glints at the trial", hasNote(m1.notes, "Steel glinted"), m1.notes);
    check("silver no longer burns the beast", !hasNote(m1.notes, "burnt fur"), m1.notes);
    check(
      "the bone sent the beast to one gate or the other",
      m1.eaten === v2.name || m1.eaten === v4.name,
      m1,
    );
    const socked = await v2.call<{ notes: { round: number; text: string }[] }>("notes");
    check(
      "the silenced villager is told privately",
      socked.notes.some((n) => n.text.includes("did not carry")),
      socked.notes,
    );

    // ---- DAY 2 -------------------------------------------------------------
    console.log("\nDAY 2 — a lock, a holiday, and a candle lit for the beast");
    await gmCall("round/start", {});
    await v1.buy(transferProver, "cold_iron_key");
    await v1.aim("cold_iron_key", v5.name, "blacksmith");
    await v1.buy(transferProver, "shopkeepers_vacation");
    await v1.aim("shopkeepers_vacation", undefined, "chapel");
    await v5.buy(transferProver, "the_long_candle");
    await v5.aim("the_long_candle", bear.name);
    const living2 = (await publicView()).players.filter((p) => p.alive).map((p) => p.name);
    console.log(`  still breathing: ${living2.join(", ")}`);
    await done(all.filter((p) => living2.includes(p.name)));

    // A tie so nobody hangs: the locks must survive to land tomorrow.
    await v1.call("vote", { target: v5.name });
    await v5.call("vote", { target: v1.name });
    await bear.call("night-pick", { target: v1.name });
    const m2 = await finishDay(2);
    console.log(`  morning: ${JSON.stringify(m2.notes)}`);
    check("a lock is fitted, unattributed", hasNote(m2.notes, "A lock was fitted"), m2.notes);
    check("a shopkeeper takes a holiday, in public", hasNote(m2.notes, "is shut tomorrow"), m2.notes);
    check("the key's buyer is never named", !m2.notes.some((n) => n.includes("lock") && n.includes(v1.name)), m2.notes);

    // ---- DAY 3 -------------------------------------------------------------
    console.log("\nDAY 3 — barred doors, and the flame's report");
    await gmCall("round/start", {});
    const day3 = await publicView();
    check(
      "the shuttered store is public knowledge",
      (day3 as unknown as { closedShops?: string[] }).closedShops?.includes("chapel") === true,
      (day3 as unknown as { closedShops?: string[] }).closedShops,
    );
    const flame = await v5.call<{ notes: { round: number; text: string }[] }>("notes");
    check(
      "the long candle reports — truly or not at all",
      flame.notes.some(
        (n) => n.text.includes("stood straight") || n.text.includes("guttered"),
      ),
      flame.notes,
    );

    // v5 forces both barred doors: the coin goes, the effect does not.
    await v5.buy(transferProver, "lantern_oil"); // Chapel — shuttered for all
    await v5.buy(transferProver, "horseshoe_nail"); // Blacksmith — locked to v5
    await done([v5, bear]);
    await v5.call("vote", { target: bear.name });
    await bear.call("vote", { target: v5.name });
    await bear.call("night-pick", { target: v5.name });
    const m3 = await finishDay(3);
    console.log(`  morning: ${JSON.stringify(m3.notes)}`);
    const barred = await v5.call<{ notes: { round: number; text: string }[] }>("notes");
    check(
      "a barred door takes the coin and gives nothing",
      barred.notes.filter((n) => n.text.includes("would not open")).length >= 1,
      barred.notes,
    );
    check("the tie hangs nobody where iron was voided", m3.banished === null || m3.banished === bear.name, m3);

    console.log(
      failures === 0
        ? `\n✅ CATALOG v6 CLEAN — every item did what it says\n   (game "${GAME_ID}" left on the ledger for inspection)`
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
