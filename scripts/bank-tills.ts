/**
 * Step 6, performed for real: the shopkeepers bank their tills.
 *
 *   npm run bank-tills             — dry run: open each till, print it, touch nothing
 *   npm run bank-tills -- --for-real   — merge, prove, and WITHDRAW every till to
 *                                        the shop's own G-address as public XLM
 *
 * The one confidential-token step this game never performs on stage. A
 * withdraw needs a ZK proof (the withdraw circuit), which the worker can't
 * run — but this laptop can, the same way the item exam proves transfers.
 * After a real run, each shop's account page on stellar.expert shows a
 * withdraw with the amount PUBLIC: the only other moment (besides deposits)
 * an amount is ever visible on this ledger, and it happens by the owner's
 * own hand.
 *
 * The shops' history is older than the RPC's ~7-day event window, so the
 * state engine reads through the durable indexer to reconstruct each till's
 * opening (v, r) from the whole history.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ChainClient,
  IndexerClient,
  keypairSigner,
  deriveKeys,
  addressToField,
  fromHex,
  buildWithdrawWitness,
  submitMerge,
  submitWithdraw,
  proverFromArtifact,
  StateEngine,
  MemoryStore,
} from "@ctd/sdk";

const require = createRequire(import.meta.url);
const withdrawCircuit = require("@ctd/sdk/circuits/withdraw.json") as {
  bytecode: string;
} & Record<string, unknown>;

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dep = JSON.parse(readFileSync(join(repoRoot, "config/deployment.testnet.json"), "utf8"));
const shopsAddr = JSON.parse(
  readFileSync(join(repoRoot, "config/shops.testnet.json"), "utf8"),
) as Record<string, string>;
const localShops = JSON.parse(
  readFileSync(join(repoRoot, "config/local.shops.json"), "utf8"),
) as Record<string, { secret: string; sk: string }>;

const FOR_REAL = process.argv.includes("--for-real");
const XLM = 10_000_000n;
const fmt = (stroops: bigint) => {
  const whole = stroops / XLM;
  const frac = stroops % XLM;
  return frac === 0n ? `${whole}` : `${whole}.${frac.toString().padStart(7, "0").replace(/0+$/, "")}`;
};

async function main() {
  const client = new ChainClient({
    rpcUrl: dep.rpcUrl,
    networkPassphrase: dep.networkPassphrase,
    contracts: { token: dep.token, verifier: dep.verifier, auditor: dep.auditor },
  });
  const indexer = new IndexerClient({ baseUrl: dep.indexerUrl });
  const kAud = await client.auditorKey(dep.auditorId);
  const prover = proverFromArtifact(withdrawCircuit);

  console.log(
    FOR_REAL
      ? "🏦 BANKING THE TILLS — withdraws will hit the chain\n"
      : "🏦 Counting the tills (dry run — pass --for-real to bank them)\n",
  );

  try {
    for (const [id, address] of Object.entries(shopsAddr)) {
      if (id === "token") continue;
      const sec = localShops[id];
      if (!sec) {
        console.log(`  ${id}: no keys on this machine — skipped`);
        continue;
      }
      const keys = deriveKeys(fromHex(sec.sk), addressToField(dep.token));
      const engine = new StateEngine({
        client,
        store: new MemoryStore(),
        keys,
        address,
        fromLedger: dep.deployedAtLedger,
        indexer,
      });
      const signer = keypairSigner(sec.secret, dep.networkPassphrase);

      let s = await engine.sync();
      // Anything still in the pending balance merges first — a withdraw can
      // only spend the spendable side.
      if (s.receiving.v > 0n) {
        if (FOR_REAL) {
          await submitMerge(client, signer, address);
          s = await engine.sync();
          console.log(`  ${id}: merged ${fmt(s.spendable.v)} XLM into the till first`);
        } else {
          console.log(`  ${id}: (${fmt(s.receiving.v)} XLM uncounted in pending — a real run merges it first)`);
        }
      }
      const total = s.spendable.v + (FOR_REAL ? 0n : s.receiving.v);
      if (total === 0n) {
        console.log(`  ${id}: the till is empty`);
        continue;
      }
      if (!FOR_REAL) {
        console.log(`  ${id}: holds ${fmt(total)} XLM, sealed`);
        continue;
      }

      const w = buildWithdrawWitness({
        keys,
        v: s.spendable.v,
        r: s.spendable.r,
        amount: s.spendable.v,
        kAudS: kAud,
      });
      const { proof } = await prover.prove(w.inputs);
      const r = await submitWithdraw(client, signer, address, address, s.spendable.v, w, proof);
      await engine.setSpendable(w.next);
      console.log(
        `  ${id}: banked ${fmt(s.spendable.v)} XLM — public at last (tx ${r.hash.slice(0, 8)}…)`,
      );
    }
  } finally {
    await prover.destroy();
  }
  console.log(
    FOR_REAL
      ? "\nThe season is banked. Check any shop's account on stellar.expert."
      : "\nNothing moved. The tills keep their secrets.",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
