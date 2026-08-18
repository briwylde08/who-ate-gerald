import { useEffect, useState } from "react";

import type { VillagerWallet } from "../lib/wallet";
import { hasCachedAuth, pageHidden, playerApi } from "../lib/player";

/**
 * Whispers, promoted to the top bar (Bri, 2026-08-18): a chat bubble you can
 * open at ANY time — not just from the square. Completely secret: no public
 * trace that a whisper even happened; only sender and recipient ever see it.
 */

interface Props {
  wallet: VillagerWallet;
  gameId: string;
  players: { name: string; address: string; alive: boolean }[];
  open: boolean;
  onClose: () => void;
}

export function Whispers({ wallet, gameId, players, open, onClose }: Props) {
  const [dms, setDms] = useState<
    { round: number; from: string; to: string; text: string; at: string }[]
  >([]);
  const [dmTo, setDmTo] = useState("");
  const [dmText, setDmText] = useState("");
  const me = players.find((p) => p.address === wallet.address);

  useEffect(() => {
    if (!open || !hasCachedAuth(wallet, gameId)) return;
    const pull = () =>
      void playerApi.myDms(wallet, gameId).then((r) => setDms(r.dms)).catch(() => undefined);
    pull();
    const t = setInterval(() => {
      if (!pageHidden()) pull();
    }, 5_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, gameId]);

  const sendDm = async () => {
    const text = dmText.trim();
    if (!text || !dmTo) return;
    setDmText("");
    try {
      await playerApi.sendDm(wallet, gameId, dmTo, text);
      const r = await playerApi.myDms(wallet, gameId);
      setDms(r.dms);
    } catch {
      /* the thread simply doesn't grow — the input keeps their words */
    }
  };

  if (!open) return null;
  return (
    <div className="panel whisper-pop" role="dialog" aria-label="Whispers">
      <button className="panel-x" aria-label="Close whispers" onClick={onClose}>
        ✕
      </button>
      <div className="role-label">🤫 Whispers — completely private</div>
      <div className="dm-thread">
        {dms.length === 0 ? (
          <p className="dim">No whispers yet. What happens here, stays here.</p>
        ) : (
          dms.slice(-40).map((d, i) => (
            <p key={i} className="chat-line dm-line">
              <b>{me && d.from === me.name ? `→ ${d.to}` : `${d.from} →`}:</b> {d.text}
            </p>
          ))
        )}
      </div>
      <div className="row">
        <select value={dmTo} onChange={(e) => setDmTo(e.target.value)}>
          <option value="">whisper to whom?</option>
          {players
            .filter((p) => p.address !== wallet.address)
            .map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
                {p.alive ? "" : " 🪦"}
              </option>
            ))}
        </select>
        <input
          type="text"
          maxLength={280}
          placeholder="I KNOW YOU'RE THE WEREBEAR! Let's work together."
          value={dmText}
          onChange={(e) => setDmText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && dmText.trim() && dmTo) void sendDm();
          }}
        />
        <button disabled={!dmText.trim() || !dmTo} onClick={() => void sendDm()}>
          Whisper
        </button>
      </div>
      <p className="dim satchel-note">No public trace. Only the two of you ever see this.</p>
    </div>
  );
}
