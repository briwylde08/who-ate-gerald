/**
 * Deploy the game's sovereign confidential-token stack on testnet:
 *
 *   1. OUR auditor registry (confidential_auditor.wasm via stellar CLI),
 *      initialized with a key WE generate — this is the whole point: the
 *      game's AI Auditor must hold the auditor secret, and on the shared
 *      demo deployment somebody else holds it.
 *   2. The game token via the demo's SHARED factory + verifier (6 VKs
 *      already registered — zero admin setup), pointed at our auditor.
 *
 * Writes:
 *   config/local.auditor.json     (gitignored) — auditor secret k
 *   config/local.deployer.json    (gitignored) — deployer keypair
 *   config/deployment.testnet.json             — addresses, committed
 *
 * Idempotent-ish: refuses to overwrite an existing deployment config unless
 * FORCE=1 (a fresh stack = a fresh economy; don't nuke one by accident).
 *
 * Usage: npm run deploy:stack
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Keypair } from "@stellar/stellar-sdk";
import {
  ChainClient,
  keypairSigner,
  deployVanillaToken,
  randomSalt,
  randomScalar,
  toHex32,
  fromHex,
  bytesToHex,
  pointToBytes,
} from "@ctd/sdk";
import { auditorPublicKey } from "@ctd/sdk/auditor";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const configDir = join(repoRoot, "config");

// Shared testnet infrastructure from brozorec/stellar-confidential-token-demo
// (same constants as axe-and-ember/scripts/deploy-token.ts). We reuse the
// factory and verifier; the auditor is deliberately NOT the shared one.
const RPC_URL = "https://soroban-testnet.stellar.org";
const PASSPHRASE = "Test SDF Network ; September 2015";
const FACTORY = "CDX4DBNWDMD7BVZCOJPTXVTBRXU2RG7JUOZKOOUX5RVWWWWIGV2LWS6Z";
const VERIFIER = "CDCET36PIS44DWJM5UQSSI4ZHGRDSBIIQW4G4ALPYK3Y6FEQGY5ZWFXL";
const UNDERLYING_XLM_SAC = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
const AUDITOR_WASM = join(repoRoot, "packages/ctd-sdk/contracts/confidential_auditor.wasm");
const FRIENDBOT = "https://friendbot.stellar.org";

const deploymentPath = join(configDir, "deployment.testnet.json");

function cli(args: string[]): string {
  return execFileSync("stellar", args, { encoding: "utf8" }).trim();
}

async function friendbot(address: string): Promise<void> {
  const res = await fetch(`${FRIENDBOT}?addr=${encodeURIComponent(address)}`);
  if (!res.ok && res.status !== 400) throw new Error(`friendbot ${address}: ${res.status}`);
}

function loadOrCreateJson<T>(path: string, create: () => T): T {
  if (existsSync(path)) return JSON.parse(readFileSync(path, "utf8")) as T;
  const value = create();
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
  return value;
}

async function main() {
  if (existsSync(deploymentPath) && process.env.FORCE !== "1") {
    console.error(`refusing to overwrite ${deploymentPath} — a fresh stack is a fresh economy. Set FORCE=1 if you mean it.`);
    process.exit(1);
  }
  mkdirSync(configDir, { recursive: true });

  // 1. Deployer keypair (admin + manager + operator of our auditor registry).
  const deployer = loadOrCreateJson(join(configDir, "local.deployer.json"), () => ({
    secret: Keypair.random().secret(),
  }));
  const kp = Keypair.fromSecret(deployer.secret);
  await friendbot(kp.publicKey());
  console.log(`deployer: ${kp.publicKey()} (funded)`);

  // 2. The auditor secret. THE crown jewel — the AI Auditor's eyes.
  const auditorSecrets = loadOrCreateJson(join(configDir, "local.auditor.json"), () => ({
    k: toHex32(randomScalar()),
  }));
  const kAudPoint = auditorPublicKey(fromHex(auditorSecrets.k));
  const kAudHex = bytesToHex(pointToBytes(kAudPoint));
  console.log(`auditor public key K_aud: ${kAudHex.slice(0, 16)}…`);

  // 3. Deploy + initialize OUR auditor registry via the stellar CLI.
  console.log("deploying auditor registry…");
  const auditorContract = cli([
    "contract", "deploy",
    "--wasm", AUDITOR_WASM,
    "--source-account", deployer.secret,
    "--rpc-url", RPC_URL,
    "--network-passphrase", PASSPHRASE,
    "--",
    "--admin", kp.publicKey(),
    "--manager", kp.publicKey(),
  ]).split("\n").pop()!;
  console.log(`auditor registry: ${auditorContract}`);

  console.log("registering key id 0…");
  cli([
    "contract", "invoke",
    "--id", auditorContract,
    "--source-account", deployer.secret,
    "--rpc-url", RPC_URL,
    "--network-passphrase", PASSPHRASE,
    "--",
    "register_key",
    "--auditor_id", "0",
    "--point", kAudHex,
    "--operator", kp.publicKey(),
  ]);
  console.log("key registered");

  // 4. Deploy the game token via the SHARED factory, wired to OUR auditor.
  const client = new ChainClient({
    rpcUrl: RPC_URL,
    networkPassphrase: PASSPHRASE,
    contracts: { token: FACTORY, verifier: VERIFIER, auditor: auditorContract },
  });
  const signer = keypairSigner(deployer.secret, PASSPHRASE);
  const deployedAtLedger = await client.latestLedger();

  console.log("deploying game token via shared factory…");
  const token = await deployVanillaToken(
    client,
    signer,
    { factory: FACTORY, underlying: UNDERLYING_XLM_SAC, verifier: VERIFIER, auditor: auditorContract },
    randomSalt(),
  );
  console.log(`game token: ${token}`);

  // 5. Verify our key reads back from chain.
  const readBack = await new ChainClient({
    rpcUrl: RPC_URL,
    networkPassphrase: PASSPHRASE,
    contracts: { token, verifier: VERIFIER, auditor: auditorContract },
  }).auditorKey(0);
  const readBackHex = bytesToHex(pointToBytes(readBack));
  if (readBackHex !== kAudHex) throw new Error("auditor key read-back mismatch!");
  console.log("auditor key verified on chain ✓");

  const deployment = {
    network: "testnet",
    rpcUrl: RPC_URL,
    networkPassphrase: PASSPHRASE,
    token,
    verifier: VERIFIER,
    auditor: auditorContract,
    auditorId: 0,
    underlying: UNDERLYING_XLM_SAC,
    factory: FACTORY,
    deployedBy: kp.publicKey(),
    deployedAt: new Date().toISOString(),
    deployedAtLedger,
    indexerUrl: "https://ember-indexer.briana-761.workers.dev",
  };
  writeFileSync(deploymentPath, JSON.stringify(deployment, null, 2) + "\n");
  console.log(`wrote ${deploymentPath}`);
  console.log("\nNEXT: npm run setup:shops · extend the indexer for this contract · npm run health");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
