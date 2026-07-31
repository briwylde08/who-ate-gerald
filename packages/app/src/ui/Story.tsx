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
        <summary>The rules</summary>
        <p className="dim">
          Everyone starts with <b>50 XLM</b> of hidden budget and collects <b>15 more</b> each
          morning. Once every player is ready, roles are dealt in secret: <b>one werebear</b>,
          everyone else villagers. The werebear plays the whole day as a villager — it shops,
          talks, and votes like anyone else — and then picks who dies that night.
        </p>
        <p className="dim">Each day runs in this order:</p>
        <ol className="dim rules">
          <li>
            <b>Shop.</b> Visit at most <b>two of the four stores</b> and buy whatever you can
            afford there. Every item's effect is public knowledge; which one you bought is not.
            Press <b>Done</b> when you've finished.
          </li>
          <li>
            <b>The market closes</b> once every living player has declared Done.
          </li>
          <li>
            <b>Maude.</b> Each player may ask her <b>one private question</b> per day. She
            answers from the ledger, so she cannot be wrong — but she answers only you.
          </li>
          <li>
            <b>The square.</b> Open chat. Accuse, defend, lie.
          </li>
          <li>
            <b>The trial.</b> Everyone still alive votes for the player they believe is the
            werebear. Most votes is banished. A tie normally banishes nobody — the tied
            players must each unseal one purchase before they may vote again — but lucky iron
            steps its owner out of a tie, and the rope looks for whoever is left.
          </li>
          <li>
            <b>Night.</b> The werebear chooses someone to eat. Dawn breaks as soon as the last
            vote and that choice are in.
          </li>
          <li>
            <b>Morning.</b> The village learns who was banished, who was eaten, and whatever
            the night's items did.
          </li>
        </ol>
        <p className="dim">
          <b>The village wins</b> by banishing the werebear. <b>The werebear wins</b> if it is
          the last one standing beside a single villager, or if it is still unfound at the end
          of <b>day five</b>. Banished and eaten players keep chatting as ghosts, but cast no
          votes.
        </p>
      </details>
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
