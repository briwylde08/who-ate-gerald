# The Catalog (v9, 2026-07-31; last verified against the shelf 2026-08-05) — living document

The one true description of the shelf. `config/catalog.json` is the source
of truth the game actually reads; this doc explains the *why*. Old shelves
(v2–v7) live in git history, not in parallel files.

## Design laws

1. **One clause, core rules only.** An effect may reference the vote, the
   night attack, the sightings, or the morning report — never another item.
2. **No rare triggers.** An item acts the day it is bought, or on an event
   that happens most rounds. (The v4 ham/trap/candle/bone all paid out on
   conditions that almost never occurred; they were coins spent on nothing.)
3. **Stores stay mixed-purpose.** A store per category would turn the public
   sightings into an intent detector, defeating hidden amounts.
4. **Dual-use where possible.** If either side plausibly buys an item, a
   revealed purchase proves nothing.
5. **Prices are globally unique.** The amount IS the item, so any revealed
   amount must identify exactly one ware.
6. **Only items that need a TARGET take a second action.** A confidential
   transfer's only payload is its amount — targets go through `p/aim`,
   server-private, in the same trust class as votes and night picks.
   Everything else fires from the purchase alone. There is no "declare it"
   step: an item that points at nobody must never ask the player to confirm
   they meant it (the barrel did, and was unusable for it).
7. *(Deliberate exception to law 2)* **Gerald's finger does nothing**, at
   1 XLM — cheap noise is a feature, not a bug.

## The shelf

| XLM | Item | Store | What it does |
|---|---|---|---|
| 1 | Gerald's finger | Chapel | Does nothing. |
| 8 | Soup bone *(aim: player)* | The Butcher's | Pick another villager. If the werebear targets you tonight, there is a 1 in 4 chance it targets them instead. |
| 20 | Horseshoe nail | Blacksmith | If today's vote ties on you, the other tied player is banished instead. Single use. |
| 22 | Cold iron key *(aim: player+shop)* | Blacksmith | Pick a villager and a store. Tomorrow that store will not sell to them. Everyone is told which store was locked. Nobody is told who bought the key or who was locked out. |
| 23 | Shopkeeper's holiday *(aim: shop)* | General Store | Pick a store. Tomorrow it is closed to everyone. Announced publicly. |
| 25 | Unquiet rest | Chapel | When you die, a 50/50 chance your ghost can still vote. The result is announced either way. |
| 28 | The butcher's knife | The Butcher's | Your vote counts twice at today's trial. Everyone is told a double vote was cast; nobody is told whose. |
| 32 | Sock in mouth *(aim: player)* | General Store | Pick a villager. They can still type in the chat, but they lose their vote today. The morning report names them. |
| 33 | Tooth sharpener | The Butcher's | Werebear: tonight's kill goes through — soup bones and offerings do not stop it. Only the barrel of beer does. Villager: if the werebear targets you tonight, a 50/50 chance it takes this instead and leaves you alone. |
| 35 | Curfew bell | Blacksmith | Ring it, and the werebear stays home tonight. No hunting. No one dies tonight. |
| 42 | The long candle *(aim: player)* | Chapel | Pick a villager. A 50/50 chance you privately learn, on the spot, whether they are the werebear; otherwise you learn nothing. It never lies. |
| 45 | Barrel of beer | General Store | You cannot vote today, and you cannot be killed tonight — nothing gets through, including the tooth sharpener. No effect if you are the werebear. |

Economy: 50 XLM buy-in, +25 each morning (raised from 15, Bri 2026-08-04 — at 15/day the late game went broke and passive), two stores a day, each item
once per DAY per player (Bri's ruling 2026-08-04 — rebuying on a later day
is allowed and restocks single-use items like the nail; same-day repeats
are audited). Deadline: day SIX. The werebear may buy anything.

## Standing rulings

- **The barrel is the apex.** Bri's ruling: it beats the sharpener; the one
  guaranteed escape, priced at the retired charm's 45 and costing your vote.
- **The sharpener is insurance, not a counter.** Purchases are hidden, so
  the bear can't target defenses — it pays 33 to beat whatever the prey
  might secretly hold, minus the one public loophole.
- **Barred doors keep the coin.** The chain can't refuse a transfer; a
  purchase behind a lock or holiday does nothing and the buyer learns via
  private note. (Open question: warn the locked player at day start?)
- **Death settles debts** — a corpse owes no disclosure and is not abed.
- **Two nails in one tie: both excused, nobody hangs.** Both nails are
  spent; the report says "Every tied villager was carrying iron." (Code
  path in resolveDayInner's stillTied loop; not yet in the item exam —
  staging it needs two fresh nail-holders in one engineered tie.)
- **Ghost votes are public**, dawn waits for them, and the roster shows 👻.

## Watch list (updated 2026-08-05)

- **Key/holiday traffic at 25/day**: the richer economy plus once-per-day
  rebuys produced barred doors EVERY day in the 2026-08-04 full bot game.
  Bots buy semi-randomly; watch whether humans spam too. Lever: prices.
- **The instant candle** (2026-08-05): same-day answers made it markedly
  stronger than the dawn version it replaced. At 42 it's ~2 reads per
  game; if it dominates human games, the price has room to climb.

### Older items (2026-07-31 pass)

- Nail at 20 is quietly excellent for the bear in tie-heavy games.
- Sock (32) + knife (28) swings a tally by 3 for 60 XLM by day 2.
- Village information is thin post-v7: Maude, sightings, tie disclosures,
  and the candle's coin flip. Deliberate; revisit after a human game.
- Bench if the village keeps losing: town clock (~30, +1 day, once).
- Wanted: a bear-TEMPTING item (strong bear utility, damning receipt) — the
  village currently has no purchase-evidence path to a passive bear.
