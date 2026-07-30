# Playtest-7 — post-game discussion list

Running list of things Bri flagged mid-game to discuss after it ends.

1. **Item variety: add an information category.** Too much of the catalog is
   "you survive the night" plus covers. Want items that reveal things —
   e.g. an item that unseals one of the werebear's purchases (fits the
   confidential-token story: a paid unsealing ritual via Maude). Discuss
   category balance: defense / cover / information / offense.

2. **Bear shelf is reactive.** Venison only matters vs gear, ham only
   matters on a failed attack — against a passive village the bear has
   nothing worth buying but covers. Consider a proactive bear item
   (relates to #1: if villagers get information items, the bear may want
   a counter-information item, e.g. something that fogs the sightings).

3. **Bring back the vote-doubler (hunting knife), expensive.** Bri liked
   it; retired in catalog v3. Reinstate in the next catalog at a high
   price. (Note: game.ts:~627 still has the stale `hunting_knife`
   vote-weight check — dead code today; it becomes live again if the
   item returns under the same id. Clean up or reuse deliberately.)

4. **One survive-the-night item, expensive (~45 XLM).** Charm (30),
   barrel (15), and bane (22) are three flavors of "don't die tonight" —
   collapse to a single pricey survival item and spend the freed slots
   on information/offense items (see #1). Bri's pricing: if it's cheap
   enough to buy every night, everyone will — at ~45 XLM it's a
   once-in-a-game panic button (3 days of income) and buying it crowds
   out everything else that day, which is itself a visible sacrifice.

5. **Item copy clarity pass.** "Consumed; nobody is told" (bearsbane)
   read as gibberish in playtest-7. Every effect line should be
   understandable without knowing the resolution rules — spell out one
   use, silent survival, morning reads as a quiet night.

6. **No pure-cover items — everything has a small purpose.** Kill the
   "Cover." tier (nail, rope, bottle, soup bone, candle). Hidden amounts
   already provide deniability; cover works BETTER when cheap items are
   genuinely worth buying (ambiguity of purpose beats absence of
   purpose). Cheap tier gets minor effects — e.g. tiny tie-break luck,
   a one-word Maude hint, +1 sway in some mechanic — to be designed
   with #1/#4's freed slots.
