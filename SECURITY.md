# Security

**Who Ate Gerald?** is a testnet game played for nothing. It exists to show a
real confidential-token payment lifecycle on Stellar, with the game as the
vehicle. Some choices below would be wrong for anything that holds value. They
are listed so they read as decisions, not oversights. The README's
[Security notes](README.md#security-notes) cover the client-side ones: the
bearer seat credential, the localStorage spending key, the shared GM token.

## Reporting a problem

Open a GitHub issue. Nothing here guards real value, so there is no private
disclosure channel and no bounty.

## What is ours and what is not

- **Ours:** `packages/app`, `packages/auditor-worker`, `scripts/`.
- **Not ours:** `packages/ctd-sdk` and `packages/ctd-disclosure`, vendored at a
  pinned commit from
  [`brozorec/stellar-confidential-token-demo`](https://github.com/brozorec/stellar-confidential-token-demo)
  (see each package's `VENDORED.md`). That SDK is an unaudited developer
  preview; findings in it belong upstream, and the ones we know of have been
  passed along. The game compensates where it can: Maude reads every transfer
  through two independent auditor channels and drops any transfer where they
  disagree, so a wrong amount never becomes a game fact.

## Rules the chain does not enforce

The chain cannot refuse a confidential transfer. Nothing on-chain enforces the
equal starting budget, the daily allowance, or the moment at which a purchase
counts. The Worker computes item effects from the whole round and voids what
the rules disallow at dawn. That is enough for a trusted table. A deliberate
adversary could fund a wallet past the allowance, buy an effect after seeing
the votes, or stack copies of a single-use item. All three are fixable by
extending the void-at-dawn pattern; none is implemented, because every game so
far has been played among people who wanted to find out who ate Gerald, not to
win by accounting.

Lobbies are open and not rate-limited. Games are run by invitation and start
when the host says so, which is the control.
