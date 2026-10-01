/**
 * #/terms and #/privacy — the game site's legal pages, plus the footer that
 * links them from every page. Text is SDF legal's (Eric, 2026-09-30, in the
 * blog doc); edit the wording there first, then mirror it here verbatim.
 * Layout follows the Watch page: masthead + one panel, no wallet, no seat.
 */

const STELLAR_TOS = "https://stellar.org/terms-of-service";
const STELLAR_PRIVACY = "https://stellar.org/privacy-policy";

function LegalFrame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="app-root legal-page">
      <div className="masthead">
        <h1 className="title">
          Who Ate <span className="title-accent">Gerald?</span>
        </h1>
        <p className="subtitle">Trust is scarce. Gerald is dead.</p>
      </div>
      <div className="panel legal-panel">
        <h2>{title}</h2>
        {children}
        <p className="dim legal-back">
          <a href="#/">← Back to the village</a>
        </p>
      </div>
    </div>
  );
}

export function Terms() {
  return (
    <LegalFrame title="Game Terms">
      <p>
        Who Ate Gerald? is operated by the Stellar Development Foundation (SDF). By playing, you
        agree to the <a href={STELLAR_TOS}>stellar.org Terms of Service</a>. These game terms
        supplement them and control if they conflict.
      </p>
      <p>
        The game is an experimental game on Stellar testnet. Testnet XLM has no monetary value.
        There is no entry fee, prize, or reward of real value. Do not use the game with mainnet
        assets.
      </p>
      <p>
        You need a wallet set to testnet to play. Follow the game rules shown on this site. Do not
        harass other players or post unlawful or sensitive content in chat or whispers. SDF may
        remove content, end a game, or restrict access if needed to protect players or the
        service.
      </p>
      <p>
        The game and its confidential-token components are experimental and have not been audited
        as a reference implementation. The game is provided as is and may change or stop working.
      </p>
    </LegalFrame>
  );
}

export function Privacy() {
  return (
    <LegalFrame title="Privacy Notice">
      <p>
        SDF handles game information under its{" "}
        <a href={STELLAR_PRIVACY}>Privacy Policy</a>. To run the game, SDF processes wallet
        addresses, display names, game actions, chat, whispers, and questions to Maude. Testnet
        transactions are public, though confidential transfer amounts are designed to remain
        hidden from the public. Players can see town-square chat. Whispers are visible to their
        intended recipients and to SDF personnel with game-master access.
      </p>
      <p>
        Questions to Maude and relevant game context are sent through Cloudflare AI Gateway to a
        third-party AI provider, currently OpenAI, to produce an answer. Do not include sensitive
        personal information in chat, whispers, or questions.
      </p>
    </LegalFrame>
  );
}

/** Rides the bottom of every page. Same shape as raven.stellar.org's footer. */
export function LegalFooter() {
  return (
    <footer className="site-footer dim">
      <a href="#/terms">Game Terms</a>
      <span aria-hidden="true"> · </span>
      <a href="#/privacy">Privacy</a>
      <span aria-hidden="true"> · </span>
      <a href={STELLAR_TOS} target="_blank" rel="noopener">
        Stellar Terms
      </a>
      <span aria-hidden="true"> · </span>
      <a href="https://github.com/stellar-experimental/who-ate-gerald" target="_blank" rel="noopener">
        Source
      </a>
    </footer>
  );
}
