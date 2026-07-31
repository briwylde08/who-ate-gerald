# Where we left off — 2026-07-31 (end of day)

## The shelf is now CATALOG v8 — 11 items, live and deployed
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

## ⚠ Unverified — do these before the next human game
1. **Rewrite `npm run item-test` for v8** — it still stages charms and
   lantern oil, so it fails on its first purchase. NONE of the aimed
   items (key, sock, bone, candle, barrel, holiday) has completed a
   verified run; the aim-sync fix is deployed but only exercised once.
2. **Bots don't buy the new shelf** — their cheap-lean filter (≤15 XLM)
   now matches only the finger and the bone. Raise it or they'll sit out
   the entire economy in the next bot game.

## Open decisions
- Long candle: currently truth-or-gutter (never lies). Bri may want lies.
- Barred doors: currently coin lost, blind. My suggestion: a private
  "door feels stiff" warning at day start. Undecided.
- Village info is thin post-v7: Maude + sightings + tie disclosures +
  candle. Deliberate for now; revisit after a human game.
- `MIN_PLAYERS` still 3 (game.ts) — flip to 7 for the real table.

## Docs drift
CATALOG-V5.md describes a dead shelf (V4 doc too); no v8 doc exists.
GM dashboard still shows retired venison/bane rows. DESIGN-V2.md stale.

## Balance findings from today's analysis (unaddressed remainder)
Nail 20 is quietly excellent for the bear in tie-heavy metas — watch it
with humans. Sock+knife combo swings a tally by 3 for 60 XLM.
