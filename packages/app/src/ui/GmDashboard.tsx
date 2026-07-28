import { useCallback, useEffect, useState } from "react";
import {
  generateRecipientKeys,
  recipientKeysFromSecret,
  newDisclosureRequest,
  verifyDisclosure,
  proverFromArtifact,
  toHex32,
  fromHex,
  type DisclosureBundle,
  type DisclosureRequest,
  type VerifiedDisclosure,
} from "@ctd/sdk";
import discloseSenderCircuit from "@ctd/disclosure/artifacts/disclose_sender.json";
import discloseSenderVk from "@ctd/disclosure/artifacts/disclose_sender.vk.json";

import { chainClient, indexerClient } from "../lib/deployment";
import { ensureBrowserBackend } from "../lib/bb-loader";
import { SHOP_BY_ADDRESS, stroopsFromXlm, xlmString } from "../lib/catalog";
import { gmApi, loadGmConfig, saveGmConfig, type GmConfig, type GmPlayer } from "../lib/gm";

/**
 * The GM's chair for the moderated playtest: roster, round controls, Maude's
 * ask console, the night god-view, the public graph, and the trial verifier.
 * Everything but the trial verifier talks to the gerald-auditor worker; the
 * verifier runs the disclosure check right here in the browser, against the
 * chain — the GM trusts no one's copy-paste, only the proof.
 */
export function GmDashboard() {
  const [cfg, setCfg] = useState<GmConfig>(loadGmConfig);
  const [players, setPlayers] = useState<GmPlayer[]>([]);
  const [round, setRound] = useState(0);
  const [questionUsed, setQuestionUsed] = useState(false);
  const [suggestedAsker, setSuggestedAsker] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const updateCfg = (patch: Partial<GmConfig>) => {
    const next = { ...cfg, ...patch };
    setCfg(next);
    saveGmConfig(next);
  };

  const refreshState = useCallback(async () => {
    if (!cfg.token) return;
    try {
      const s = await gmApi.state(cfg);
      setPlayers(s.players);
      setRound(s.round);
      setQuestionUsed(s.questionUsed);
      setSuggestedAsker(s.suggestedAsker);
      setError(null);
    } catch (e) {
      setError(msg(e));
    }
  }, [cfg]);

  useEffect(() => {
    void refreshState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = async (label: string, fn: () => Promise<void>) => {
    setError(null);
    setStatus(label);
    try {
      await fn();
    } catch (e) {
      setError(msg(e));
    } finally {
      setStatus(null);
    }
  };

  return (
    <div>
      <h1>Who Ate Gerald? — GM</h1>
      <p className="tagline">The Order sees everything. You see the Order.</p>

      {error && (
        <div className="error">
          {error} <button onClick={() => setError(null)}>dismiss</button>
        </div>
      )}
      {status && <p className="dim">… {status}</p>}

      <div className="panel">
        <h2>Office</h2>
        <div className="row">
          <label className="dim">game id</label>
          <input
            type="text"
            value={cfg.gameId}
            onChange={(e) => updateCfg({ gameId: e.target.value })}
          />
          <label className="dim">GM token</label>
          <input
            type="password"
            value={cfg.token}
            onChange={(e) => updateCfg({ token: e.target.value })}
          />
          <button onClick={() => void refreshState()}>Load game</button>
        </div>
        <p className="dim">
          Round {round} · seal {questionUsed ? "SPENT" : "unbroken"}
          {suggestedAsker ? ` · asker: ${suggestedAsker}` : ""} ·{" "}
          {players.filter((p) => p.alive).length}/{players.length} alive
        </p>
      </div>

      <Roster cfg={cfg} players={players} run={run} refreshState={refreshState} />
      <RoundControls
        cfg={cfg}
        players={players}
        run={run}
        refreshState={refreshState}
      />
      <AskConsole cfg={cfg} players={players} questionUsed={questionUsed} refreshState={refreshState} />
      <NightPanel cfg={cfg} run={run} />
      <GraphPanel cfg={cfg} />
      <TrialPanel />
    </div>
  );
}

// ---------------------------------------------------------------------------

function Roster({
  cfg,
  players,
  run,
  refreshState,
}: {
  cfg: GmConfig;
  players: GmPlayer[];
  run: (label: string, fn: () => Promise<void>) => Promise<void>;
  refreshState: () => Promise<void>;
}) {
  const [rosterText, setRosterText] = useState("");
  const [force, setForce] = useState(false);

  const create = () =>
    run("seating the village…", async () => {
      const entries = rosterText
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [name, address] = line.split(/[,\s]+/).map((s) => s.trim());
          if (!name || !address) throw new Error(`bad roster line: "${line}" (want "Name, G…")`);
          return { name, address };
        });
      await gmApi.newGame(cfg, entries, force);
      await refreshState();
    });

  return (
    <div className="panel">
      <h2>Roster</h2>
      {players.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>seat</th>
              <th>name</th>
              <th>address</th>
              <th>status</th>
            </tr>
          </thead>
          <tbody>
            {players.map((p) => (
              <tr key={p.seat}>
                <td>{p.seat}</td>
                <td>{p.name}</td>
                <td className="mono dim">
                  {p.address.slice(0, 6)}…{p.address.slice(-6)}
                </td>
                <td>{p.alive ? "alive" : "☠ eliminated"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <details>
        <summary>Seat a new game (one per line: Name, G…)</summary>
        <textarea
          placeholder={"Ada, GABC…\nBob, GDEF…"}
          value={rosterText}
          onChange={(e) => setRosterText(e.target.value)}
        />
        <div className="row">
          <label className="dim">
            <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />{" "}
            force (resets a game in progress)
          </label>
          <button className="primary" onClick={() => void create()} disabled={!rosterText.trim()}>
            Seat the village
          </button>
        </div>
      </details>
    </div>
  );
}

function RoundControls({
  cfg,
  players,
  run,
  refreshState,
}: {
  cfg: GmConfig;
  players: GmPlayer[];
  run: (label: string, fn: () => Promise<void>) => Promise<void>;
  refreshState: () => Promise<void>;
}) {
  const [victim, setVictim] = useState("");
  const [lastStart, setLastStart] = useState<string | null>(null);

  return (
    <div className="panel">
      <h2>Rounds</h2>
      <div className="row">
        <button
          className="primary"
          onClick={() =>
            void run("opening the round…", async () => {
              const r = await gmApi.startRound(cfg);
              setLastStart(`Round ${r.round} open — asker: ${r.asker} (ledger ${r.startLedger})`);
              await refreshState();
            })
          }
        >
          Start next round
        </button>
        {lastStart && <span className="dim">{lastStart}</span>}
      </div>
      <div className="row">
        <select value={victim} onChange={(e) => setVictim(e.target.value)}>
          <option value="">eliminate whom?</option>
          {players
            .filter((p) => p.alive)
            .map((p) => (
              <option key={p.seat} value={p.name}>
                {p.name}
              </option>
            ))}
        </select>
        <button
          disabled={!victim}
          onClick={() =>
            void run("striking the name…", async () => {
              await gmApi.eliminate(cfg, victim);
              setVictim("");
              await refreshState();
            })
          }
        >
          Eliminate
        </button>
      </div>
    </div>
  );
}

function AskConsole({
  cfg,
  players,
  questionUsed,
  refreshState,
}: {
  cfg: GmConfig;
  players: GmPlayer[];
  questionUsed: boolean;
  refreshState: () => Promise<void>;
}) {
  const [asker, setAsker] = useState("");
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Awaited<ReturnType<typeof gmApi.ask>> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ask = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await gmApi.ask(cfg, question, asker || undefined);
      setResult(r);
      setQuestion("");
      await refreshState();
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel">
      <h2>Maude McLedger — one seal per moon</h2>
      {error && <div className="error">{error}</div>}
      <div className="row">
        <select value={asker} onChange={(e) => setAsker(e.target.value)}>
          <option value="">asker (default: rotation)</option>
          {players
            .filter((p) => p.alive)
            .map((p) => (
              <option key={p.seat} value={p.name}>
                {p.name}
              </option>
            ))}
        </select>
      </div>
      <textarea
        placeholder="The asker's one question, verbatim…"
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
      />
      <div className="row">
        <button
          className="primary"
          onClick={() => void ask()}
          disabled={busy || questionUsed || question.trim() === ""}
        >
          {busy ? "Maude is consulting the register…" : questionUsed ? "Seal spent this round" : "Put the question"}
        </button>
      </div>
      {result && (
        <>
          <div className="answer-card">“{result.answer}”</div>
          <details>
            <summary>
              behind the seal: {result.tool} — asked by {result.asker}, round {result.round}
            </summary>
            <pre className="mono">{JSON.stringify({ args: result.args, fact: result.fact }, null, 2)}</pre>
          </details>
        </>
      )}
    </div>
  );
}

function NightPanel({
  cfg,
  run,
}: {
  cfg: GmConfig;
  run: (label: string, fn: () => Promise<void>) => Promise<void>;
}) {
  const [view, setView] = useState<Awaited<ReturnType<typeof gmApi.resolveNight>> | null>(null);

  return (
    <div className="panel">
      <h2>Night — GM eyes only</h2>
      <div className="row">
        <button
          onClick={() =>
            void run("decrypting the round…", async () => {
              setView(await gmApi.resolveNight(cfg));
            })
          }
        >
          Resolve night (round god-view)
        </button>
      </div>
      {view && (
        <>
          <p className="dim">Round {view.round}. {view.note}</p>
          <table>
            <thead>
              <tr>
                <th>player</th>
                <th>purchases</th>
                <th>tithes</th>
              </tr>
            </thead>
            <tbody>
              {view.players.map((p) => (
                <tr key={p.seat}>
                  <td>
                    {p.name}
                    {p.alive ? "" : " ☠"}
                  </td>
                  <td>
                    {p.purchases.length === 0
                      ? "—"
                      : p.purchases
                          .map((x) => `${x.shop}: ${x.amountXlm} XLM (${x.item})`)
                          .join(" · ")}
                  </td>
                  <td>{p.tithes.length === 0 ? "—" : p.tithes.map((t) => `${t} XLM`).join(" · ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {view.strangers.length > 0 && (
            <p className="dim">
              strangers: {view.strangers.map((s) => `${s.from.slice(0, 6)}→${s.to} ${s.amountXlm}`).join(" · ")}
            </p>
          )}
        </>
      )}
    </div>
  );
}

function GraphPanel({ cfg }: { cfg: GmConfig }) {
  const [graph, setGraph] = useState<Awaited<ReturnType<typeof gmApi.graph>> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    try {
      setGraph(await gmApi.graph(cfg));
      setError(null);
    } catch (e) {
      setError(msg(e));
    }
  };

  const byRound = new Map<number, { from: string; to: string }[]>();
  for (const e of graph?.edges ?? []) {
    const list = byRound.get(e.round) ?? [];
    list.push(e);
    byRound.set(e.round, list);
  }

  return (
    <div className="panel">
      <h2>The public graph (share this screen)</h2>
      {error && <div className="error">{error}</div>}
      <div className="row">
        <button onClick={() => void refresh()}>Refresh</button>
        <span className="dim">who paid whom — amounts hidden, exactly what the village sees</span>
      </div>
      {[...byRound.entries()]
        .sort((a, b) => b[0] - a[0])
        .map(([r, edges]) => (
          <div key={r}>
            <h3 className="dim">{r === 0 ? "before the first moon" : `round ${r}`}</h3>
            <p>
              {edges.map((e, i) => (
                <span key={i}>
                  {e.from} → {e.to}
                  {i < edges.length - 1 ? " · " : ""}
                </span>
              ))}
            </p>
          </div>
        ))}
    </div>
  );
}

// ---------------------------------------------------------------------------

interface StoredDisclosure {
  rR: string;
  request: DisclosureRequest;
}

const DISCLOSURE_KEY = "gerald:gm:disclosure";

function TrialPanel() {
  const [stored, setStored] = useState<StoredDisclosure | null>(() => {
    try {
      const raw = localStorage.getItem(DISCLOSURE_KEY);
      return raw ? (JSON.parse(raw) as StoredDisclosure) : null;
    } catch {
      return null;
    }
  });
  const [bundleJson, setBundleJson] = useState("");
  const [busy, setBusy] = useState(false);
  const [verdict, setVerdict] = useState<
    | { ok: true; result: VerifiedDisclosure; shop: string; item: string | null }
    | { ok: false; message: string }
    | null
  >(null);

  const newRequest = () => {
    const keys = generateRecipientKeys();
    const request = newDisclosureRequest(keys);
    const next = { rR: toHex32(keys.rR), request };
    localStorage.setItem(DISCLOSURE_KEY, JSON.stringify(next));
    setStored(next);
    setVerdict(null);
  };

  const verify = async () => {
    if (!stored) return;
    setBusy(true);
    setVerdict(null);
    ensureBrowserBackend();
    const prover = proverFromArtifact(discloseSenderCircuit as never);
    try {
      const bundle = JSON.parse(bundleJson) as DisclosureBundle;
      const pinnedVk = Uint8Array.from(
        atob((discloseSenderVk as { vkBase64: string }).vkBase64),
        (c) => c.charCodeAt(0),
      );
      const result = await verifyDisclosure({
        client: chainClient(),
        bundle,
        request: stored.request,
        keys: recipientKeysFromSecret(fromHex(stored.rR)),
        prover,
        pinnedVk,
        indexer: indexerClient(),
      });
      const shop = SHOP_BY_ADDRESS.get(result.event.to);
      const item =
        shop && !shop.tithe
          ? (shop.items.find((it) => stroopsFromXlm(it.priceXlm) === result.amount)?.label ?? null)
          : null;
      setVerdict({ ok: true, result, shop: shop?.label ?? result.event.to, item });
    } catch (e) {
      setVerdict({ ok: false, message: msg(e) });
    } finally {
      setBusy(false);
      await prover.destroy();
    }
  };

  return (
    <div className="panel">
      <h2>Trial — verify a defense</h2>
      <p className="dim">
        1. Issue a request; send it to the accused. 2. Paste back their bundle. The proof is
        checked against the chain itself — a bundle that lies does not verify.
      </p>
      <div className="row">
        <button onClick={newRequest}>Issue new disclosure request</button>
        {stored && (
          <button
            onClick={() => void navigator.clipboard.writeText(JSON.stringify(stored.request))}
          >
            Copy request for the accused
          </button>
        )}
      </div>
      {stored && (
        <details>
          <summary>current request (nu {stored.request.nu.slice(0, 10)}…)</summary>
          <pre className="mono">{JSON.stringify(stored.request, null, 2)}</pre>
        </details>
      )}
      <textarea
        placeholder="paste the accused's disclosure bundle JSON…"
        value={bundleJson}
        onChange={(e) => setBundleJson(e.target.value)}
      />
      <div className="row">
        <button
          className="primary"
          onClick={() => void verify()}
          disabled={busy || !stored || bundleJson.trim() === ""}
        >
          {busy ? "Verifying against the chain…" : "Verify defense"}
        </button>
      </div>
      {verdict &&
        (verdict.ok ? (
          <div className="answer-card">
            VERIFIED: the accused sent <b>{xlmString(verdict.result.amount)} XLM</b> to{" "}
            <b>{verdict.shop}</b>
            {verdict.item ? (
              <>
                {" "}
                — that is the price of the <b>{verdict.item}</b>
              </>
            ) : (
              <> (no exact catalog match{verdict.shop === "Chapel" ? " — a tithe" : ""})</>
            )}
            . Sender: <span className="mono">{verdict.result.disclosingAccount.slice(0, 8)}…</span>
            <details>
              <summary>verifier steps</summary>
              <pre className="mono">{verdict.result.steps.join("\n")}</pre>
            </details>
          </div>
        ) : (
          <div className="error">NOT VERIFIED: {verdict.message}</div>
        ))}
    </div>
  );
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
