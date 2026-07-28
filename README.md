# Who Ate Gerald?

**Trust is scarce. Gerald is dead.**

> One of the villagers named Gerald has been eaten.

A multiplayer social-deduction game (7 players, one secret Wolf) where the
evidence is a real confidential-token ledger on Stellar testnet: every
purchase is a confidential transfer — everyone sees *who* paid *which* shop,
nobody sees *how much* — and **Maude McLedger**, the AI Auditor who can see
everything, answers exactly one question per round.

## Play

| | |
|---|---|
| **Player app** | https://who-ate-gerald.pages.dev (Freighter on Testnet required) |
| **GM dashboard** | https://who-ate-gerald.pages.dev/#gm (token in `config/local.gm.json`) |
| **The Auditor** | https://gerald-auditor.briana-761.workers.dev (Maude's API) |
| **GM runbook** | [docs/PLAYTEST.md](docs/PLAYTEST.md) |

## How the tech IS the game

| Game mechanic | Protocol reality |
|---|---|
| Shop visits are public, purchases aren't | Confidential transfer: parties visible, amounts hidden |
| The price *is* the item | Exact-amount matching against the shop catalog |
| The kill hides in the nightly tithe | Hidden amounts in a universal payment |
| Maude sees all, answers little | Auditor key decrypts every transfer's ciphertext — one question per round, enforced in code |
| Trial defenses can't be faked | Off-chain selective-disclosure proofs, verified against the chain |

Maude's truthfulness is architectural, not behavioral: facts are computed in
code (event decryption + one narrow fact tool per question); the LLM only
selects the tool and phrases the result. It never sees ciphertexts and cannot
invent an amount.

## Repo tour

- `packages/app` — player kit + GM dashboard (Vite/React, Freighter,
  in-browser UltraHonk proving)
- `packages/auditor-worker` — Maude: Cloudflare Worker + one Durable Object
  per game (rounds, the one-question seal, ask log)
- `packages/ctd-sdk` — vendored confidential-token SDK (Grumpkin/Poseidon2
  crypto, proving, chain + indexer clients, selective disclosure)
- `packages/ctd-disclosure` — shared disclosure circuits + pinned
  verification keys (the trust anchor of the trial flow)
- `scripts/` — deploy-stack, setup-shops, health, test-auditor-facts,
  mini-game (the scripted 3-villager exit exam)
- `config/` — committed: deployment addresses, shop addresses, catalog.
  Gitignored `local.*`: auditor key, deployer, shop keypairs, GM token.
- `docs/` — DESIGN.md, PLAYTEST.md, benign-crimes.md (future "Auditor
  Noir" single-player case files)

## Useful commands

```sh
npm run health         # Phase 0 stack check (chain, shops, auditor decrypt)
npm run test:auditor   # fact-layer exit exam (live indexer + synthetic)
npm run mini-game      # full scripted round vs the deployed stack (~5 min)
npm run deploy:app     # build + CF Pages Direct Upload
# worker: cd packages/auditor-worker && npx wrangler deploy
```

## Sibling project

[Axe & Ember](../axe-and-ember) — the single-player tutorial for the same
confidential-token mechanics; the wallet layer, indexer, and disclosure
machinery ported from there. The ember-indexer worker mirrors both tokens.

Status: **playtest-ready.** Phases 0–2 built, deployed, and verified
(2026-07-28); awaiting catalog tuning, the wolf's tithe rule, and seven
brave villagers.
