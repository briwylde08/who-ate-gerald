import { useEffect, useState } from "react";
import type { DisclosureRequest } from "@ctd/sdk";

import type { VillagerWallet, TxPhase } from "../lib/wallet";
import { loadHistory, type PurchaseRecord } from "../lib/history";
import { xlmString } from "../lib/catalog";

interface Props {
  wallet: VillagerWallet;
  gameId: string;
  /** Tabs stay mounted for draft-survival; reload the list when shown. */
  active: boolean;
  onPhase: (p: TxPhase) => void;
  setBusy: (b: string | null) => void;
  setError: (e: string | null) => void;
}

/**
 * The player's own record of purchases (the chain hides amounts — this list
 * lives only in this browser), plus the trial defense: pick one purchase,
 * paste the GM's disclosure request, and produce an unforgeable proof of that
 * one payment. Nothing else is revealed, and nothing touches the chain.
 */
export function Ledger({ wallet, gameId, active, onPhase, setBusy, setError }: Props) {
  const [history, setHistory] = useState<PurchaseRecord[]>([]);
  useEffect(() => {
    if (active) setHistory(loadHistory(wallet.address, gameId).slice().reverse());
  }, [active, wallet.address, gameId]);
  const [selected, setSelected] = useState<string | null>(null);
  const [requestJson, setRequestJson] = useState("");
  const [bundleJson, setBundleJson] = useState<string | null>(null);

  const disclose = async () => {
    setError(null);
    setBundleJson(null);
    const rec = history.find((h) => h.txHash === selected);
    if (!rec) {
      setError("Pick the purchase you want to prove.");
      return;
    }
    let request: DisclosureRequest;
    try {
      request = JSON.parse(requestJson) as DisclosureRequest;
      if (!request?.pR?.x || !request?.pR?.y || !request?.nu) throw new Error("bad shape");
    } catch {
      setError("That doesn't look like a disclosure request — paste the GM's JSON exactly.");
      return;
    }
    try {
      setBusy("Finding your payment on the chain…");
      const event = await wallet.findSentByHash(rec.txHash);
      if (!event) throw new Error("couldn't find that transfer on the chain (indexer may still be syncing — try again in a minute)");
      const bundle = await wallet.discloseSent(event, request, onPhase);
      setBundleJson(JSON.stringify(bundle, null, 2));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <div className="panel">
        <h2>My purchases</h2>
        <p className="dim">
          Only you (and the Auditor) know these amounts. This list lives in your browser — the
          chain shows the village nothing but the visits.
        </p>
        {history.length === 0 ? (
          <p className="dim">Nothing yet. Go shopping.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th></th>
                <th>when</th>
                <th>shop</th>
                <th>item</th>
                <th>amount</th>
                <th>tx</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.txHash}>
                  <td>
                    <input
                      type="radio"
                      name="disclose"
                      checked={selected === h.txHash}
                      onChange={() => setSelected(h.txHash)}
                    />
                  </td>
                  <td className="dim">{new Date(h.at).toLocaleTimeString()}</td>
                  <td>{h.shopLabel}</td>
                  <td>{h.item}</td>
                  <td>{xlmString(BigInt(h.amountStroops))} XLM</td>
                  <td className="mono dim">{h.txHash.slice(0, 8)}…</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="panel">
        <h2>Stand trial</h2>
        <p className="dim">
          Accused? You may prove exactly one purchase — a real zero-knowledge proof the GM
          verifies against the chain. It reveals that one amount to the GM and nothing else.
          Refusing is legal. And noted.
        </p>
        <p className="dim">1. Select the purchase above. 2. Paste the GM's disclosure request:</p>
        <textarea
          placeholder='{"pR": {"x": "0x…", "y": "0x…"}, "nu": "0x…"}'
          value={requestJson}
          onChange={(e) => setRequestJson(e.target.value)}
        />
        <div className="row">
          <button
            className="primary"
            onClick={() => void disclose()}
            disabled={!selected || requestJson.trim() === ""}
          >
            Generate my defense
          </button>
        </div>
        {bundleJson && (
          <>
            <p className="dim">Send this bundle to the GM (it's safe to paste in the call chat):</p>
            <textarea readOnly value={bundleJson} rows={8} />
            <div className="row">
              <button onClick={() => void navigator.clipboard.writeText(bundleJson)}>
                Copy bundle
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
