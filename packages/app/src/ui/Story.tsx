/** The Gerald cold open — shown on first visit and via the 📜 banner button. */
export function GeraldStory() {
  return (
    <>
      <p>Villager Gerald has been eaten.</p>
      <p>
        Eaten by a <b>werebear</b> — we know because of the telltale signs of a werebear
        attack. Someone found his mangled remains at the treeline this morning: a still-lit
        lantern strapped to his arm, one pink croc, and nothing else. Bear tracks everywhere.
      </p>
      <p>
        There have been whispers of a werebear round these parts for years. And this is a
        remote town — nobody arrives, nobody leaves. Which means the werebear is{" "}
        <i>someone in town</i>. Someone you know. Someone who shops at the same four stores
        you do.
      </p>
      <p>
        It's your job to help your neighbors find the werebear.{" "}
        <b>Unless the werebear is you.</b>
      </p>
      <details>
        <summary>What's actually happening under the hood</summary>
        <p className="dim">
          Your budget is a balance in a <b>confidential token</b> on Stellar testnet. You
          deposit public XLM to fund it, and deposits are public — that's how everyone can
          verify each player starts with the same 50 XLM and collects the same 15 per day.
          Once the money is inside the token, your balance is stored as an encrypted
          commitment: on the ledger it is ciphertext, not a number anyone can read.
        </p>
        <p className="dim">
          Buying an item is one <b>confidential transfer</b> from your account to a store's
          account. The ledger publicly records who paid whom; the amount is encrypted and
          accompanied by a zero-knowledge proof — generated in your browser, which is the few
          seconds of "sealing" you wait through — showing the transfer is valid: you had the
          funds, no tokens were created, the balances reconcile. The chain reveals none of
          the amount.
        </p>
        <p className="dim">
          Each store sells at fixed prices, and every price in the game is unique, so{" "}
          <b>the amount is the item</b>. Encrypting the amount is therefore what hides your
          purchase — while the visit itself stays public. The public list of store visits (up
          to two stores per day) and the private list of amounts are the two halves of the
          game.
        </p>
        <p className="dim">
          The token also supports an <b>auditor key</b>, held here by Maude McLedger. It
          decrypts every transfer, which is how your one question per day gets answered from
          real ledger data rather than guesswork. And when you are accused, you nominate a
          single purchase to unseal: the server decrypts that one transfer and publishes the
          item, so the disclosure comes from the chain and cannot be a lie — selective
          disclosure, which is the point of the whole scheme.
        </p>
      </details>
    </>
  );
}
