# Where we left off — 2026-07-30 evening

## Done today
- **Catalog v4 shipped** (`config/catalog.json`, `docs/CATALOG-V4.md`): twelve
  items, one clause each, no counter-chains, mixed-purpose stores.
- **Three pages redesigned**: Shops (night market), Town Square (lobby as a
  gathering place), Maude (private consultation). Character portraits, icons
  for all eight villagers, werebear background, Fraunces masthead, favicon.
- **Bug fixes worth remembering**: cross-game leakage in sightings/facts/audits
  (a new game showed 82 phantom sightings from other games' wallets); tabs
  rendering behind the intro; the picker locking a returning player's own seat;
  Log out missing before connect; ghosts able to shop.
- **`npm run mini-game:v4`** — new item exam. First run: 21/21 item checks
  green (nail, bottle, charm+shatter, dogs, ledger book, ritual, ham masking,
  musk hooding, forced disclosure). Day 3's checks (bear trap, votive candle,
  lantern oil) went unverified because the game resolved dawn itself; fixed
  with `finishDay()` and re-running.

## Pick up here
1. **Read the re-run result** of `npm run mini-game:v4` (in the transcript, or
   just run it again — a few minutes). Confirms trap / candle / lantern.
2. **My Ledger redesign** — plan agreed, not built. Two columns (private
   ledger 40% / defense builder 60%), three-step defense flow, technical JSON
   into a collapsed disclosure, Copy proof only.
   Three findings the plan is built on:
   - The paste-a-request proof flow is the *moderated* v1 mechanism. Real
     accusations resolve in the Town Square (server unseals with the auditor
     key). Frame this page as the manual ritual, not the live defense.
   - "Reveals one amount to the GM and nothing else" is true of the *proof*,
     but the GM's god view already decrypts everything. Keep the claim narrow.
   - No submit endpoint for bundles: Copy proof only. No Submitted / Verified /
     Rejected states. Results don't survive a refresh.
3. **`MIN_PLAYERS` 3 → 7** in `packages/auditor-worker/src/game.ts` when ready
   for the real table.
4. **Balance watch**: at 7 players parity arrives about day 3 (7→5→3→1), so the
   village gets ~3 trials to find 1 bear among 6 — the five-day clock never
   comes into play. Bench items (curfew bell ~40, town clock ~30) are in
   `docs/CATALOG-V4.md` if the village keeps losing.
5. Also open: the butcher's knife permanent double-vote is the one v4 item the
   exam doesn't cover (tie arithmetic hides it); `docs/DESIGN-V2.md` is stale;
   the GM dashboard still shows retired venison/bearsbane rows.
