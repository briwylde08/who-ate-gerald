# Vendored package

Copied verbatim from [`brozorec/stellar-confidential-token-demo`](https://github.com/brozorec/stellar-confidential-token-demo)
`packages/sdk` at commit `b3da4fef497f07e3ad1ac8ffcda246f6659a2c98` (MIT license, declared in that repo's root `package.json`).

Vendored because `@ctd/sdk` is not published to npm. Keep local modifications
minimal and note them here so upstream syncs stay diffable.

Local modifications: none yet.

- 2026-07-15 local patch: `chain/events.ts` clamps `startLedger` (and recovers stale resume cursors) to the RPC's retained-ledger window via `getHealth().oldestLedger` — testnet retention (~7 days) had aged out our `deployedAtLedger`. Upstream solves this with the Goldsky indexer instead.
