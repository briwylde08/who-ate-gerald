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
    console.log(`CATALOG v5 ITEM EXAM "${GAME_ID}"\n`);

    // ---- seat five players, deal, learn roles ------------------------------
    // Five, not four: lucky iron hangs a villager on day one now, and four
    // seats would hit parity (bear wins) before day three could run.
    const addrF = addressToField(dep.token);
    const all = ["Ada", "Bram", "Cleo", "Dov", "Esme"].map(
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
    const [v1, v2, v3, v4] = all.filter((p) => p.role === "villager") as [
      Player, Player, Player, Player,
    ];
    check("one werebear, four villagers", bear !== undefined && v4 !== undefined);
    console.log(`  (the beast is ${bear.name})\n`);

    const done = async (players: Player[]) => {
      for (const p of players) await p.call("done").catch(() => undefined);
    };

    // ---- DAY 1 -----------------------------------------------------------
    console.log("DAY 1 — lucky iron decides a tie, bottle, charm");
    await gmCall("round/start", {});
    await v1.buy(transferProver, "horseshoe_nail");
    await v2.buy(transferProver, "a_bottle");
    await v3.buy(transferProver, "silver_charm");
    await bear.buy(transferProver, "musk_salve");
    await done(all);

    // One line of table talk, which also exercises the square.
    await v2.call("chat", { text: "If I die, I want it minuted." });

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
    check("lucky iron steps its holder out of the tie", hasNote(m1.notes, "lucky iron"), m1.notes);
    check("the tie falls on the other villager", m1.banished === v2.name, m1);
    check("bottle pours a rumour", hasNote(m1.notes, "Tavern talk"), m1.notes);
    check("silver charm saves and shatters", hasNote(m1.notes, "shards of a silver charm"), m1.notes);
    check("nobody eaten", m1.eaten === null, m1);

    // ---- DAY 2 -----------------------------------------------------------
    console.log("\nDAY 2 — the pierce, a paid ghost, lantern, readings");
    await gmCall("round/start", {});
    const beforeDay2 = await publicView();
    check(
      "the saved villager spends the day abed",
      beforeDay2.players.find((p) => p.name === v3.name)?.recovering === true,
      beforeDay2.players,
    );
    // v1 tools up for the night AND pre-pays the Order; v3 (abed, but the
    // shops still serve them) buys the readings; the beast sharpens a tooth.
    await v1.buy(transferProver, "silver_charm");
    await v1.buy(transferProver, "unquiet_rest");
    await v1.buy(transferProver, "lantern_oil");
    await v3.buy(transferProver, "ledger_book");
    await v3.buy(transferProver, "a_bottle");
    await v3.buy(transferProver, "unsealing_ritual");
    await bear.buy(transferProver, "tooth_sharpener");
    await done([v1, v3, v4, bear]);

    // A tie so nobody hangs (v3 is abed and cannot vote), leaving the ritual a
    // most-accused to read; the beast eats through v1's silver with the tooth.
    await v1.call("vote", { target: bear.name });
    await bear.call("vote", { target: v1.name });
    await bear.call("night-pick", { target: v1.name });
    const m2 = await finishDay(2);
    console.log(`  morning: ${JSON.stringify(m2.notes)}`);
    check("ledger book names the day's big spender", hasNote(m2.notes, "ledger book falls open"), m2.notes);
    check("ledger book fingers the actual spender", hasNote(m2.notes, v1.name), m2.notes);
    check("bottle pours a rumour", hasNote(m2.notes, "Tavern talk"), m2.notes);
    check("lantern oil reads the beast", hasNote(m2.notes, "still-lit lantern"), m2.notes);
    check(
      "the Order rules on the paid-for ghost, either way",
      hasNote(m2.notes, "keeps its vote") || hasNote(m2.notes, "kept the fee"),
      m2.notes,
    );
    check("the ritual unseals the accused", hasNote(m2.notes, "ritual unseals"), m2.notes);
    check("a sharpened tooth beats silver", m2.eaten === v1.name, m2);
    check("and the village is told why", hasNote(m2.notes, "teeth already sharpened"), m2.notes);
    check("the charm never got to save them", !hasNote(m2.notes, "shards of a silver charm"), m2.notes);
    const edges2 = await graphEdges();
    const round2 = edges2.filter((e) => e.round === 2);
    check(
      "musk salve hoods the wearer's next-day sightings",
      round2.some((e) => e.from === "a hooded figure") && !round2.some((e) => e.from === bear.name),
      round2,
    );

    // ---- DAY 3 -----------------------------------------------------------
    console.log("\nDAY 3 — the ghost votes (or doesn't), and the village decides");
    await gmCall("round/start", {});
    const beforeDay3 = await publicView();
    check(
      "the pierced villager is dead, not recovering",
      beforeDay3.players.find((p) => p.name === v1.name)?.alive === false,
      beforeDay3.players,
    );
    check(
      "death discharges the dead player's disclosure debt",
      beforeDay3.players.find((p) => p.name === v1.name)?.standsAccused !== true,
      beforeDay3.players,
    );
    check(
      "the living half of yesterday's tie still owes one",
      beforeDay3.players.filter((p) => p.alive && p.standsAccused).length === 1,
      beforeDay3.players,
    );
    await done([v3, v4, bear]);

    // Yesterday's tie left the beast itself accused: it must unseal a purchase
    // before it may vote — the ritual's own medicine.
    const bearReveal = await bear.call<{ revealed: string }>("disclose", { txHash: "" });
    check("even the beast must unseal when accused", !!bearReveal.revealed, bearReveal);

    // Did the Order grant v1's ghost a vote? Assert whichever ruling landed.
    const ghostGranted = m2.notes.some((n) => n.includes("keeps its vote"));
    const ghostVoted = await v1
      .call("vote", { target: bear.name })
      .then(() => true, () => false);
    check(
      ghostGranted ? "a granted ghost may vote" : "a refused ghost may not vote",
      ghostVoted === ghostGranted,
      { ghostGranted, ghostVoted },
    );

    await v3.call("vote", { target: bear.name });
    await v4.call("vote", { target: bear.name });
    await bear.call("vote", { target: v3.name });
    await bear.call("night-pick", { target: v3.name });
    const m3 = await finishDay(3);
    console.log(`  morning: ${JSON.stringify(m3.notes)}`);
    check("the village hangs the beast", m3.banished === bear.name, m3);
    check("and it was the beast", m3.banishedRole === "werebear", m3);
    check("the village wins", m3.winner === "village", m3);

    console.log(
      failures === 0
        ? `\n✅ CATALOG v5 CLEAN — every item did what it says\n   (game "${GAME_ID}" left on the ledger for inspection)`
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
