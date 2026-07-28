# Who Ate Gerald?

**Trust is scarce. Gerald is dead.**

*A multiplayer social-deduction game where the evidence is a real blockchain
and the alibi is a zero-knowledge proof.*

> **One of the villagers named Gerald has been eaten.**

Gerald is pure story — no wallet, no history, no evidence pack. He exists to
establish two facts before the first coin moves: there is a wolf among you,
and it is hungry. Everything on chain starts the moment the game does.

## The pitch

Classic Werewolf, except the deduction material is a **confidential token
ledger on Stellar testnet**. Every purchase every player makes is a real
confidential transfer: everyone can see *who* paid *which* shop — nobody can
see *how much*, which means nobody can see *what you bought*. One player is
secretly the Wolf. One AI agent — the **Auditor** — holds the auditor key and
can see everything, but answers only one question per round.

The technology isn't a backdrop; it's the game:

| Game mechanic | Protocol reality |
|---|---|
| Shop visits are public, purchases aren't | Confidential transfer: parties visible, amounts hidden |
| The kill hides inside the nightly tithe | Hidden amounts in a universal payment |
| The Auditor sees all, answers little | Auditor key decrypts every transfer's ciphertext |
| Trial defenses can't be faked | Selective disclosure proofs |
| Buying silver clears your name | Wolves can't touch silver (lore + a hard rule) |

## Setup

- **7 players** (v1): 6 Villagers, 1 Wolf, dealt secretly. Scale to 9–10 later.
- **Virtual play** (video call + web app). Eliminated players are **out**.
- Each player connects a Freighter wallet; accounts are funded and registered
  with the game's own confidential token instance at lobby time.
- Fixed starting budget for everyone (exact number TBD in playtesting).

## NPC shops (the catalog)

Each shop is a registered account. Each sells several items at **distinct
prices** — the price *is* the item (your payment amount selects your
purchase). A shop's protective power comes with a price spread wide enough
that a visit alone proves little.

| Shop | Example wares (prices TBD) |
|---|---|
| **Blacksmith** | horseshoe nail (cheap) · knife · **silver charm** (dear; wolves cannot buy) |
| **General Store** | rope · lantern oil · nails · firewood |
| **Apothecary** | bandages · wolfsbane tincture · sleeping draught |
| **Liquor Store** | a nip · a bottle · the good barrel |
| **Chapel** | the tithe (any amount — see below) |

Cheap items double as **decoys**: a 1-ember nail makes your Blacksmith visit
look like it *might* have been a silver charm. Decoys cost real budget — the
core spending tension is gearing up vs. muddying your trail.

## The round loop (~10 min; 3–4 rounds/game)

1. **SHOP (3 min)** — each living player makes 2–3 confidential purchases.
2. **TITHE (1 min)** — every living player pays the Chapel an amount of their
   choosing. **The Wolf's tithe encodes its kill target** (encoding scheme
   TBD — e.g., final digits map to a victim). The attack is on the ledger, in
   plain sight, protected only by confidentiality.
3. **ASK (2 min)** — the round's asker (rotates each round) asks the Auditor
   **one free-form question**, chosen alone, answered publicly.
4. **TRIAL (5 min)** — open accusations. An accused player may **selectively
   disclose** any of their own purchases (a real proof — unforgeable, and it
   reveals only that one payment). Refusing is legal. And noted.
5. **VOTE (1 min)** — majority lynches one player; their role is revealed.
6. **NIGHT** — the tithe-marked victim is attacked. Gear resolves it:
   silver charm = survives (and the village learns the wolf burned itself);
   other defenses mitigate per item table; nothing = eaten, like Gerald.

**Win conditions:** Village wins by lynching the Wolf. Wolf wins at parity
(wolves ≥ living villagers).

## The Auditor (AI agent)

An LLM-driven character holding the game token's **auditor secret key** — the
one party who can decrypt every transfer. Rules of the office:

- Answers **one question per round**, from the rotating asker only.
- Always truthful; never volunteers extra information; scope-limits greedy
  questions in character ("The Order permits one seal per moon, dear").
- May have personality (working theory: a tired, meticulous bureaucrat of the
  Order who found Gerald's ledger "unremarkable, which is the saddest part").
- Runs server-side with the auditor key — the first real resident of the
  courier-service architecture sketched in Axe & Ember's docs.

Question design is deliberately free-form (Bri's call): clever question
formulation is a skill the game rewards. The Auditor enforces one-question
scope, not question shape.

## Deduction anchors (why the wolf is findable)

1. **Wolves cannot buy silver.** The one purchase that fully exonerates —
   and its price sits at the top of the Blacksmith's range, so proving it
   costs you.
2. **The kill is in the tithe.** Somebody's Chapel payment carries the mark
   every night. ~20 transactions per round, one Auditor question per round:
   the truth is always on the ledger, and almost always unaffordable.
3. **Wolves must shop normally.** An empty or all-decoy history is its own
   tell; disclosure refusals accumulate suspicion.

## What ports from Axe & Ember

Wallet layer (Freighter connect + key derivation), vendored @ctd/sdk,
selective-disclosure machinery, the ember-indexer worker (live), learning
panels (optional spectator/teaching mode), deploy-token + setup-npcs scripts.

**New builds:** fresh token instance with OUR auditor key (factory script
exists); game server (rooms, phases, timers, night resolution); the Auditor
agent service; shop-fulfillment logic; player web app.

## Open design questions

- Exact prices/budget (provisional numbers live in `config/catalog.json`) and
  the tithe-encoding scheme (must survive collisions: two players tithing the
  same amount).
- What non-silver gear does, precisely (mitigation table).
- Dead players: fully out (locked) — spectate silently or leave?
- ~~Auditor personality + name~~ → **Maude McLedger**, Auditor of the Order
  (Bri, 2026-07-28). Tired, meticulous bureaucrat; "one seal per moon"; found
  Gerald's ledger "unremarkable, which is the saddest part."
- ~~First playtest format~~ → moderated hybrid (Bri GMs over a call, real
  wallets, thin UI); decided 2026-07-28.

## Someday

- **Auditor Noir** — single-player training mode: you hold the auditor key
  and solve one of the Benign Crimes (see `benign-crimes.md`) against
  scripted agents. Learn to question before you play.
- Roles v2: the Seer (one private auditor peek per night), the Skinflint
  (immune to suspicion over tiny tithes), etc.
- Bigger tables, two wolves, tournaments.
