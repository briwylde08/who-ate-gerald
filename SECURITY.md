# Security

**Who Ate Gerald?** is a testnet game played for nothing. It exists to show a
real confidential-token payment lifecycle on Stellar, with the game as the
vehicle. Several choices below would be wrong for anything that holds value.
They are listed here so that they read as decisions, not oversights, and so
that nobody borrows a pattern without knowing its edges.

Two audit rounds (a four-agent pass and a four-lane Codex / Claude / Grok pass)
informed this document. The demo-critical findings were fixed before the
first live game. What remains is documented here and accepted for testnet.

## Reporting a problem

Open a GitHub issue. Nothing in this project guards real value, so there is no
private disclosure channel and no bounty. If you find something in the vendored
SDK rather than in this game's code, please also report it upstream (see
"Upstream" below).

## What is ours and what is not

- **Ours:** `packages/app` (the player app), `packages/auditor-worker` (the
  Cloudflare Worker that runs each game and hosts Maude, the auditor), and
  `scripts/`.
- **Not ours:** `packages/ctd-sdk` and `packages/ctd-disclosure`, vendored at a
  pinned commit from
  [`brozorec/stellar-confidential-token-demo`](https://github.com/brozorec/stellar-confidential-token-demo).
  See each package's `VENDORED.md`. Findings in those packages are upstream's
  to fix; this document only records how the game is affected.

Across both audit rounds, our own code carried no critical findings. Its
high-rated items were the deployer secret on the CLI's argv (fixed) and the
socially enforced economic rules (documented below). Secrets were confirmed
absent from the repository and its history. The
dependency tree installs from a lockfile with integrity hashes and contains no
install-time scripts of concern.

## Accepted limitations, by layer

### The confidential-token SDK is an unaudited developer preview

The token wrapper, prover, and auditor code are a testnet preview. Known rough
edges in the vendored SDK that this game inherits:

- Verification-key pinning is optional in disclosure verification. A missing
  trusted key does not fail closed.
- After an RPC failure the indexer is treated as authoritative chain history.
- One-time disclosure nonces are never persisted or consumed, so a disclosure
  bundle is replayable. The game retired selective disclosure as a mechanic; it
  survives only as a GM dashboard demo.
- Signed transaction XDR is submitted without comparison against the envelope
  that was assembled.
- The auditor decrypt path is not bound to the on-chain auditor registry and
  carries no authenticity signal.

The game compensates where it can. Maude reads every transfer through two
independent auditor channels and drops any transfer where they disagree, so a
wrong amount never becomes a game fact.

### The prover fetches its CRS from Aztec's host

The in-browser UltraHonk prover from `@aztec/bb.js` downloads its common
reference string from Aztec's CDN without a checksum, then caches it. This is
ecosystem-wide Barretenberg behavior, not something the game configures. The
practical exposure is availability: a tampered or unavailable CRS stops the
browser from producing proofs the on-chain verifier accepts.

### The seat credential is a replayable bearer token

Proving your seat means signing one fixed message per game and address, with no
nonce and no expiry. The signature is therefore a bearer credential for that
game's duration and is replayable if it leaks. The Worker's CORS origin
allowlist is the compensating control against a hostile page. A
challenge-response scheme is the real fix and is deferred until the game
guards something.

### Client-side secrets live in localStorage

- The **confidential spending key** is derived from a deterministic Freighter
  signature so any device can re-derive it. The browser keeps it in plain text.
- The **seat signature** described above.
- The **GM token**, if you are the GM, typed into the dashboard and kept there.

A cross-site scripting bug in the app would expose all three. The compensating
control is a Content-Security-Policy on the deployed app, which is tracked as
follow-up work. None of these secrets guards anything beyond testnet play money.

### The GM is one shared token

A single wrangler secret unlocks every GM endpoint for every game: the god view,
every role, every whisper, the force-deal and resolve-day escape hatches. The
comparison is not constant-time. Rotate the token freely; it is meant to be
held by one trusted host per event.

### Economic and turn-order rules are socially enforced

The chain cannot refuse a confidential transfer. Nothing on-chain enforces the
equal starting budget, the daily allowance, or the moment at which a purchase
counts. The Worker computes item effects from the whole round and voids what
the rules disallow at dawn. That is enough for a trusted table. It is not enough
against a deliberate adversary, who could:

- fund a wallet from the faucet beyond the allowance and buy a banishment-save
  every trial;
- buy an effect after seeing the votes, since effects are not cut off at the
  moment a player marks Done;
- stack several copies of a single-use item in one day.

All three are fixable by extending the existing void-at-dawn pattern to
over-allowance purchases, a market-close snapshot, and a per-day quantity cap.
They are not implemented because every game so far has been played among
coworkers who wanted to find out who ate Gerald, not to win by accounting.

### Open lobbies can be seat-stuffed

Anyone who can reach the Worker can join any listed game with any wallet.
Games are run by invitation and start when the host says so, which is the
control. There is no rate limiting on unauthenticated endpoints.

### Operational notes for anyone running their own stack

- `npm run item-test` and `npm run bots` default to the maintainer's production
  Worker and print a warning when they do. Set `AUDITOR_URL` to your own.
- `config/` is an allowlist in `.gitignore`. Every `config/local.*` file holds a
  key. Nothing new in that folder is committable unless you name it.
- Worker secrets (`AUDITOR_K`, `GM_TOKEN`, `SHOP_SECRETS`, the OpenAI gateway
  credentials) belong in `wrangler secret put`, never in `vars`, which are
  public in `wrangler.jsonc`.
- `scripts/deploy-stack.ts` passes the deployer secret to the stellar CLI
  through the environment, not argv, and prints only the message and stderr on
  failure. Keep it that way if you extend it.
- `npm run bank-tills -- --for-real` withdraws every shop's balance. Read the
  script before running it against a stack you care about.

## Upstream

Findings in the vendored SDK belong to
[`brozorec/stellar-confidential-token-demo`](https://github.com/brozorec/stellar-confidential-token-demo)
and, behind it, the OpenZeppelin confidential-token work for Stellar. The five
SDK items listed above are good developer-preview feedback and are being
passed along.
