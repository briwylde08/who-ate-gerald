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
- `design/` — original art (portraits, icons, the death films) before
  compression; `packages/app/public/` ships the web-sized copies
- `docs/` — see below

| Doc | What it's for |
|---|---|
| [docs/CATALOG.md](docs/CATALOG.md) | The shelf: every item, the design laws, standing rulings, balance watch list |
| [docs/CONFIDENTIAL-TOKENS.md](docs/CONFIDENTIAL-TOKENS.md) | How a confidential token transfer works on Stellar — the full explanation |
