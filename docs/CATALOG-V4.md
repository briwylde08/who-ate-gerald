# Catalog v4 — draft for discussion (post playtest-7)

Twelve slots, four stores, no pure covers. Prices are globally unique
(the amount IS the item). Design goals from POSTGAME-7: one expensive
survival item, hunting knife back, an information arsenal for the
village (the blend-in bear must be punishable), a proactive bear item,
copy that explains itself.

## The shelf

### Blacksmith — honest metal
| Item | XLM | Effect (player-facing copy) |
|---|---|---|
| Horseshoe nail | 2 | Lucky iron: if today's vote ties and you're in the tie, the luck is yours — you are not banished. One nail, one escape. |
| Hunting knife | 35 | Conviction, sharpened: your vote today counts twice. Everyone hears a knife being ground; nobody knows whose. |
| Silver charm | 45 | Survive one night attack. The charm shatters, everyone hears it, and you spend the next day in bed — alive, too weak to vote. The werebear cannot buy silver. |

### General Store — sundries and gossip
| Item | XLM | Effect |
|---|---|---|
| A bottle | 7 | Loose lips: tomorrow's morning report includes one true rumor about someone's shopping. You don't choose whose. |
| The ledger book | 15 | Tax records: at dawn, Maude names who spent the most today. Names only — amounts stay sealed. |
| Musk salve | 18 | Cover your scent: tomorrow, your shop visits appear in the sightings as "a hooded figure." Anyone may buy it. Anyone. |

### The Butcher's — meat and consequences
| Item | XLM | Effect |
|---|---|---|
| Soup bone | 8 | The dogs remember: at dawn, you privately learn whether the werebear came for YOU last night — even on a quiet night. |
| Smoked ham | 13 | A well-fed bear leaves quietly: if the bear's attack fails tonight, the village is never told it happened. |
| Fresh venison | 21 | The bear's next attack tears through bearsbane and bear traps. In villager hands: pure chaos. |

### Chapel — light and revelation
| Item | XLM | Effect |
|---|---|---|
| Votive candle | 5 | If you die, your candle gutters last: Maude posts your final words to the square. Say something worth haunting with. |
| Lantern oil | 12 | Posthumous: if you are eaten, Maude reads one true fact about the werebear's purchases by your still-lit lantern. |
| Unsealing ritual | 25 | At dawn, Maude unseals ONE purchase of the day's most-accused player and names the item. The vote chooses the target; the ritual pays for the reading. |

## Category balance
- **Minor luck / drama (3):** nail 2, candle 5, bottle 7 — the new cheap
  tier: worth buying, still cover.
- **Information (4):** soup bone 8, lantern oil 12, ledger book 15,
  unsealing ritual 25 — the village's offense. A bear that blends in now
  leaves reads: biggest-spender callouts, unsealed purchases, dogs.
- **Bear shelf (3):** ham 13, musk 18, venison 21 — all dual-use enough
  that villagers plausibly buy them (that's the cover).
- **Big plays (2):** knife 35, charm 45 — visible sacrifices; buying one
  crowds out everything else that day.

## Notes for the argument
- Charm at 45 keeps the bear-can't-buy rule, the shatter, and the
  critical-condition day. Bane and barrel are gone: silver is the only
  door out of a night attack, and it costs three days of income.
- Ritual targeting rides the vote (items can't carry targets — the
  amount is the whole payload). It fires on the day's most-voted player
  even if the vote ties; ties finally produce information either way.
- Musk vs the dogs/ledger: the bear's counter-info arrives in the same
  patch as the village's info. Watch the balance in playtest-8.
- Bear kit check: ham 13 + venison 21 + musk 18 = 52 > 50, so the full
  kit is unaffordable on day 1 — the bear must sequence, which leaks.

## The bench (cut, revisit if v4 plays flat)
- **Bear trap / bearsbane / barrel** — collapsed into the one survival
  item; trap's posthumous-revenge niche overlaps lantern oil.
- **Curfew bell (~40)** — "the bear cannot hunt tonight." Great tempo
  item; lost its slot to the knife. First candidate to swap in (likely
  for the bottle) if the village keeps losing.
- **Town clock (~30)** — +1 to the day limit, once. Revisit if the
  5-day clock decides too many games.
- **Rope** — never found a purpose. Gerald would understand.

## Implementation sketch (when approved)
- config/catalog.json rewrite; prices unique; no config for behavior —
  effects live in resolveDayInner + facts.
- Easy: knife (stale `hunting_knife` weight check at game.ts:627 goes
  live again), nail (tie-break before stand-accused), ledger book
  (facts.ts biggest_purchase at dawn), bottle (random true rumor from
  purchases), candle (posthumous line; MVP = Maude writes the eulogy).
- Medium: soup bone (needs a private-to-player dawn fact — deliver via
  Maude's seals like ask-answers), unsealing ritual (vote tally +
  auditTransfer decrypt of target's latest purchase).
- Chunky: musk salve (graphView/indexer must render the buyer's
  next-round edges as "a hooded figure" without leaking WHO bought it —
  the edge suppression itself must not identify the buyer).
