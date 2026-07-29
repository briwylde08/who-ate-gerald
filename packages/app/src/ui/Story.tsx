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
        <i>someone in town</i>. Someone you know. Someone who shops at the same five stores
        you do.
      </p>
      <p>
        It's your job to help your neighbors find the werebear.{" "}
        <b>Unless the werebear is you.</b>
      </p>
      <details>
        <summary>How the game works</summary>
        <p className="dim">
          Every day: collect your allowance, visit up to <b>two of the five stores</b>, and
          buy what you can afford — gear that protects you, tools that avenge you, or cheap
          junk that muddies your trail. Every purchase is a real confidential payment:{" "}
          <b>the whole village sees which store you visited, but never the amount — and the
          amount is the item.</b>
        </p>
        <p className="dim">
          Each day you also get <b>one private question</b> to Maude McLedger, the only soul
          who can read the hidden amounts. Then the village votes to banish its best guess at
          the werebear — and at night, the werebear eats someone. Find it before it finds
          you.
        </p>
      </details>
    </>
  );
}
