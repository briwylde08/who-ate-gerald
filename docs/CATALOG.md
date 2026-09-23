# The Catalog

What every item on the shelf does. Generated from `config/catalog.json`, which
is what the game reads; if the two ever disagree, the JSON is right.

Every price is unique, so a revealed amount identifies exactly one item.

| XLM | Item | Store | What it does |
|---|---|---|---|
| 1 | Gerald's finger | Chapel | Does nothing. Gerald had eight — when the village has claimed them all, his thumbs come to market. |
| 2 | Gerald's thumb | Chapel | Does nothing. There are only two — and when both are claimed, the toes come to market. |
| 3 | Gerald's toe | Chapel | Does nothing. There are ten. After that, Gerald has no more to give. |
| 8 | Soup bone *(aim: a villager)* | The Butcher's | Pick another villager. If the werebear targets you tonight, there is a 1 in 2 chance it targets them instead. |
| 20 | Horseshoe nail | Blacksmith | If today's vote ties on you, the nail steps you out of it. Whoever is left in the tie takes the rope — if more than one is left, nobody hangs. Single use. |
| 22 | Cold iron key *(aim: a villager and a store)* | Blacksmith | Pick a villager and a store. Tomorrow that store will not sell to them — they will find its door crossed out. Everyone is told which store was locked; only the victim sees it was for them. Nobody is told who bought the key. |
| 25 | Unquiet rest | Chapel | When you die, a 50/50 chance your ghost can still vote. The result is announced either way. |
| 28 | The butcher's knife | The Butcher's | Your vote counts twice at today's trial. Everyone is told a double vote was cast; nobody is ever told whose. |
| 32 | Sock in mouth *(aim: a villager)* | General Store | Pick a villager. They can still type in the chat, but they lose their vote today. The morning report names them. |
| 33 | Tooth sharpener | The Butcher's | Werebear: your kill cannot be bargained away — offerings are taken along with their owner, and the morning report announces a sharpener was used. A soup bone can still deflect you to somebody else; only the barrel of beer stops the kill outright. Villager: if the werebear targets you tonight, a 50/50 chance it takes this instead and leaves you alone. |
| 42 | The long candle *(aim: a villager)* | Chapel | Pick a villager. A 50/50 chance you privately learn, on the spot, whether they are the werebear; otherwise you learn nothing. It never lies. |
| 43 | Pizza party | General Store | If the village votes to banish you, the party saves you: nobody is banished today. The morning report names whose party it was. Each purchase saves you once. |
| 44 | Curfew bell | Blacksmith | Ring it, and there is a 50/50 chance the werebear stays home tonight. Either way, the morning report says the bell rang. |
| 45 | Barrel of beer | General Store | You cannot vote today, and you cannot be killed tonight — nothing gets through, including the tooth sharpener. No effect if you are the werebear. |

**Economy.** 50 XLM buy-in, +25 each morning. Two stores a day is the
custom. Each item once per day per player; rebuying on a later day restocks
single-use items. The werebear may buy anything. Items that need a target
(marked *aim*) are pointed after purchase; everything else fires from the
purchase alone.
