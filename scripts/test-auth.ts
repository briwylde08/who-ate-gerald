/**
 * Unit test for the worker's player auth (packages/auditor-worker/src/auth.ts)
 * — the highest-risk new code in v2: hand-rolled strkey decode + CRC16 +
 * dual-scheme ed25519 verification. Signs with @stellar/stellar-sdk's Keypair
 * (the ground truth) in both schemes Freighter might use.
 *
 * Usage: npm run test:auth
 */
import { Keypair } from "@stellar/stellar-sdk";
import { createHash } from "node:crypto";

import {
  ed25519PublicKeyFromAddress,
  playerAuthMessage,
  verifyPlayerSignature,
} from "../packages/auditor-worker/src/auth";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  console.log(`  ${ok ? "✓" : "✗"} ${name}${ok ? "" : ` — ${JSON.stringify(detail)}`}`);
  if (!ok) failures++;
}

const kp = Keypair.random();
const address = kp.publicKey();
const gameId = "auth-test";
const message = playerAuthMessage(gameId, address);

// strkey decode matches stellar-sdk's raw key
const decoded = ed25519PublicKeyFromAddress(address);
check(
  "strkey decode matches stellar-sdk",
  Buffer.from(decoded).equals(kp.rawPublicKey()),
);

// bad checksum / bad version rejected
try {
  ed25519PublicKeyFromAddress(address.slice(0, -1) + (address.endsWith("A") ? "B" : "A"));
  check("corrupted address rejected", false);
} catch {
  check("corrupted address rejected", true);
}

// scheme 1: raw message bytes (older Freighter)
const rawSig = kp.sign(Buffer.from(message, "utf8"));
check(
  "raw-message signature verifies",
  verifyPlayerSignature(gameId, address, rawSig.toString("base64")),
);

// scheme 2: SEP-53 (sha256 of prefixed message)
const sep53Digest = createHash("sha256")
  .update("Stellar Signed Message:\n" + message, "utf8")
  .digest();
const sepSig = kp.sign(sep53Digest);
check(
  "SEP-53 signature verifies",
  verifyPlayerSignature(gameId, address, sepSig.toString("base64")),
);

// wrong game id must fail (message binds the game)
check(
  "signature for another game rejected",
  !verifyPlayerSignature("other-game", address, rawSig.toString("base64")),
);

// another key's signature must fail
const other = Keypair.random();
check(
  "another account's signature rejected",
  !verifyPlayerSignature(gameId, address, other.sign(Buffer.from(message)).toString("base64")),
);

// garbage rejected without throwing
check("garbage signature rejected", !verifyPlayerSignature(gameId, address, "bm9wZQ=="));
check("garbage address rejected", !verifyPlayerSignature(gameId, "GNOPE", rawSig.toString("base64")));

console.log(failures === 0 ? "\n✅ AUTH HEALTHY" : `\n❌ ${failures} failure(s)`);
if (failures > 0) process.exit(1);
