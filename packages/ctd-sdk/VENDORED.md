# Vendored package

Copied verbatim from [`brozorec/stellar-confidential-token-demo`](https://github.com/brozorec/stellar-confidential-token-demo)
`packages/sdk` at commit `b3da4fef497f07e3ad1ac8ffcda246f6659a2c98` (MIT license, declared in that repo's root `package.json`).

## License

Upstream declares `"license": "MIT"` in its root `package.json` but ships no
LICENSE file, so there is no notice text or copyright line to copy verbatim.
The `LICENSE` in this directory reproduces the standard MIT License text (a
public template, not upstream's authored work) and attributes copyright to the
upstream project as it publicly declared. If upstream later adds its own LICENSE
file, replace this one with theirs verbatim, including its exact copyright line.

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
- **2026-08-06 — `auditor/decrypt.ts`**: `auditTransfer` derives both auditor
  channels from ONE ECDH instead of calling the two per-channel helpers, which
  each recomputed `ecdh(k, ev.rE)` on the same ephemeral point. Same
  arithmetic, ~3.67 ms → 1.95 ms per audited transfer — and the auditor
  decrypts every transfer on every chain read.

Note the vendored `README.md` still documents upstream's pnpm workspace
(`pnpm build:sdk`, `pnpm test:sdk`). In this repo those are `npm run build:sdk`
and `npm test -w @ctd/sdk`.
