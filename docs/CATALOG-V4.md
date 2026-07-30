# Catalog v4 — SHIPPED (post playtest-7)

Twelve slots, four stores, no pure covers. Prices are globally unique
(the amount IS the item). Approved by Bri 2026-07-30; implemented in
config/catalog.json + game.ts the same day.

**The design law (Bri's, from review):** every item is ONE clause and
may reference only core rules — the vote, the night attack, the
sightings, the morning report — never another item. No counter-chains.
And stores stay mixed-purpose: the door must not tell the story (a
store-per-category layout would turn public sightings into an intent
detector, defeating the hidden-amounts premise).

## The shelf (as shipped)

### Blacksmith — honest metal
| Item | XLM | Effect (player-facing copy) |
|---|---|---|
| Horseshoe nail | 2 | Lucky iron: if the vote ties on you, luck excuses you — you reveal nothing. One nail, one escape. |
| Bear trap | 21 | If you are eaten, the beast bleeds: it cannot kill the next night. |
| Silver charm | 45 | Survive one night attack. The charm shatters, everyone hears it, and you spend the next day in bed — too weak to vote. The werebear cannot buy silver. |

### General Store — sundries and gossip
| Item | XLM | Effect |
|---|---|---|
| A bottle | 7 | Loose lips: tomorrow's morning report carries one true rumor about the day's shopping. You don't choose which. |
| The ledger book | 15 | Tax records: at dawn, Maude names who spent the most today. Names only — amounts stay sealed. |
| Musk salve | 18 | Shop unseen: tomorrow the sightings log your store visits as "a hooded figure" instead of your name. Anyone may buy it. Anyone. |

### The Butcher's — meat and conviction
| Item | XLM | Effect |
|---|---|---|
| Soup bone | 8 | The dogs remember: at dawn, you privately learn whether the beast came to YOUR door last night — even on a quiet night. |
| Smoked ham | 13 | A well-fed bear leaves quietly: if the night attack fails, the morning says nothing at all. |
| The butcher's knife | 35 | Conviction, sharpened: once bought, your vote counts twice for the rest of the game. Everyone hears a knife being ground; nobody knows whose. |

### Chapel — light and revelation
| Item | XLM | Effect |
|---|---|---|
| Votive candle | 5 | If you die, your candle gutters last: Maude posts your final words to the square. |
| Lantern oil | 12 | Posthumous: if you are eaten, Maude reads one true fact about the werebear's purchases by your still-lit lantern. |
| Unsealing ritual | 25 | At dawn, Maude unseals ONE purchase of the day's most-accused villager and names the item. The vote picks the target; the ritual pays for the reading. |

## Why this shape
- **Knife lives at the Butcher's** — the bear's most natural door is
  also where villagers buy vote power and soup bones, so a Butcher's
  sighting is maximally ambiguous. Knife is permanent once bought
  (own-the-knife is the simpler mental model at 35 XLM).
- **Nail excuses a tie** (skip the forced disclosure) rather than
  blocking banishment — under tie-rules nobody is banished anyway, and
  a 2 XLM banishment-escape would be broken.
- **Candle's "last words"** = the player's final living chat line,
  reposted by Maude. Zero input flow needed; write your epitaph in the
  square while you still can.
- **Bottle rumor** = one random purchase of the day, reported as a
  10-XLM price band + store ("something worth more than 20 XLM left
  the Chapel today"). True, partial, uncontrollable.
- **Ritual rides the vote**: fires on the day's highest vote-getter
  even in a tie — ties finally produce information either way.
- **Dogs are private**: delivered via authed per-player notes
  (privateNotes in game state, `p/notes` endpoint, card in the square).
- **Musk hides in the graph only** — the worker's graphView renders the
  buyer's next-day edges as "a hooded figure"; decrypted facts (Maude,
  audits) are unaffected. Elimination caveat: a player with zero named
  sightings on a hooded day is a candidate — acceptable noise at 8
  players, watch it in playtest-8.
- Bear kit check: ham 13 + musk 18 = 31 with covers to spare on day 1;
  the knife (35) as a bear buy is a legitimate deep-cover power play.

## Retired from v3
Bearsbane tincture, the good barrel (both folded into the single
45 XLM charm), fresh venison (both its jobs were counter-chains), rope
and all "Cover." copy. GameState keeps baneConsumed/venisonUsed fields
for old stored games; the logic is gone.

## The bench (revisit if v4 plays flat)
- **Curfew bell (~40)** — "the bear cannot hunt tonight." Village tempo
  tool; first swap-in if the village keeps losing.
- **Town clock (~30)** — +1 to the day limit, once. Revisit if the
  5-day clock decides too many games.
