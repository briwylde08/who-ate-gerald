/**
 * Create + register Maude's office — the Town Treasury's sink — a receive-only
 * account where players surrender excess old-wallet balance before shopping
 * (budget normalization). Same pattern as setup-shops.ts.
 *
 * Usage: npm run setup:treasury
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
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
} from "@ctd/sdk";

const require = createRequire(import.meta.url);
const registerCircuit = require("@ctd/sdk/circuits/register.json") as { bytecode: string } & Record<string, unknown>;

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const configDir = join(repoRoot, "config");
const deployment = JSON.parse(readFileSync(join(configDir, "deployment.testnet.json"), "utf8"));
const localPath = join(configDir, "local.shops.json");
const publicPath = join(configDir, "shops.testnet.json");

async function main() {
  const local = existsSync(localPath) ? JSON.parse(readFileSync(localPath, "utf8")) : {};
  const pub = JSON.parse(readFileSync(publicPath, "utf8"));
  if (pub.maudes_office) {
    console.log(`the Treasury already has an office: ${pub.maudes_office}`);
    return;
  }

  const addrF = addressToField(deployment.token);
  let secrets = local.maudes_office as { secret: string; sk: string } | undefined;
  if (!secrets) {
    secrets = { secret: Keypair.random().secret(), sk: toHex32(generateKeys(addrF).sk) };
    local.maudes_office = secrets;
    writeFileSync(localPath, JSON.stringify(local, null, 2));
  }
  const kp = Keypair.fromSecret(secrets.secret);
  const address = kp.publicKey();

  await fetch(`https://friendbot.stellar.org?addr=${encodeURIComponent(address)}`);

  const client = new ChainClient({
    rpcUrl: deployment.rpcUrl,
    networkPassphrase: deployment.networkPassphrase,
    contracts: { token: deployment.token, verifier: deployment.verifier, auditor: deployment.auditor },
  });
  const registerProver = proverFromArtifact(registerCircuit);
  try {
    const existing = await client.confidentialBalance(address);
    if (!existing) {
      console.log("registering the Treasury's office…");
      const keys = deriveKeys(fromHex(secrets.sk), addrF);
      const w = buildRegisterWitness(keys);
      const { proof } = await registerProver.prove(w.inputs);
      const signer = keypairSigner(secrets.secret, deployment.networkPassphrase);
      const r = await submitRegister(client, signer, address, deployment.auditorId, w, proof);
      console.log(`registered (tx ${r.hash.slice(0, 8)})`);
    }
  } finally {
    await registerProver.destroy();
  }

  pub.maudes_office = address;
  writeFileSync(publicPath, JSON.stringify(pub, null, 2) + "\n");
  console.log(`the Treasury's office: ${address}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
