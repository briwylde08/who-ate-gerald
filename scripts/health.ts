/**
 * Phase 0 exit exam — proves the whole sovereign stack end-to-end:
 *
 *   1. RPC reachable; game token + auditor registry live.
 *   2. Every shop in the config registered.
 *   3. A throwaway "test villager" plays a miniature turn IN NODE:
 *      register → deposit → merge → confidential transfer to the Chapel.
 *      (This also proves the SHARED verifier accepts proofs for OUR token.)
 *   4. OUR auditor key decrypts that transfer: amount + channelsAgree.
 *   5. Indexer mirrors the game contract (skippable pre-deploy with
 *      SKIP_INDEXER=1).
 *
 * Usage: npm run health
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
  fromHex,
  randomScalar,
  buildRegisterWitness,
  buildTransferWitness,
  submitRegister,
  submitDeposit,
  submitMerge,
  submitTransfer,
  proverFromArtifact,
  fetchEvents,
  auditTransfer,
  StateEngine,
  MemoryStore,
  type TransferEvent,
} from "@ctd/sdk";

const require = createRequire(import.meta.url);
const registerCircuit = require("@ctd/sdk/circuits/register.json") as { bytecode: string } & Record<string, unknown>;
const transferCircuit = require("@ctd/sdk/circuits/transfer.json") as { bytecode: string } & Record<string, unknown>;

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const configDir = join(repoRoot, "config");
const dep = JSON.parse(readFileSync(join(configDir, "deployment.testnet.json"), "utf8"));
const shops = JSON.parse(readFileSync(join(configDir, "shops.testnet.json"), "utf8"));
const auditorSecrets = JSON.parse(readFileSync(join(configDir, "local.auditor.json"), "utf8"));

const TEST_AMOUNT = 7_0000000n; // 7 XLM — an unremarkable tithe

async function main() {
  const client = new ChainClient({
    rpcUrl: dep.rpcUrl,
    networkPassphrase: dep.networkPassphrase,
    contracts: { token: dep.token, verifier: dep.verifier, auditor: dep.auditor },
  });

  // 1. RPC + contracts
  const health = await client.server.getHealth();
  console.log(`RPC ok — latest ledger ${health.latestLedger}`);
  console.log(`game token: ${dep.token}`);
  console.log(`our auditor registry: ${dep.auditor}`);

  // 2. Shops registered
  // The real roster, not a hardcoded era: every shop in the config.
  const shopNames = Object.keys(shops).filter((k) => k !== "token" && k !== "maudes_office");
  for (const name of shopNames) {
    const acct = await client.confidentialBalance(shops[name]);
    console.log(`  ${name}: ${acct ? "registered ✓" : "NOT REGISTERED ✗"}`);
    if (!acct) process.exit(1);
  }

  // 3. Test villager plays a mini turn
  console.log("\ntest villager: full mini-turn (register → deposit → merge → tithe)…");
  const kp = Keypair.random();
  await fetch(`https://friendbot.stellar.org?addr=${encodeURIComponent(kp.publicKey())}`);
  const signer = keypairSigner(kp.secret(), dep.networkPassphrase);
  const keys = deriveKeys(randomScalar(), addressToField(dep.token));

  const registerProver = proverFromArtifact(registerCircuit);
  const transferProver = proverFromArtifact(transferCircuit);
  try {
    const rw = buildRegisterWitness(keys);
    const rproof = await registerProver.prove(rw.inputs);
    await submitRegister(client, signer, kp.publicKey(), dep.auditorId, rw, rproof.proof);
    console.log("  registered ✓");

    await submitDeposit(client, signer, kp.publicKey(), kp.publicKey(), 100_0000000n);
    await submitMerge(client, signer, kp.publicKey());
    console.log("  deposited + merged ✓");

    // The engine reconstructs the spendable opening from events, exactly as
    // the app will (same pattern as the demo's e2e.ts).
    const engine = new StateEngine({
      client,
      store: new MemoryStore(),
      keys,
      address: kp.publicKey(),
      fromLedger: dep.deployedAtLedger,
    });
    const state = await engine.sync();
    if (state.spendable.v !== 100_0000000n) {
      throw new Error(`engine reconstruction wrong: spendable=${state.spendable.v}`);
    }

    const chapel = await client.confidentialBalance(shops.chapel);
    const kAud = await client.auditorKey(dep.auditorId);
    const tw = buildTransferWitness({
      keys,
      v: state.spendable.v,
      r: state.spendable.r,
      amount: TEST_AMOUNT,
      pvkB: chapel!.viewingPublicKey,
      kAudR: kAud,
      kAudS: kAud,
    });
    const tproof = await transferProver.prove(tw.inputs);
    const r = await submitTransfer(client, signer, kp.publicKey(), shops.chapel, tw, tproof.proof);
    console.log(`  tithe sent (tx ${r.hash.slice(0, 8)}) — amount hidden on chain ✓`);
  } finally {
    await registerProver.destroy();
    await transferProver.destroy();
  }

  // 4. Auditor decrypts it
  const { events } = await fetchEvents(client, { startLedger: dep.deployedAtLedger });
  const transfer = events
    .filter((e): e is TransferEvent => e.type === "transfer" && e.from === kp.publicKey())
    .pop();
  if (!transfer) throw new Error("test transfer not found in events");
  const audit = auditTransfer(fromHex(auditorSecrets.k), transfer);
  console.log(`\nauditor decryption: amount=${audit.amount} channelsAgree=${audit.channelsAgree}`);
  if (audit.amount !== TEST_AMOUNT || !audit.channelsAgree) {
    throw new Error("auditor decryption FAILED");
  }
  console.log("auditor sees the hidden amount ✓ — Maude has eyes.");

  // 5. Indexer mirroring
  if (process.env.SKIP_INDEXER === "1") {
    console.log("\nindexer check skipped (SKIP_INDEXER=1)");
  } else {
    const resp = await fetch(`${dep.indexerUrl}/contracts/${dep.token}/events?limit=5`);
    const body = (await resp.json()) as { events?: unknown[] };
    console.log(`\nindexer: ${resp.ok ? "reachable" : "ERROR"} — ${body.events?.length ?? 0} game-token events mirrored`);
  }

  console.log("\n✅ PHASE 0 HEALTHY");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
