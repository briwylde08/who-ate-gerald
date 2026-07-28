/**
 * Phase 1 exit exam for the Auditor's truth layer (no Claude, no deploy):
 *
 *   LIVE      — pull the game token's events from the deployed indexer via the
 *               Worker-safe path (@ctd/sdk/chain/indexer, no stellar-sdk),
 *               decrypt with our auditor key, and find the health-check's
 *               7-XLM Chapel tithe.
 *   SYNTHETIC — exercise every fact tool + round bucketing against a scripted
 *               round, asserting exact outputs.
 *
 * Usage: npm run test:auditor
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  executeFact,
  loadPurchases,
  roundOf,
  type FactContext,
  type PlayerRef,
  type Purchase,
} from "../packages/auditor-worker/src/facts";
import { stroopsFromXlm, xlmString } from "../packages/auditor-worker/src/catalog";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dep = JSON.parse(readFileSync(join(repoRoot, "config/deployment.testnet.json"), "utf8"));
const auditorSecrets = JSON.parse(
  readFileSync(join(repoRoot, "config/local.auditor.json"), "utf8"),
);

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  console.log(`  ${ok ? "✓" : "✗"} ${name}${ok ? "" : ` — ${JSON.stringify(detail)}`}`);
  if (!ok) failures++;
}

async function live() {
  console.log("LIVE — worker-safe indexer decode + auditor decrypt:");
  const env = {
    INDEXER_URL: dep.indexerUrl as string,
    TOKEN_CONTRACT: dep.token as string,
    AUDITOR_K: auditorSecrets.k as string,
  };
  const purchases = await loadPurchases(env, [], []);
  check("indexer served decodable transfers", purchases.length >= 1, purchases.length);
  const tithe = purchases.find((p) => p.shopId === "chapel" && p.amountXlm === "7");
  check("health-check 7-XLM Chapel tithe decrypts", tithe !== undefined);
  check("both auditor channels agree", purchases.every((p) => p.channelsAgree));
  check(
    "amounts render as XLM strings",
    purchases.every((p) => /^\d+(\.\d+)?$/.test(p.amountXlm)),
  );
}

function synthetic() {
  console.log("\nSYNTHETIC — fact tools on a scripted round:");
  const players: PlayerRef[] = [
    { seat: 1, name: "Ron", address: "GRON", alive: true },
    { seat: 2, name: "Bri", address: "GBRI", alive: true },
    { seat: 3, name: "Tyler", address: "GTYL", alive: true },
  ];
  const rounds = [
    { round: 1, startLedger: 100, endLedger: 199 },
    { round: 2, startLedger: 200, endLedger: null },
  ];
  check("roundOf: pre-game ledger → 0", roundOf(50, rounds) === 0);
  check("roundOf: round-1 ledger", roundOf(150, rounds) === 1);
  check("roundOf: boundary ledger opens round 2", roundOf(200, rounds) === 2);

  const buy = (
    player: string,
    address: string,
    shopId: string,
    toLabel: string,
    xlm: number,
    round: number,
    itemGuess: string | null,
  ): Purchase => ({
    round,
    ledger: 100 * round + 10,
    txHash: "t",
    from: address,
    player,
    shopId,
    toLabel,
    amountStroops: stroopsFromXlm(xlm),
    amountXlm: xlmString(stroopsFromXlm(xlm)),
    itemGuess,
    channelsAgree: true,
  });

  const ctx: FactContext = {
    players,
    currentRound: 2,
    purchases: [
      buy("Ron", "GRON", "blacksmith", "Blacksmith", 30, 2, "Silver charm"),
      buy("Ron", "GRON", "chapel", "Chapel", 3.5, 2, null),
      buy("Bri", "GBRI", "liquor_store", "Liquor Store", 7, 2, "A bottle"),
      buy("Bri", "GBRI", "chapel", "Chapel", 12, 2, null),
      buy("Tyler", "GTYL", "blacksmith", "Blacksmith", 1, 2, "Horseshoe nail"),
      buy("Tyler", "GTYL", "chapel", "Chapel", 5, 2, null),
      buy("Tyler", "GTYL", "blacksmith", "Blacksmith", 30, 1, "Silver charm"),
    ],
  };

  const silver = executeFact(ctx, "who_bought_item", { item: "silver charm", round: 2 });
  check("who_bought_item: Ron bought silver in r2", JSON.stringify(silver.buyers) === '["Ron"]', silver);

  const silverEver = executeFact(ctx, "who_bought_item", { item: "silver charm" });
  check(
    "who_bought_item (all rounds): Ron + Tyler",
    JSON.stringify(silverEver.buyers) === '["Tyler","Ron"]' ||
      JSON.stringify(silverEver.buyers) === '["Ron","Tyler"]',
    silverEver,
  );

  const tithe = executeFact(ctx, "tithe_amount", { player: "bri", round: 2 });
  check("tithe_amount: case-insensitive, exact 12", tithe.totalXlm === "12", tithe);

  const largest = executeFact(ctx, "largest_tithe", { round: 2 });
  check(
    "largest_tithe: Bri at 12",
    largest.amountXlm === "12" && JSON.stringify(largest.payers) === '["Bri"]',
    largest,
  );

  const spent = executeFact(ctx, "total_spent", { player: "Ron", round: 2 });
  check("total_spent: 33.5 incl. tithe", spent.totalXlm === "33.5" && spent.includesTithe === true, spent);

  const atLeast = executeFact(ctx, "paid_at_least", {
    player: "Tyler",
    shop: "Blacksmith",
    min_xlm: 20,
    round: 2,
  });
  check("paid_at_least: Tyler r2 blacksmith ≥20 → false", atLeast.answer === false, atLeast);

  const mine = executeFact(ctx, "purchases_of_player", { player: "Ron", round: 2 });
  check(
    "purchases_of_player excludes tithe",
    mine.count === 1 && (mine.purchases as { item: string }[])[0]?.item === "Silver charm",
    mine,
  );

  const ghost = executeFact(ctx, "tithe_amount", { player: "Gerald", round: 2 });
  check("unknown player → in-character error fact", typeof ghost.error === "string", ghost);

  const badItem = executeFact(ctx, "who_bought_item", { item: "moon rock" });
  check("unknown item → error fact", typeof badItem.error === "string", badItem);
}

async function main() {
  await live();
  synthetic();
  console.log(failures === 0 ? "\n✅ AUDITOR FACT LAYER HEALTHY" : `\n❌ ${failures} failure(s)`);
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
