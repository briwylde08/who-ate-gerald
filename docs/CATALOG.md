# The Catalog (v9, 2026-07-31) — living document

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
6. **Aimed items take a second action.** A confidential transfer's only
   payload is its amount — targets go through `p/aim`, server-private, in
   the same trust class as votes and night picks. Aim `self` = a declared
   drink.
7. *(Deliberate exception to law 2)* **Gerald's finger does nothing**, at
   1 XLM — cheap noise is a feature, not a bug.

## The shelf

| XLM | Item | Store | What it does |
|---|---|---|---|
| 1 | Gerald's finger | Chapel | Nothing. Absolutely nothing. |
| 8 | Soup bone *(aim: player)* | Butcher's | If the beast comes for you, 1-in-4 it takes that gate instead. A sharpened tooth is not distracted. |
| 20 | Horseshoe nail | Blacksmith | If the vote ties on you, the tie falls on the other. Consumed. |
| 22 | Cold iron key *(aim: player+shop)* | Blacksmith | That villager finds that store locked tomorrow. The village learns which door, never whose hand. |
| 23 | Shopkeeper's holiday *(aim: shop)* | General Store | That store shuts tomorrow, for everyone, in public. |
| 25 | Unquiet rest | Chapel | At your death, an even chance your ghost keeps its vote. Announced either way. |
| 28 | The butcher's knife | Butcher's | Your vote counts twice at today's trial. "Steel glinted" is announced; the hand is not. |
| 32 | Sock in mouth *(aim: player)* | General Store | Their vote does not count today. The dawn NAMES whose voice was stopped. |
| 33 | Tooth sharpener | Butcher's | **Bear:** tonight's kill defeats everything except the barrel. **Villager:** an offering — even chance the beast takes it and spares you. |
| 35 | Curfew bell | Blacksmith | Tonight the beast hunts no one at all — the whole village hears the toll. Beats even sharpened teeth. |
| 42 | The long candle *(aim: player)* | Chapel | Even chance the flame truly reveals whether they are the werebear — otherwise it gutters and says nothing. Private; it never lies. |
| 45 | Barrel of beer *(aim: self)* | General Store | THE saving item. Drink: no vote today, and nothing takes you tonight — sharpener included. Does nothing for the bear (too big for beer). |

Economy: 50 XLM buy-in, +15 each morning, two stores a day, ONE of each
item per player per game (UI-enforced; repeats are audited and the nail's
stacking is capped). Deadline: day SIX. The werebear may buy anything.

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
- **Ghost votes are public**, dawn waits for them, and the roster shows 👻.

## Watch list (from the 2026-07-31 balance pass)

- Nail at 20 is quietly excellent for the bear in tie-heavy games.
- Sock (32) + knife (28) swings a tally by 3 for 60 XLM by day 2.
- Village information is thin post-v7: Maude, sightings, tie disclosures,
  and the candle's coin flip. Deliberate; revisit after a human game.
- Bench if the village keeps losing: town clock (~30, +1 day, once).
- Wanted: a bear-TEMPTING item (strong bear utility, damning receipt) — the
  village currently has no purchase-evidence path to a passive bear.
