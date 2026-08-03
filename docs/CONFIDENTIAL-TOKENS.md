# Confidential tokens — the canonical explanation

**Source of truth: [How a confidential token transfer works on Stellar][doc]**
(Bri's Google Doc — living document; this file links, it does not copy, so it
cannot go stale.)

[doc]: https://docs.google.com/document/d/1Ar-CYjZwl0-EhyqktHgBLXsCQEQUW3BzRHbDq5-Xrv4/edit

## The short version

A confidential-token wrapper does not hide XLM. It holds real XLM in a shared
public pool and issues **confidential claims** on that pool. A transfer
reassigns claims; the underlying XLM never moves until someone withdraws.

Value lives in three places: your **regular balance** (public), the
**contract pool** (total public, ownership hidden), and your **confidential
claims** — stored as Pedersen commitments, readable as bytes by anyone,
openable only by the holder.

Each participant has two balances. **Pending** is the inbox: deposits and
incoming transfers land there, and others can add to it. **Spendable** is the
pocket: only you change it. They are separate because a zero-knowledge proof
is valid only against the exact commitment it was built from — if payments
landed straight in your spendable balance, anyone could invalidate your
in-flight proof by paying you a trivial amount, repeatedly.

Six verbs: **register once · public value in · merge · hidden transfer ·
merge · public value out.** Deposits and withdrawals reveal amounts;
everything inside the wrapper does not.

Observers always see *that* a transfer happened, *who* authorised it, and
*when*. They never see the amount or either balance. **The wrapper hides
amounts, not identities.**

## How Who Ate Gerald? uses it

| The doc's term | In the game |
|---|---|
| Register | "Register your keys with the confidential token contract" during provisioning |
| Deposit (public amount) | The 50 XLM buy-in and the 15/day income — public *on purpose*, so the village can verify everyone plays with the same budget |
| Pending balance | The Shops' "📦 Uncollected" reading |
| Merge | "Collect into purse" |
| Confidential transfer | Buying an item: the store visit is public, the amount is not |
| The auditor channel | Maude McLedger holds the auditor key; it is how she answers truthfully, and how a stand-accused disclosure cannot be a lie |
| Withdraw | Not used — the game never leaves the wrapper |

**The design consequence** the doc makes explicit, and the whole game is
built on: *identities are not hidden.* That is why the sightings graph shows
who visited which store, why prices are globally unique (the amount IS the
item), and why hiding the amount is exactly equivalent to hiding the purchase.

## Where the game teaches this, in play

The requirement is that a player learns the mechanics *while playing*, not
from a reading assignment. Four surfaces carry it, and all four narrate
something the code is genuinely doing at that moment — if the protocol
changes, these are the strings that go stale:

| Surface | Teaches | Where |
|---|---|---|
| Narrated purchase (the wait is a real proof) | read sealed balance → build witness → prove in-browser → verify without learning the amount | `PHASE_LABEL` in `ui/PlayerApp.tsx`, fired from `wallet.transfer()` |
| "What the chain saw" split rows + explorer links | public visit vs sealed amount, per purchase; go check the tx yourself | `ui/Ledger.tsx` |
| 📦 Uncollected note | why pending and spendable are separate balances | `ui/Village.tsx` purse |
| "Read with the Auditor's key" under each answer | the auditor channel is a token feature, not a story device | `ui/Maude.tsx` |

The app's own in-game explainer (📜 Rules → "What's actually happening under
the hood") is written to agree with this doc. If the doc changes, check that
section in `packages/app/src/ui/Story.tsx`.

## Note on wrappers

The doc's closing sections explain why many wrapper contracts exist during the
developer preview, and what maturity might look like (a handful of audited,
socially-canonical wrappers per asset, differentiated by compliance profile).
Relevant here because this game deploys **its own** wrapper — see
`config/deployment.testnet.json`.
