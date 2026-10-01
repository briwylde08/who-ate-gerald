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

Original to this project, generated with AI tools on paid plans whose terms
assign the output to the account holder with no restriction on public use:

| Assets | Tool |
|---|---|
| Character portraits, Maude, and the item icons | ChatGPT image generation (OpenAI) |
| Village background, satchel, Gerald's hand, bear icon, favicon | Nano Banana via Runway |
| The films (video) | Seedance via Runway |
| Film audio | Seedance's own audio, plus ElevenLabs Sound Effects (the bear) and Eleven Music in a few films |

Sources: OpenAI Terms of Use (you own Output, free or paid); Runway usage
rights (you retain ownership on any plan, no credit required); ElevenLabs
(paid plans include a commercial license, content made during a paid
subscription stays licensed). The per-asset record and the full-resolution
originals are kept outside this repository.
