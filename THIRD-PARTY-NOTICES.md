# Third-party notices

This repository's own code is covered by the read-only notice in
[LICENSE](LICENSE), copyright the Stellar Development Foundation, **except**
the third-party content below, which keeps its own license.

## Vendored confidential-token packages

| Directory | Upstream | License |
|---|---|---|
| `packages/ctd-sdk` | [brozorec/stellar-confidential-token-demo](https://github.com/brozorec/stellar-confidential-token-demo) `packages/sdk` at commit `b3da4fef` | MIT |
| `packages/ctd-disclosure` | same repo, `packages/disclosure` at the same commit | MIT |

Upstream declares MIT in its root `package.json` but ships no LICENSE file, so
each directory carries the standard MIT text attributed to the upstream author
and a `VENDORED.md` recording the pinned commit and every local modification.
The disclosure circuits and pinned verification keys in
`packages/ctd-disclosure/artifacts/` are the off-chain trust anchor for
selective disclosure and are reproduced unchanged.

## Prover bundle served to the browser

`packages/app/public/vendor/bb/` is a browser build of the Barretenberg
UltraHonk prover (`@aztec/bb.js` 0.87.0, Apache-2.0). The bundle's own
`*.LICENSE.txt` files list the licenses it carries: Apache-2.0 (Aztec; and
Google LLC for a bundled component), plus MIT, BSD-3-Clause and Zlib for
small helpers (`buffer`, `ieee754`, `pako`).

## Fonts

Fraunces and IBM Plex Mono are loaded at runtime from Google Fonts under the
SIL Open Font License 1.1. Nothing is vendored.

## Game art, films and audio

Original to this project. A per-asset provenance record (tool, plan tier,
terms) is kept outside the repository and will be summarised here once
complete. The full-resolution originals are not in this repository.
