# Playtest #1 — GM Runbook

Moderated hybrid: 7 humans on a video call, real testnet wallets, Bri as GM.
The app is the player's hands; you are the game's clock and voice.

## Before game night

- [ ] Tune `config/catalog.json` (prices, starting budget) — rebuild + redeploy the app if changed.
- [ ] Decide the **tithe-encoding rule** and print it on the wolf's role card
      (e.g. "your tithe's stroop value must end in the victim's seat number").
      It must tolerate villagers accidentally colliding.
- [ ] Decide what non-silver gear does (or declare this playtest silver-only).
- [ ] Host the app (Vite build in `packages/app/dist` — needs the COOP/COEP
      headers from `vite.config.ts` replicated on the host) or run `npm run
      dev` and screen-share instructions.
- [ ] Players install Freighter, switch to **Testnet**, and open the app the
      day before if possible (provisioning is ~2 minutes but first-time
      extension installs eat session time).

## Setup (10 min)

1. Each player opens the app → **Enter the village** → **Provision my
   villager** → sends you their address (shown under "Take your seat").
2. You open `#gm`, paste the GM token (from `config/local.gm.json`), seat the
   roster ("Name, G…" per line), **Seat the village**.
3. Deal roles privately (DM each player; 1 wolf). Send the wolf its role card
   with the tithe rule.
4. **Start next round.**

## Each round (~10 min)

| Phase | You do | They do |
|---|---|---|
| SHOP (3 min) | announce; watch the public graph | 2–3 purchases each |
| TITHE (1 min) | announce | everyone pays the Chapel once |
| ASK (2 min) | select asker (rotation is suggested in the Office panel), type their question verbatim, read Maude's answer aloud | asker asks; table listens |
| TRIAL (5 min) | on an accusation with a disclosure defense: **Issue new disclosure request** → paste to accused in chat → they paste back a bundle → **Verify defense** → announce | accused uses My Ledger → Stand trial |
| VOTE (1 min) | tally in the call; **Eliminate** the lynched player; reveal role | vote |
| NIGHT | **Resolve night** (GM eyes only!) → apply the tithe rule → announce the victim (or the silver save); **Eliminate** them | close their eyes, dramatically |

Then **Start next round** (this resets Maude's seal).

## Win checks

- Wolf lynched → village wins.
- Wolves ≥ living villagers → wolf wins.

## Watch for (capture notes!)

- Pacing per phase — is 3 min of shopping enough with proof times (~10–30 s per purchase)?
- Question quality — what do people actually ask Maude? Does the one-seal
  scope feel right? Does she refuse fairly?
- Does the tithe rule survive collisions/randomness?
- Decoy economics — do people buy nails to muddy trails? Is the budget right?
- Disclosure UX — is copy-paste-in-chat tolerable for the trial?
- Anything Maude says that's out of character or too revealing.

## Emergency levers

- Indexer lag: purchases appear ~instantly after the DO's forced sync, but
  if Maude claims not to see a fresh purchase, wait 30 s and re-resolve
  (never re-ask — the seal is spent; adjudicate by `resolve-night` instead).
- A player's app wedges: their history/keys survive reload (localStorage +
  re-derivable key). Reconnect Freighter and continue.
- Worker misbehaves: `npx wrangler tail gerald-auditor` in
  `packages/auditor-worker` shows live errors.
