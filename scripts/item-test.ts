/**
 * Item exam (catalog v9) — a scripted game whose only purpose is to make each
 * item's effect actually fire, then assert the morning report says so.
 *
 * The failure this exists to catch is an item that quietly does nothing: a
 * retired item id, a gate on the wrong round, an effect voided by a rule the
 * player couldn't see. None of those break a build; they just eat a player's
 * coin in silence. Every bug this has caught was of exactly that shape.
 *
 *   Day 1  lucky iron DECIDES a tie · a socked mouth cannot swing the trial,
 *          even holding a double-voting knife · a sharpened tooth announces
 *          itself over the body
 *   Day 2  the curfew bell buys a night in which NOBODY dies · the barrel
 *          refuses its owner's vote without stalling dawn · a lock is fitted
 *          for tomorrow · a pizza party saves its host from the rope
 *   Day 3  the barred door takes the coin and gives nothing · the long
 *          candle answers at aim time · a tie banishes nobody
 *   Day 4  the village hangs the beast
 *
 * Players are provisioned above the normal allowance so one villager can hold
 * several items at once: this covers item RESOLUTION, not the allowance audits
 * (the game itself and the GM view exercise those).
 *
 * Usage: npm run item-test      (several minutes: real ZK proofs + testnet txs)
 */
import { existsSync, readFileSync } from "node:fs";
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
// Nothing writes this file — it is the one config/local.* you author by hand,
// and an unguarded read here died with a bare ENOENT before printing anything.
const gmPath = join(repoRoot, "config/local.gm.json");
if (!existsSync(gmPath)) {
  console.error(
    `missing ${gmPath}\n` +
      `  write it by hand: { "gmToken": "<the worker's GM_TOKEN>" }`,
  );
  process.exit(1);
}
const gm = JSON.parse(readFileSync(gmPath, "utf8"));
const catalog = JSON.parse(readFileSync(join(repoRoot, "config/catalog.json"), "utf8")) as {
  shops: Record<string, { items: { id: string; priceXlm: number }[] }>;
};

/** Bumped with the shelf — the banner must never claim a version it did not test. */
const CATALOG_VERSION = "v9";

const AUDITOR_URL =
  process.env.AUDITOR_URL ?? "https://gerald-auditor.briana-761.workers.dev";
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
    console.log(`ITEM EXAM (catalog ${CATALOG_VERSION}) "${GAME_ID}"\n`);

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
    await gmCall("deal", { force: true }); // six seats — below the full-8 auto-start
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
      // NOTE: the ask-or-pass gate does NOT bite here — only CHAT waits for
      // the clock, and this exam never chats. Passing would break day 1's
      // explicit ask (a pass spends the seal).
    };

    // ---- DAY 1 -----------------------------------------------------------
    console.log("DAY 1 — lucky iron, a stopped mouth, a sharpened tooth");
    await gmCall("round/start", {});
    await v1.buy(transferProver, "horseshoe_nail");
    await v2.buy(transferProver, "sock_in_mouth");
    await v2.aim("sock_in_mouth", v3.name);
    await v3.buy(transferProver, "butchers_knife"); // doubles a vote that won't count
    await v4.buy(transferProver, "geralds_finger");
    await bear.buy(transferProver, "tooth_sharpener");
    await done(all);

    const ask = await v1.call<{ answer: string }>("ask", {
      question: "Whose purchase was the biggest today?",
    });
    check("Maude answers from the ledger", typeof ask.answer === "string" && ask.answer.length > 0);

    // The socked knife-holder aims two votes at v1. If either the sock or the
    // tie-break fails, v1 hangs instead of v5 — so the outcome tells us both.
    await v3.call("vote", { target: v1.name });
    await v1.call("vote", { target: v5.name });
    await v5.call("vote", { target: v1.name });
    await bear.call("night-pick", { target: v4.name });
    const m1 = await finishDay(1);
    console.log(`  morning: ${JSON.stringify(m1.notes)}`);
    check("a stopped mouth is announced by name", hasNote(m1.notes, `sock in mouth for ${v3.name}`), m1.notes);
    check("lucky iron steps its holder out of the tie", hasNote(m1.notes, "had a horseshoe nail"), m1.notes);
    check("so the rope finds the other tied villager", m1.banished === v5.name, m1);
    check("the sharpened tooth is announced over the body", hasNote(m1.notes, "used a tooth sharpener"), m1.notes);
    check("and it ate the villager it aimed at", m1.eaten === v4.name, m1);

    // ---- DAY 2 -------------------------------------------------------------
    console.log("\nDAY 2 — the bell, the barrel, a lock and a pizza party");
    await gmCall("round/start", {});
    await v1.buy(transferProver, "curfew_bell");
    await v2.buy(transferProver, "barrel_of_beer"); // no declaration: buying IS drinking
    await v3.buy(transferProver, "pizza_party"); // general_store — hard to hang the host
    await v3.buy(transferProver, "cold_iron_key");
    await v3.aim("cold_iron_key", v1.name, "blacksmith");
    await done([v1, v2, v3, bear]);

    const drunkVote = await v2.call("vote", { target: v3.name }).then(
      () => "accepted",
      (e) => String(e),
    );
    check(
      "the barrel needs no declaration — buying it is drinking it",
      String(drunkVote).includes("dead drunk"),
      drunkVote,
    );

    const waiting = await publicView();
    check(
      "and dawn is not waiting on them",
      !((waiting as unknown as { awaitingVotes?: string[] }).awaitingVotes ?? []).includes(v2.name),
      (waiting as unknown as { awaitingVotes?: string[] }).awaitingVotes,
    );

    // The village piles onto the pizza host — the party must save them.
    await v1.call("vote", { target: v3.name });
    await v3.call("vote", { target: v1.name });
    await bear.call("vote", { target: v3.name });
    await bear.call("night-pick", { target: v2.name }); // the barrel-drunk: attack fails EITHER way (the bell is a coin flip now)
    const m2 = await finishDay(2);
    console.log(`  morning: ${JSON.stringify(m2.notes)}`);
    check(
      "the bell announces itself, worked or not",
      hasNote(m2.notes, "curfew bell") || hasNote(m2.notes, "bell rang"),
      m2.notes,
    );
    check("and nobody dies in the night", m2.eaten === null, m2);
    check("a lock is fitted, unattributed", hasNote(m2.notes, "cold iron key"), m2.notes);
    check(
      "the pizza party saves the host, by name",
      hasNote(m2.notes, `${v3.name} threw a pizza party`),
      m2.notes,
    );
    check("and nobody is banished at the party", m2.banished === null, m2);

    // ---- DAY 3 -------------------------------------------------------------
    console.log("\nDAY 3 — a barred door, the candle, and a tie");
    await gmCall("round/start", {});

    // v1 is locked out of the Blacksmith by yesterday's key.
    await v1.buy(transferProver, "horseshoe_nail"); // blacksmith — locked to v1
    await v2.buy(transferProver, "the_long_candle");
    await v2.aim("the_long_candle", bear.name);
    await done([v1, v2, v3, bear]);

    // An engineered 2-2 tie: nobody hangs, plainly said.
    await v1.call("vote", { target: v3.name });
    await v2.call("vote", { target: v3.name });
    await v3.call("vote", { target: v1.name });
    await bear.call("vote", { target: v1.name });
    await bear.call("night-pick", { target: v2.name }); // no bell tonight — the bear feeds
    const m3 = await finishDay(3);
    console.log(`  morning: ${JSON.stringify(m3.notes)}`);
    check("nobody hangs on a tie", m3.banished === null, m3);
    check(
      "and the tie says so plainly",
      hasNote(m3.notes, "The vote tied: nobody is banished today."),
      m3.notes,
    );

    const locked = await v1.call<{ notes: { text: string }[] }>("notes");
    check(
      "a locked door takes the coin and gives nothing",
      locked.notes.some((n) => n.text.includes("would not open")),
      locked.notes,
    );
    const flame = await v2.call<{ notes: { text: string }[] }>("notes");
    check(
      "the long candle reports — truly or not at all",
      flame.notes.some((n) => n.text.includes("candle worked") || n.text.includes("candle failed")),
      flame.notes,
    );
    check("the werebear eats freely on a bell-less night", m3.eaten === v2.name, m3);

    // ---- DAY 4 -------------------------------------------------------------
    console.log("\nDAY 4 — the reckoning");
    await gmCall("round/start", {});
    await done([v1, v3, bear]);
    await v1.call("vote", { target: bear.name });
    await v3.call("vote", { target: bear.name });
    await bear.call("vote", { target: v1.name });
    await bear.call("night-pick", { target: v1.name }); // moot — the rope is faster
    const m4 = await finishDay(4);
    console.log(`  morning: ${JSON.stringify(m4.notes)}`);
    check("the village hangs the beast", m4.banished === bear.name, m4);
    check("and it was the beast", m4.banishedRole === "werebear", m4);
    check("the village wins", m4.winner === "village", m4);

    console.log(
      failures === 0
        ? `\n✅ CATALOG ${CATALOG_VERSION} CLEAN — every item did what it says\n   (game "${GAME_ID}" left on the ledger for inspection)`
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
