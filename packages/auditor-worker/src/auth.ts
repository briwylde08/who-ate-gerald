/**
 * Player authentication — proves a request comes from the holder of a seat's
 * Stellar account, using a Freighter-signed message (SEP-53). Worker-safe:
 * pure noble crypto + a ~30-line strkey decoder, no stellar-sdk.
 *
 * The signed message is fixed per (game, address): a bearer credential for
 * the game's duration. Fine for testnet game stakes; a nonce scheme can come
 * later if games ever hold value.
 *
 * Freighter v4 signs per SEP-53 (signature over
 * SHA-256("Stellar Signed Message:\n" + message)); older builds signed the
 * raw message bytes. We accept either — both prove key ownership.
 */
import { ed25519 } from "@noble/curves/ed25519";
import { sha256 } from "@noble/hashes/sha256";

export function playerAuthMessage(gameId: string, address: string): string {
  return [
    "Who Ate Gerald? — player auth v1",
    "",
    "Signing this message proves your seat to the village record-keeper.",
    "Only sign it on Who Ate Gerald?.",
    "",
    `Game: ${gameId}`,
    `Address: ${address}`,
  ].join("\n");
}

const SEP53_PREFIX = "Stellar Signed Message:\n";

/** Verify a player's signature over {@link playerAuthMessage}. */
export function verifyPlayerSignature(
  gameId: string,
  address: string,
  signatureBase64: string,
): boolean {
  let pub: Uint8Array;
  let sig: Uint8Array;
  try {
    pub = ed25519PublicKeyFromAddress(address);
    sig = fromBase64(signatureBase64);
  } catch {
    return false;
  }
  if (sig.length !== 64) return false;
  const message = playerAuthMessage(gameId, address);
  const utf8 = new TextEncoder().encode(message);
  const sep53 = sha256(new TextEncoder().encode(SEP53_PREFIX + message));
  try {
    return ed25519.verify(sig, sep53, pub) || ed25519.verify(sig, utf8, pub);
  } catch {
    return false;
  }
}

// --------------------------------------------------------------------------
// strkey: G... address → raw 32-byte ed25519 public key (SEP-23 subset).
// Layout: base32( versionByte(0x30) || key(32) || crc16xmodem(33 bytes, LE) )
// --------------------------------------------------------------------------

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function ed25519PublicKeyFromAddress(address: string): Uint8Array {
  if (!/^G[A-Z2-7]{55}$/.test(address)) throw new Error("not an ed25519 public-key strkey");
  const data = base32Decode(address);
  if (data.length !== 35) throw new Error("bad strkey length");
  if (data[0] !== 6 << 3) throw new Error("bad strkey version");
  const payload = data.subarray(0, 33);
  const checksum = data[33]! | (data[34]! << 8);
  if (crc16xmodem(payload) !== checksum) throw new Error("bad strkey checksum");
  return data.subarray(1, 33);
}

function base32Decode(s: string): Uint8Array {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of s) {
    const idx = B32.indexOf(ch);
    if (idx === -1) throw new Error(`bad base32 char "${ch}"`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Uint8Array.from(out);
}

function crc16xmodem(data: Uint8Array): number {
  let crc = 0;
  for (const byte of data) {
    let code = (crc >>> 8) & 0xff;
    code ^= byte;
    code ^= code >>> 4;
    crc = (crc << 8) & 0xffff;
    crc ^= code;
    code = (code << 5) & 0xffff;
    crc ^= code;
    code = (code << 7) & 0xffff;
    crc ^= code;
  }
  return crc;
}

function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
