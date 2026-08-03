# Where we left off — 2026-08-03

## The shelf is CATALOG v9 — 12 items, live and deployed (curfew bell 35 joined in v9)
Blacksmith: nail 20 (tie falls on the other) · cold iron key 22 (lock a
player out of a store tomorrow; store public, victim secret)
General Store: holiday 23 (store shut tomorrow, public) · sock 32 (target's
vote doesn't count; victim NAMED at dawn) · barrel 45 (THE saving item —
no vote today, nothing takes you tonight, sharpener included; does nothing
for the bear)
Butcher's: soup bone 8 (1/4 redirect of the beast to another gate) ·
knife 28 (vote counts twice today) · tooth sharpener 33 (bear: kill beats
everything except the barrel; villager: offering, 1/2 spare)
Chapel: Gerald's finger 1 (nothing, proudly) · unquiet rest 25 (1/2 ghost
vote at death, announced) · long candle 42 (1/2 true role read, private,
else gutters)

Retired today: a bottle, ledger book, musk salve, lantern oil, unsealing
ritual (v7 cut), silver charm (v8 — barrel took its 45 and its job).
Aim system shipped: p/aim, server-private, for key/sock/bone/candle;
barrel is aim "self" (declared drink). Voided purchases at barred doors
keep the coin and do nothing (private note explains).

## ✅ Verified — 2026-08-03, catalog v9 (12 items), 24/24 green
`npm run item-test` now runs the v9 shelf end to end against the live
worker: iron decides a tie, a socked mouth cannot swing a trial even
holding a knife, the bell buys a night nobody dies in, the barrel refuses
its owner's vote WITHOUT stalling dawn, lock and holiday bar doors that
then take the coin and give nothing, the candle reports privately, and the
village hangs the beast. Both bots and the aim system are exercised.

Two bugs it caught, both fixed and deployed:
- **The butcher's knife doubled votes for the rest of the game.** v7
  repriced it and rewrote its copy to "at today's trial" but left the
  tally on `boughtEver`. Two silent extra votes per trial after purchase.
  Now `boughtThisRound`.
- Nothing tested the **stand-accused disclosure** path, which is the only
  way an accused villager regains their vote after an unbroken tie. Now
  covered — and the surviving UI for it is in the town square
  (`Town.tsx:669`), so deleting the Ledger's defense bench cost nothing.

## ⚠ Known gap — no idle timeout anywhere
The only timer in the game is the 60s roll from dawn into the next
morning. Nothing times out **shopping** or **voting**, so one player who
closes their tab freezes the day forever: the market never closes, Maude
never opens, the trial never happens. (This was the "stuck for a while"
moment in playtest 10.) Bots always act, so bot games never show it.
Escape hatch today: the GM's **resolve day**, which force-resolves without
the missing votes. A soft timeout is a pacing decision — Bri's call.

## Open decisions
- Long candle: currently truth-or-gutter (never lies). Bri may want lies.
- Barred doors: currently coin lost, blind. My suggestion: a private
  "door feels stiff" warning at day start. Undecided.
- Village info is thin post-v7: Maude + sightings + tie disclosures +
  candle. Deliberate for now; revisit after a human game.
- `MIN_PLAYERS` still 3 (game.ts). It is a FLOOR, not a cap, so 3 suits
  demos and small tables; flip to 7 only when you want to force a full one.

## Docs drift
CATALOG-V5.md describes a dead shelf (V4 doc too); no v8 doc exists.
GM dashboard still shows retired venison/bane rows. DESIGN-V2.md stale.

## Balance findings from today's analysis (unaddressed remainder)
Nail 20 is quietly excellent for the bear in tie-heavy metas — watch it
with humans. Sock+knife combo swings a tally by 3 for 60 XLM.
