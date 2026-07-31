# Playtest-10 — post-game list

Flagged mid-game by Bri. **Both shipped 2026-07-31** — kept as the record of
what was decided and why.

1. **No "Buy another".** The Shops currently allow repeat purchases of the
   same item (button reads "Buy another" once bought). Rule: one of each
   item per player. Needs a UI block (localStorage record, same source as
   the ✓ Bought badge) — and a decision on whether the SERVER should also
   audit repeats, since the chain itself can't stop the transfer (same
   enforcement shape as barred doors: coin kept, effect voided, or effect
   simply counted once — note countBought-based effects like the nail
   currently stack per purchase).

2. **"Pick a character" is hard to reach when logged in.** Getting back to
   the character page for a new game/character is unintuitive (identity
   chip in the banner is the only path, and it's not labelled). Add an
   explicit button — e.g. in the top bar next to Rules, or on the Town
   Square when in lobby: "Change villager".

## Outcome

1. **Done.** A bought ware now reads "Bought ✓" and is disabled for the rest
   of the game. The chain cannot refuse a forced second transfer, so the
   Order audits repeats (GM-only violation) and the nail's tie-escapes cap
   at one regardless of copies.
2. **Done.** "Change villager" sits in the banner beside Rules, and both it
   and the identity chip open the intro straight at the picker.
