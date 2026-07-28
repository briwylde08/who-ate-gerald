/**
 * Create + register the village's five shop accounts on the game token.
 * Adapted from axe-and-ember/scripts/setup-npcs.ts.
 *
 * Shops are RECEIVE-ONLY: they get one register proof here (Node, one-time)
 * and never prove again — players' confidential purchases just land in each
 * shop's receiving balance forever. No merges, no spending, no runtime keys.
 *
 * Writes:
 *   config/local.shops.json    (gitignored) — keypairs + confidential sk
 *   config/shops.testnet.json              — public addresses, committed
 *
 * Idempotent: skips whatever already exists.
 *
 * Usage: npm run setup:shops
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Keypair } from "@stellar/stellar-sdk";
import {
  ChainClient,
  keypairSigner,
  deriveKeys,
  generateKeys,
  addressToField,
  toHex32,
  fromHex,
  buildRegisterWitness,
  submitRegister,
  proverFromArtifact,
  type KeyPair as CtdKeyPair,
} from "@ctd/sdk";

const require = createRequire(import.meta.url);
const registerCircuit = require("@ctd/sdk/circuits/register.json") as {
  bytecode: string;
} & Record<string, unknown>;

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const configDir = join(repoRoot, "config");
const deployment = JSON.parse(readFileSync(join(configDir, "deployment.testnet.json"), "utf8"));

const FRIENDBOT = "https://friendbot.stellar.org";

/** The village. Order matters nowhere; names are the canonical shop ids. */
const SHOPS = ["blacksmith", "general_store", "apothecary", "liquor_store", "chapel"] as const;

const localPath = join(configDir, "local.shops.json");
const publicPath = join(configDir, "shops.testnet.json");

interface ShopSecrets {
  secret: string;
  sk: string;
}

async function friendbot(address: string): Promise<void> {
  const res = await fetch(`${FRIENDBOT}?addr=${encodeURIComponent(address)}`);
  if (!res.ok && res.status !== 400) throw new Error(`friendbot ${address}: ${res.status}`);
}

async function main() {
  mkdirSync(configDir, { recursive: true });
  const local: Record<string, ShopSecrets> = existsSync(localPath)
    ? JSON.parse(readFileSync(localPath, "utf8"))
    : {};

  const client = new ChainClient({
    rpcUrl: deployment.rpcUrl,
    networkPassphrase: deployment.networkPassphrase,
    contracts: {
      token: deployment.token,
      verifier: deployment.verifier,
      auditor: deployment.auditor,
    },
  });
  const addrF = addressToField(deployment.token);
  const registerProver = proverFromArtifact(registerCircuit);
  const addresses: Record<string, string> = {};

  try {
    for (const name of SHOPS) {
      let secrets = local[name];
      if (!secrets) {
        secrets = { secret: Keypair.random().secret(), sk: toHex32(generateKeys(addrF).sk) };
        local[name] = secrets;
        writeFileSync(localPath, JSON.stringify(local, null, 2));
      }
      const kp = Keypair.fromSecret(secrets.secret);
      const keys: CtdKeyPair = deriveKeys(fromHex(secrets.sk), addrF);
      const address = kp.publicKey();
      addresses[name] = address;

      await friendbot(address);

      const existing = await client.confidentialBalance(address);
      if (existing) {
        console.log(`${name}: already registered (${address.slice(0, 8)}…)`);
        continue;
      }
      console.log(`${name}: proving register…`);
      const w = buildRegisterWitness(keys);
      const { proof } = await registerProver.prove(w.inputs);
      const signer = keypairSigner(secrets.secret, deployment.networkPassphrase);
      const r = await submitRegister(client, signer, address, deployment.auditorId, w, proof);
      console.log(`${name}: registered ${address.slice(0, 8)}… (tx ${r.hash.slice(0, 8)})`);
    }
  } finally {
    await registerProver.destroy();
  }

  writeFileSync(
    publicPath,
    JSON.stringify({ ...addresses, token: deployment.token }, null, 2) + "\n",
  );
  console.log("wrote", publicPath);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
