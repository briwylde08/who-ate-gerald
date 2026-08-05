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
| An accused villager's reveal cannot be a lie | The server decrypts the purchase they nominate, straight from the chain |

Maude's truthfulness is architectural, not behavioural: facts are computed in
code (event decryption plus one narrow fact tool per question); the model only
picks the tool and phrases the answer. It never sees ciphertexts and cannot
invent an amount.

## A day in the village

Shop (at most two of four stores, each item once per day) → everyone presses Done →
Maude opens for one question each → the square argues → the trial banishes on
a plurality → the werebear eats someone → the morning report says what the
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
- `design/` — original art (portraits, icons, the death films) before
  compression; `packages/app/public/` ships the web-sized copies
- `docs/` — see below

| Doc | What it's for |
|---|---|
| [docs/CATALOG.md](docs/CATALOG.md) | The shelf: every item, the design laws, standing rulings, balance watch list |
| [docs/CONFIDENTIAL-TOKENS.md](docs/CONFIDENTIAL-TOKENS.md) | What the cryptography actually does, mapped onto the game |
| [docs/DESIGN-V2.md](docs/DESIGN-V2.md) | Architecture of the automated game (carries a drift warning) |
| [docs/TOMORROW.md](docs/TOMORROW.md) | Where things stand and what's next |
| [docs/POSTGAME-10.md](docs/POSTGAME-10.md) | Open items from the last playtest |

## Commands

```sh
npm run deploy:app       # build + ship the player app (Pages, direct upload)
npm run bots <game> [n]  # fill a lobby with bot villagers — they play for real
npm run item-test        # scripted game asserting every item's effect fires
npm run test:auditor     # Maude's fact layer (fast, no chain writes)
npm run test:auth        # SEP-53 player-signature verification
npm run health           # end-to-end stack check against testnet
# worker: cd packages/auditor-worker && npx wrangler deploy
```

The GM dashboard is at `/#gm` with the token from `config/local.gm.json`. It
shows decrypted purchases for every player — **never screen-share it.**

## Running it yourself

```sh
npm install          # Node 20+; workspaces pull in the vendored SDK
npm run deploy:app   # or `npm run dev --workspace @gerald/app` for local
```

Everything here talks to a **Stellar testnet** deployment that already exists
(`config/deployment.testnet.json`), so the app runs against it with nothing
but Freighter. What a fresh clone does *not* have, because they are
gitignored secrets:

| File | Needed for |
|---|---|
| `config/local.gm.json` | the GM dashboard and any script that drives a game |
| `config/local.auditor.json` | decrypting transfers (`test:auditor`, `health`) |
| `config/local.deployer.json`, `config/local.shops.json` | deploying a new token or registering shops |

Deploying your own stack instead: `npm run deploy:stack`, then
`npm run setup:shops`, then set the worker's secrets (`AUDITOR_K`,
`GM_TOKEN`, and the OpenAI/gateway keys Maude speaks through) with
`npx wrangler secret put`.

## Sibling project

**Axe & Ember** — the single-player tutorial for the same confidential-token
mechanics. The wallet layer, indexer, and disclosure machinery were ported
from there; the ember-indexer worker mirrors both tokens.
