# Vendored package

Copied verbatim from [`brozorec/stellar-confidential-token-demo`](https://github.com/brozorec/stellar-confidential-token-demo)
`packages/sdk` at commit `b3da4fef497f07e3ad1ac8ffcda246f6659a2c98` (MIT license, declared in that repo's root `package.json`).

Vendored because `@ctd/sdk` is not published to npm. Keep local modifications
minimal and note them here so upstream syncs stay diffable.

## Local modifications

Every divergence from upstream is listed here and carries a `VENDORED PATCH`
or `VENDORED SPLIT` banner at the top of the file it touches, so an upstream
sync can find them by grep:

```sh
git log --oneline b3da4fe..HEAD -- packages/ctd-sdk   # every commit since vendoring
grep -rn "VENDORED" packages/ctd-sdk/src              # every touched file
```

- **2026-07-15 — `chain/events.ts`** (inherited from Axe & Ember): clamps
  `startLedger`, and recovers stale resume cursors, to the RPC's retained
  window via `getHealth().oldestLedger` — testnet retention (~7 days) had aged
  out our `deployedAtLedger`. Upstream solves this with the Goldsky indexer
  instead.
- **2026-07-28 — `chain/event-shapes.ts` (new), `chain/events.ts`,
  `auditor/decrypt.ts`, `chain/indexer.ts`, `package.json`**: split the pure
  event-shape types and decoders out of `events.ts` so a Cloudflare Worker can
  decode indexer rows without bundling `@stellar/stellar-sdk`. `events.ts`
  re-exports everything, so the SDK's public API is unchanged; the split adds
  the `./chain/event-shapes` and `./chain/indexer` export subpaths.

Note the vendored `README.md` still documents upstream's pnpm workspace
(`pnpm build:sdk`, `pnpm test:sdk`). In this repo those are `npm run build:sdk`
and `npm test -w @ctd/sdk`.
