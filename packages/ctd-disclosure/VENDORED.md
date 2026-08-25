# Vendored package

Copied verbatim from [`brozorec/stellar-confidential-token-demo`](https://github.com/brozorec/stellar-confidential-token-demo)
`packages/disclosure` at commit `b3da4fef497f07e3ad1ac8ffcda246f6659a2c98` (MIT license, declared in that repo's root `package.json`).

## License

Upstream declares `"license": "MIT"` in its root `package.json` but ships no
LICENSE file, so there is no notice text or copyright line to copy verbatim.
The `LICENSE` in this directory reproduces the standard MIT License text (a
public template, not upstream's authored work) and attributes copyright to the
upstream project as it publicly declared. If upstream later adds its own LICENSE
file, replace this one with theirs verbatim, including its exact copyright line.

The pinned circuit artifacts + verification keys in `artifacts/` are the
off-chain trust anchor for selective disclosure — both prover and verifier
must agree on these exact bytes. Do not regenerate casually.

Local modifications: none yet.
