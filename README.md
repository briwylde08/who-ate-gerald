# Who Ate Gerald?

**Trust is scarce. Gerald is dead.**

> Villager Gerald has been eaten.

A multiplayer social-deduction game where the evidence is a real
confidential-token ledger on Stellar testnet. Every purchase is a confidential
transfer: the whole village sees **who paid which shop**, nobody sees **how
much** — and because every price in the game is unique, the amount *is* the
item. **Maude McLedger**, who holds the token's auditor key, answers one
private question per villager per day.

Play: **https://who-ate-gerald.pages.dev** (needs Freighter, set to Testnet)

## How the tech IS the game

| Game mechanic | Protocol reality |
|---|---|
| Shop visits are public; what you bought is not | Confidential transfer — parties visible, amount encrypted |
| The price *is* the item | Exact-amount matching against the catalog; every price globally unique |
| Everyone verifiably starts with the same budget | Buy-in and daily income arrive as *public* deposits |
| Maude sees all, answers little | The auditor key decrypts every transfer; one question per villager per day, enforced in code |

Maude's truthfulness is architectural, not behavioural: facts are computed in
code (event decryption plus one narrow fact tool per question); the model only
picks the tool and phrases the answer. It never sees ciphertexts and cannot
invent an amount.

## A day in the village

Shop (at most two of four stores, each item once per day) → everyone presses Done →
Maude opens for one question each → the square argues → the trial banishes on
a plurality (a tie means nobody dies) → the werebear eats someone → the morning report says what the
night's items did. The village wins by banishing the bear; the bear wins at
parity, or by surviving to the end of day six.

## Repo tour

- `packages/app` — the player app and GM dashboard (Vite/React, Freighter,
  in-browser UltraHonk proving)
- `packages/auditor-worker` — the game itself: a Cloudflare Worker with one
  Durable Object per game (roles, the day gate, dawn resolution, Maude)
- `packages/ctd-sdk`, `packages/ctd-disclosure` — vendored confidential-token
  SDK and the shared disclosure circuits with pinned verification keys
- `config/` — committed: deployment addresses, shop addresses, `catalog.json`
  (the shelf). Gitignored `local.*`: auditor key, deployer, shop keypairs, GM
  token.
- `design/` — original art (portraits, icons) before compression;
  `packages/app/public/` ships the web-sized copies. The death films'
  originals are gitignored and live outside the repo — only the compressed
  copies in `packages/app/public/videos/` are tracked
- `docs/` — see below

## Running it

Prerequisites: **Node ≥ 20**, [Freighter](https://freighter.app) set to Testnet,
and — only if you are deploying your own token stack — the
[`stellar` CLI](https://developers.stellar.org/docs/tools/developer-tools/cli/stellar-cli)
on your `PATH`.

```sh
git clone --depth 1 https://github.com/briwylde08/who-ate-gerald
cd who-ate-gerald
npm install
npm run build:sdk   # REQUIRED — @ctd/sdk resolves to dist/, and nothing builds it for you
```

`--depth 1` because the retired video originals live in history: a full clone is
~230 MB against a ~26 MB working tree.

### The player app

```sh
npm run dev -w @gerald/app      # http://localhost:5173
```

`predev` copies the `@aztec/bb.js` browser build into
`packages/app/public/vendor/bb` (gitignored) — proving happens in the browser
and bb.js must be served as an intact directory, so it is never bundled. Vite
serves the COOP/COEP headers `SharedArrayBuffer` needs; Pages replicates them
from `public/_headers`.

- Player app: `http://localhost:5173/`
- **GM dashboard: `http://localhost:5173/#/gm`** — paste the game id and the GM
  token into the panel; both persist in `localStorage`.

Out of the box the app talks to the **deployed** worker and the **deployed**
token, so you can play immediately with nothing but Freighter.

### The game engine (Cloudflare Worker)

```sh
cd packages/auditor-worker
npm run types            # writes worker-configuration.d.ts (gitignored) — do this first
npx wrangler dev         # http://localhost:8787
```

Local secrets go in `packages/auditor-worker/.dev.vars` (gitignored, `KEY=value`):

```
GM_TOKEN=any-string-you-like
AUDITOR_K=<the "k" from config/local.auditor.json>
# Only needed for Maude's phrasing — without them /ask fails but the game runs:
OPENAI_API_KEY=...
OPENAI_BASE_URL=https://gateway.ai.cloudflare.com/v1/<acct>/<gw>/compat
CF_AIG_TOKEN=...
```

`AUDITOR_K` is the auditor secret for the deployed token. Without it the worker
starts, but it cannot decrypt a single amount. If you don't have it, deploy your
own stack (below).

To aim the app at your local worker, in the browser console:

```js
localStorage.setItem("gerald:auditor-url", "http://localhost:8787")
// remove the key to go back to the deployed worker
```

### Deploying your own stack

Only if you want your own token and your own auditor key. This spends testnet
XLM and writes gitignored secrets into `config/`.

```sh
npm run deploy:stack     # the auditor registry + the game token (needs the `stellar` CLI)
npm run setup:order      # Maude's office — the surrender sink
npm run setup:shops      # the four shop accounts, registered
npm run health           # end-to-end: register → deposit → merge → tithe → decrypt
```

`deploy:stack` refuses to overwrite `config/deployment.testnet.json` unless
`FORCE=1` — a fresh stack is a fresh economy.

### Local secrets (`config/local*`, all gitignored)

| File | Shape | Written by |
|---|---|---|
| `local.auditor.json` | `{ "k": "<hex32>" }` — **the auditor secret; it decrypts every amount in the game** | `npm run deploy:stack` |
| `local.deployer.json` | `{ "secret": "S…" }` | `npm run deploy:stack` |
| `local.shops.json` | `{ "<shop>": { "secret": "S…", "sk": "<hex32>" } }` | `npm run setup:shops`, `npm run setup:order` |
| `local.gm.json` | `{ "gmToken": "…" }` | **nothing — write it by hand.** Read by `npm run item-test`; must match the worker's `GM_TOKEN` |
| `local.bots.<gameId>.json` | bot keypairs, one file per game | `npm run bots` |

### Checks

```sh
npm run test:catalog   # the shelf's own exam — offline, no secrets, one second
npm run test:auth      # worker player-auth unit test — offline, no secrets
npm test -w @ctd/sdk   # the vendored SDK's suite (slow: real UltraHonk proofs)
npm run test:auditor   # fact tools — needs config/local.auditor.json + the live indexer
npm run item-test      # every item's effect, end to end — needs local.gm.json, testnet, ~5 min
npm run bots <gameId> [n]   # fill a game with bots so a small table can playtest
```

`item-test` and `bots` accept an `AUDITOR_URL` override, so you can drive a
locally-modified worker instead of production:

```sh
AUDITOR_URL=http://localhost:8787 npm run item-test
```

## Docs

| Doc | What it's for |
|---|---|
| [docs/CATALOG.md](docs/CATALOG.md) | The shelf: every item, the design laws, standing rulings, balance watch list |
| [docs/CONFIDENTIAL-TOKENS.md](docs/CONFIDENTIAL-TOKENS.md) | How a confidential token transfer works on Stellar — the full explanation |
