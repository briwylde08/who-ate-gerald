/**
 * Seat a bot villager in a game's lobby — for testing with fewer humans
 * than the 3-player quorum. The bot only JOINS (signed message, no chain
 * activity): it can be dealt a role and be voted for / eaten, but it has no
 * funds, never shops, never votes, and never hunts. If fate deals it the
 * werebear, re-deal (GM: Deal roles with force) or accept a very quiet game.
 *
 * Usage: npx tsx scripts/bot-join.ts <gameId> [name] [characterId]
 */
import { Keypair } from "@stellar/stellar-sdk";

import { playerAuthMessage } from "../packages/auditor-worker/src/auth";

const AUDITOR_URL = "https://gerald-auditor.briana-761.workers.dev";

const [gameId, name = "Old Tom", characterArg] = process.argv.slice(2);
if (!gameId) {
  console.error("usage: npx tsx scripts/bot-join.ts <gameId> [name] [characterId]");
  process.exit(1);
}

// One face per game — pick the first character nobody has claimed yet.
const ALL_CHARACTERS = [
  "gravedigger",
  "baker",
  "midwife",
  "poacher",
  "schoolteacher",
  "beekeeper",
  "drunk",
  "ratcatcher",
];
let character = characterArg;
if (!character) {
  const pub = (await (
    await fetch(`${AUDITOR_URL}/games/${encodeURIComponent(gameId)}/public`)
  ).json()) as { players?: { character?: string | null }[] };
  const claimed = new Set((pub.players ?? []).map((p) => p.character).filter(Boolean));
  character = ALL_CHARACTERS.find((c) => !claimed.has(c)) ?? "gravedigger";
}

const kp = Keypair.random();
const address = kp.publicKey();
const signature = kp
  .sign(Buffer.from(playerAuthMessage(gameId, address), "utf8"))
  .toString("base64");

const resp = await fetch(`${AUDITOR_URL}/games/${encodeURIComponent(gameId)}/p/join`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ address, signature, name, character }),
});
const body = (await resp.json()) as { seat?: number; error?: string };
if (!resp.ok) {
  console.error(`join failed: ${body.error}`);
  process.exit(1);
}
console.log(`${name} took seat ${body.seat} in "${gameId}" (${address.slice(0, 6)}…)`);

// Bots are always ready — they have nowhere else to be.
const readyResp = await fetch(`${AUDITOR_URL}/games/${encodeURIComponent(gameId)}/p/ready`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ address, signature, ready: true }),
});
const readyBody = (await readyResp.json()) as { readyCount?: number; started?: boolean; error?: string };
if (!readyResp.ok) {
  console.error(`ready failed: ${readyBody.error}`);
  process.exit(1);
}
console.log(
  `${name} is ready (${readyBody.readyCount} ready)${readyBody.started ? " — THE GAME HAS BEGUN" : ""}`,
);
console.log("Bots don't shop, vote, or hunt — if the deal makes it the werebear, re-deal.");
