# Who Ate Gerald? — Design v2 (the automated game)

*Workshopped by Bri + Patrick, 2026-07-28.*

> **Drift warning (2026-07-31):** the game FLOW described here is still
> accurate (join → ready → deal → shop/Maude/square/trial/night → morning),
> but specifics have moved on: items and prices are governed by
> [CATALOG.md](CATALOG.md) + `config/catalog.json`, days open themselves on
> a 60s alarm (no GM lever), ties force disclosure, aimed items exist
> (`p/aim`), and the v1 moderated build this doc references was retired —
> including the Ledger's manual proof flow. Trust the code and CATALOG.md
> over any item- or number-level claim below.*

**Status: BUILT & LIVE (2026-07-29)** — deployed with the proposed defaults;
items marked ⏳ remain tweakable (edit `config/catalog.json` / this doc and
redeploy). Verified end-to-end by `npm run mini-game:v2` (scripted 3-player
automated game: dealt roles, signed player auth, private Maude seals, tie
vote, musk-masked silver save, day-2 banishment, village win).

## The story

Gerald is dead. Eaten by a werewolf — we know because of the telltale signs
of a **werebear** attack. *(The contradiction is deliberate. The town is
confidently terrible at forensics.)*

Someone found his mangled remains at the treeline: a still-lit lantern
strapped to his arm, one croc, nothing else. Bear tracks everywhere.

It's a remote town. There have been whispers of a werebear round these parts
for years. Nobody arrives, nobody leaves — so the werebear is *someone in
town*. Your job is to help your neighbors find it.

Unless the werebear is you.

## The flow (pages)

1. **Story intro** — the Gerald cold open above. One button: *"Find who ate
   Gerald."*
2. **Identity + the deal** — type your name, claim a character (cosmetic —
   built in v1). When the lobby fills, **the game deals roles**: everyone
   receives a private notification — *villager* or *werebear*. No GM DMs.
3. **The day** — each morning: income arrives (⏳ 50 XLM buy-in day one,
   +15 XLM/day after — as capped PUBLIC deposits, so the whole village can
   verify nobody smuggled budget). Visit **at most 2 shops** and spend what
   you like (UI-enforced; Maude audits violations by name at dusk).
4. **Maude McLedger** — *every living player* gets **one private question
   per day** about the transactions. Answers go only to the asker: bluffing
   about what Maude said is the game. The app offers a menu of suggested
   questions (useful + funny) plus free-form. Maude remains the Auditor;
   the villagers call her the fortune teller — she reads ledgers the way
   other women read palms.
5. **The chat** — strict 2-minute in-app chat box: convince, accuse, lie.
   *(Built last — the video call covers this until then.)*
6. **The vote & the hunt** — everyone votes for who the werebear is;
   simultaneously, the werebear privately picks someone to eat.
7. **Next morning** — resolution notification: who was banished, whether
   the werebear was caught, who was eaten (or saved, or nothing — see gear).

## Rules

- **Vote:** plurality of living players. The accused is **banished either
  way** (revealed on banishment). Banished werebear → village wins
  immediately. Tie → nobody banished; the bear eats well.
- **Night:** the werebear picks its victim via a secret in-app prompt. The
  tithe-encoding mechanic is dead; the Chapel survives as a flavor/cover
  shop.
- **Win:** village wins by banishing the werebear; werebear wins at parity
  (bear ≥ living villagers).
- **Resolution order for gear:** venison > bearsbane/trap · musk salve >
  the announcement · silver charm always saves the life.

## The catalog ⏳ (5 stores × 3 items; all 15 prices globally unique)

Classes: **V**illager / **W**erebear / **B**oth × **off**ensive /
**def**ensive / cover. Every store (except the Chapel, deliberately) mixes
alignments: the public graph shows only *where you went*; the amount — known
to Maude, a disclosure, or your confession — says *what you're planning*.

| Store | Item | XLM | Class & effect |
|---|---|---|---|
| ⚒ Blacksmith | Hunting knife | 9 | B·off — your vote counts twice at today's trial |
| | Bear trap | 18 | V·off — if you're eaten, the bear is wounded: no kill next night |
| | Silver charm | 30 | V·def — survive the attack, publicly. Werebear cannot buy |
| 🧺 General Store | Rope | 3 | cover |
| | Lantern oil | 12 | V·off — posthumous: if eaten, Maude reveals one true fact about the bear's purchases at dawn |
| | Fresh venison | 21 | W·off — next attack pierces bearsbane and traps. In villager hands: chaos |
| 🌿 Apothecary | Bandages | 4 | cover |
| | Musk salve | 13 | W·def — a failed attack tonight is not announced |
| | Bearsbane tincture | 22 | V·def — silently survive one attack; consumed, nobody told |
| 🍷 Liquor Store | A nip | 1 | cover — the cheapest alibi in town |
| | A bottle | 7 | cover |
| | The good barrel | 15 | B·def — dead drunk: can't vote today, can't be eaten tonight |
| ⛪ Chapel | Votive candle | 5 | cover |
| | Minor indulgence | 11 | cover |
| | St. Ursula's blessing | 25 | cover — looks protective; the church makes no guarantees. (Ursula. From *ursa*.) |

Matrix coverage: V·off ×2, V·def ×2, W·off, W·def, B·off, B·def — all six
cells — plus seven covers. Economy tension: silver on day one is near-all-in;
the bear's full predation kit (venison + musk) costs 34 across two days.

## Architecture deltas from v1

| v2 need | Mechanism |
|---|---|
| AI role dealing + private role fetch | DO deals at lobby-full; players authenticate with a Freighter-signed message (address proves seat) |
| Per-player Maude seals | DO tracks one-question-per-player-per-day; answers returned privately to the authenticated asker |
| Income | Daily deposit cap enforced in app; deposits are public-amount by protocol → self-auditing economy |
| 2-shops/day | UI-enforced; resolve-day flags violators via decrypted events |
| Vote + night | DO collects votes and the bear's pick; alarm (or GM button) closes phases; resolution in code |
| Notifications | Poll DO state per player (v2.0); push/WS later |
| Chat | DO-backed timed chat (LAST) |

## Build order (each step leaves a playable game)

1. Story/intro pages + werebear rename (copy only)
2. Catalog v2 into config + shops UI + Maude's knowledge ⏳ bless first
3. Player identity auth (signed message) → AI role dealing + private notify
4. Per-player Maude seals + suggested-question menu
5. Income (daily capped deposit) + 2-shop cap + violation audit
6. In-app vote + werebear night pick + morning resolution
7. 2-minute chat box
8. Playtest v2

Estimate: 2–3 sessions to step 6; chat is a session of its own.

## Open ⏳ (bless or edit)

- Catalog v2 above (items, prices, effects)
- Income numbers (50 start, +15/day)
- Knife's double-vote: keep secret until the tally, or announce at the
  trial? (Proposed: secret — revealed only in the tally math.)
- Lobby size: fixed 7, or 5–9 range?
- Suggested-question menu contents (draft exists in session notes)
