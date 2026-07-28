/**
 * Freighter integration, ported from Axe & Ember (originally from the demo
 * app's freighter/derive-key modules): a Signer over the extension, plus
 * deterministic confidential-key derivation from a signed message.
 *
 * Ed25519 signatures are deterministic (RFC 8032): signing the same message
 * with the same account always yields the same bytes, so
 * `sk = SHA-512(signature) mod r` is stable across devices and browsers and
 * survives localStorage loss. The message folds in the network passphrase and
 * token contract id, so a signature obtained for one deployment cannot derive
 * keys for another.
 */
import {
  isConnected,
  requestAccess,
  signTransaction,
  signMessage as freighterSignMessage,
} from "@stellar/freighter-api";
import { frMod, fromBytesBE, type Signer } from "@ctd/sdk";

import { DEPLOYMENT } from "./deployment";

/** A {@link Signer} that can also sign arbitrary UTF-8 messages (SEP-53). */
export interface MessageSigner extends Signer {
  /** Sign a message and return the raw ed25519 signature bytes. */
  signMessage(message: string): Promise<Uint8Array>;
}

export async function connectFreighter(): Promise<MessageSigner> {
  const conn = await isConnected();
  if (!conn.isConnected) {
    throw new Error(
      "Freighter not detected. The village requires a wallet: install the Freighter extension (freighter.app) and switch it to Testnet.",
    );
  }
  const access = await requestAccess();
  if (access.error) throw new Error(errMsg(access.error));
  const address = access.address;

  return {
    publicKey: address,
    async sign(txXdrBase64: string): Promise<string> {
      const res = await signTransaction(txXdrBase64, {
        networkPassphrase: DEPLOYMENT.networkPassphrase,
        address,
      });
      if (res.error) throw new Error(errMsg(res.error));
      return res.signedTxXdr;
    },
    async signMessage(message: string): Promise<Uint8Array> {
      const res = await freighterSignMessage(message, {
        networkPassphrase: DEPLOYMENT.networkPassphrase,
        address,
      });
      if (res.error) throw new Error(errMsg(res.error));
      if (res.signerAddress !== address) {
        throw new Error(`Freighter signed with ${res.signerAddress}, expected ${address}`);
      }
      return normalizeSignature(res.signedMessage);
    },
  };
}

export function keyDerivationMessage(networkPassphrase: string, tokenContract: string): string {
  return [
    "Who Ate Gerald? — key derivation v1",
    "",
    "Signing this message derives your confidential spending key for the",
    "village ledger. Trust is scarce. Gerald is dead.",
    "Only sign it on Who Ate Gerald?.",
    "",
    `Network: ${networkPassphrase}`,
    `Token contract: ${tokenContract}`,
  ].join("\n");
}

/** Hash a message signature into a nonzero F_r scalar. */
export async function skFromSignature(signature: Uint8Array): Promise<bigint> {
  const digest = await crypto.subtle.digest("SHA-512", signature as BufferSource);
  const sk = frMod(fromBytesBE(new Uint8Array(digest)));
  if (sk === 0n) throw new Error("degenerate key derivation (zero scalar)");
  return sk;
}

function errMsg(e: unknown): string {
  if (typeof e === "string") return e;
  if (e && typeof e === "object" && "message" in e) return String((e as Error).message);
  return JSON.stringify(e);
}

/** Freighter API v4 returns a base64 string; v3 a Buffer (structured-cloned). */
function normalizeSignature(signed: unknown): Uint8Array {
  if (typeof signed === "string") {
    return Uint8Array.from(atob(signed), (c) => c.charCodeAt(0));
  }
  if (signed instanceof Uint8Array) return new Uint8Array(signed);
  if (signed && typeof signed === "object" && Array.isArray((signed as { data?: unknown }).data)) {
    return Uint8Array.from((signed as { data: number[] }).data);
  }
  throw new Error("Freighter returned no usable message signature");
}
