import { useEffect, useRef, useState } from "react";
import type { DisclosureRequest } from "@ctd/sdk";

import type { VillagerWallet, TxPhase } from "../lib/wallet";
import { loadHistory, type PurchaseRecord } from "../lib/history";
import { xlmDisplay } from "../lib/catalog";
import { fetchPublicView } from "../lib/player";

interface Props {
  wallet: VillagerWallet;
  gameId: string;
  /** Tabs stay mounted for draft-survival; reload the list when shown. */
  active: boolean;
  onPhase: (p: TxPhase) => void;
  setBusy: (b: string | null) => void;
  setError: (e: string | null) => void;
  /** Jump to the Shops tab — the empty ledger's way out. */
  onGoShops?: () => void;
}

/**
 * Two halves. LEFT: the player's own record of what they bought — item names
 * live in this browser alone, because the chain keeps the amounts encrypted.
 * RIGHT: the manual disclosure ritual. Note that an automated game does NOT
 * use this: being accused is answered in the Town Square, where the server
 * unseals a chosen purchase with the auditor key. This panel is the
 * hand-verified version — a real zero-knowledge proof for a human referee.
 */
export function Ledger({
  wallet,
  gameId,
  active,
  onPhase,
  setBusy,
  setError,
  onGoShops,
}: Props) {
  const [history, setHistory] = useState<PurchaseRecord[]>([]);
  const [accused, setAccused] = useState(false);
  useEffect(() => {
    if (!active) return;
    setHistory(loadHistory(wallet.address, gameId).slice().reverse());
    fetchPublicView(gameId)
      .then((v) => {
        const me = v.players.find((p) => p.address === wallet.address);
        setAccused(me?.standsAccused === true);
      })
      .catch(() => setAccused(false));
  }, [active, wallet.address, gameId]);

  const [selected, setSelected] = useState<string | null>(null);
  const [requestJson, setRequestJson] = useState("");
  const [bundleJson, setBundleJson] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [copied, setCopied] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef<HTMLTextAreaElement>(null);

  const chosen = history.find((h) => h.txHash === selected) ?? null;
  const requestLooksWhole = (() => {
    if (requestJson.trim() === "") return false;
    try {
      const r = JSON.parse(requestJson) as DisclosureRequest;
      return !!(r?.pR?.x && r?.pR?.y && r?.nu);
    } catch {
      return false;
    }
  })();
  const blockedBecause = !chosen
    ? "Choose a purchase first."
    : requestJson.trim() === ""
      ? "Paste the GM's request first."
      : !requestLooksWhole
        ? "That request looks incomplete — paste the whole thing."
        : null;

  const disclose = async () => {
    if (!chosen || !requestLooksWhole) return;
    setError(null);
    setFailure(null);
    setBundleJson(null);
    setWorking(true);
    try {
      const request = JSON.parse(requestJson) as DisclosureRequest;
      setBusy("Finding your payment on the chain…");
      const event = await wallet.findSentByHash(chosen.txHash);
      if (!event) {
        throw new Error(
          "That payment isn't visible on the chain yet — the mirror may still be catching up. Try again in a minute.",
        );
      }
      setBusy("The ledger is being persuaded to testify…");
      const bundle = await wallet.discloseSent(event, request, onPhase);
      setBundleJson(JSON.stringify(bundle, null, 2));
    } catch (e) {
      setFailure(e instanceof Error ? e.message : String(e));
    } finally {
      setWorking(false);
      setBusy(null);
    }
  };

  const step = !chosen ? 1 : !requestLooksWhole ? 2 : 3;
  const stepClass = (n: number) => `step${step === n ? " current" : step > n ? " complete" : ""}`;

  return (
    <div className={`ledger-page${history.length > 0 ? " two-up" : ""}`}>
      <div className="panel ledger-panel">
        <h2>My private ledger</h2>
        <div className="privacy-banner">
          <div className="role-label">🔒 Private ledger</div>
          <p>
            The village sees which shops you visited, never what you paid. The amounts are
            encrypted on the chain — only you and the Auditor can read them, and these item
            names live in this browser alone.
          </p>
        </div>

        {history.length === 0 ? (
          <div className="ledger-empty">
            <p className="empty-head">Your ledger is empty</p>
            <p className="dim">You haven't bought anything yet.</p>
            {onGoShops && (
              <button className="primary" onClick={onGoShops}>
                Visit the Shops
              </button>
            )}
            <p className="lobby-flavor">An honest ledger. How suspicious.</p>
          </div>
        ) : (
          <div className="entries" ref={listRef} role="radiogroup" aria-label="Your purchases">
            {history.map((h) => {
              const isSel = selected === h.txHash;
              return (
                <button
                  key={h.txHash}
                  role="radio"
                  aria-checked={isSel}
                  className={`entry${isSel ? " selected" : ""}`}
                  onClick={() => setSelected(h.txHash)}
                >
                  <span className="entry-main">
                    <span className="entry-item">{h.item}</span>
                    <span className="entry-where">
                      {h.shopLabel}
                      {h.round ? ` · Day ${h.round}` : ""}
                    </span>
                  </span>
                  <span className="entry-side">
                    <span className="entry-amount">
                      {xlmDisplay(BigInt(h.amountStroops))} XLM
                    </span>
                    <span className="entry-state">{isSel ? "Selected ✓" : "Hidden"}</span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="panel defense-panel">
        <h2>{bundleJson ? "Defense ready" : accused ? "Stand trial" : "Prepare your defense"}</h2>
        {accused && (
          <p className="state-note">
            You stand accused in this game. The village expects an answer in the{" "}
            <b>Town Square</b>, where the Order unseals a purchase for you — one tap. This panel
            is the manual version, for a human referee.
          </p>
        )}
        <p className="dim">
          You may prove exactly one purchase. The proof discloses that single amount to whoever
          issued the request, sealed so only they can open it, and says nothing about your other
          purchases. Refusing is allowed.
        </p>
        <p className="maude-quote">It will also be remembered.</p>

        <div className={stepClass(1)}>
          <div className="step-head">
            <span className="step-n">1</span> Choose a purchase
          </div>
          {chosen ? (
            <div className="proving-card">
              <div className="role-label">You are proving</div>
              <div className="proving-what">
                {chosen.item} · {xlmDisplay(BigInt(chosen.amountStroops))} XLM
              </div>
              <p className="dim">
                Bought at the {chosen.shopLabel}
                {chosen.round ? ` on day ${chosen.round}` : ""}. This amount is what gets
                disclosed.
              </p>
              <button
                className="link"
                onClick={() => {
                  setSelected(null);
                  listRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
                }}
              >
                Change selection
              </button>
            </div>
          ) : (
            <p className="dim">Pick one entry from your ledger.</p>
          )}
        </div>

        <div className={stepClass(2)}>
          <div className="step-head">
            <span className="step-n">2</span> Paste the GM request
          </div>
          <label className="composer-label" htmlFor="gm-request">
            GM disclosure request
          </label>
          <textarea
            id="gm-request"
            ref={requestRef}
            placeholder="Paste the request from the GM here…"
            value={requestJson}
            onChange={(e) => setRequestJson(e.target.value)}
            aria-describedby="gm-request-hint"
          />
          <p id="gm-request-hint" className="dim">
            {requestJson.trim() === ""
              ? "The GM generates this in their dashboard and sends it to you."
              : requestLooksWhole
                ? "That looks like a whole request."
                : "Maude cannot read this request — paste the full text the GM sent."}
          </p>
          <details>
            <summary>Show technical format</summary>
            <p className="dim">
              A request is JSON with the verifier's one-time public point <code>pR</code> and a
              nonce <code>nu</code>. It commits the verifier to a key, so the amount you seal can
              be opened by nobody else. Example shape (not real values):
            </p>
            <pre className="mono tech">{`{
  "pR": { "x": "0x…", "y": "0x…" },
  "nu": "0x…"
}`}</pre>
          </details>
        </div>

        <div className={stepClass(3)}>
          <div className="step-head">
            <span className="step-n">3</span> Generate your proof
          </div>
          <div className="row">
            <button
              className="primary"
              onClick={() => void disclose()}
              disabled={working || blockedBecause !== null}
            >
              {working ? "Preparing your defense…" : "Generate defense proof"}
            </button>
            {blockedBecause && <span className="dim">{blockedBecause}</span>}
          </div>
          <p className="dim">Reveals one selected amount to the requester. Nothing else.</p>
        </div>

        {failure && (
          <div className="defense-failed" role="alert">
            <div className="state-head">The ledger refused to cooperate.</div>
            <p className="state-note">{failure}</p>
            <button onClick={() => void disclose()}>Try again</button>
          </div>
        )}

        {bundleJson && (
          <div className="defense-result" role="status">
            <div className="role-label">Your defense is ready</div>
            {chosen && (
              <div className="proving-what">
                {chosen.item} — amount disclosed: {xlmDisplay(BigInt(chosen.amountStroops))} XLM
              </div>
            )}
            <p className="dim">
              Proof status: <b>Ready to hand over</b>. The GM verifies it against the chain in
              their own browser; your remaining purchases stay sealed.
            </p>
            <div className="row">
              <button
                className="primary"
                onClick={() => {
                  void navigator.clipboard.writeText(bundleJson);
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1600);
                }}
              >
                {copied ? "Copied ✓" : "Copy proof"}
              </button>
              <span className="dim">Safe to paste into the call chat.</span>
            </div>
            <details>
              <summary>Show the raw proof</summary>
              <textarea readOnly value={bundleJson} rows={8} />
            </details>
          </div>
        )}

        <details className="privacy-more">
          <summary>How this proof works</summary>
          <p className="dim">
            You pick one purchase. Your browser finds that exact payment in the chain's event
            log, then builds a zero-knowledge proof that you were its sender and seals the
            amount to the key in the GM's request. The GM checks the proof against a pinned
            verification key and the on-chain event — so the amount cannot be a lie, and a
            forged proof cannot pass.
          </p>
          <p className="dim">
            The proof covers that one payment only: your other purchases are separate encrypted
            transfers and are untouched by it. Note that nothing here goes on-chain, and nothing
            is stored — close this tab and the proof is gone.
          </p>
          <p className="dim">
            Two caveats worth knowing. Maude holds the token's auditor key, so the Order can
            already read every amount — this proof is how you convince <i>the table</i>, not
            her. And the store you paid was never secret; only the amount was.
          </p>
        </details>
      </div>
    </div>
  );
}
