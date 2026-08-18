import { useState } from "react";

import { SHOPS } from "../lib/catalog";
import type { ServerPurchases } from "../lib/player";
import { loadGameId } from "../lib/player";

/**
 * The satchel (Bri's ask, 2026-08-17): a backpack under the banner that
 * answers "what am I holding?" without a trip through the Shops.
 *
 * Three shelves, honestly sorted:
 *  - HELD: until-spent items with charges remaining (nail, pizza, unquiet
 *    rest) — the server says what's already fired, so a spent nail never
 *    shows as luck you still have.
 *  - TODAY: everything bought this round (expires at dawn), with aims.
 *  - The fingers get their own line. Devotion deserves a count.
 */

interface Props {
  serverSpend: ServerPurchases | null;
  round: number;
  alive: boolean;
  /** Re-pull serverSpend when a panel opens, so the counts are fresh. */
  refresh?: () => void;
}

const LABEL_TO_ID = new Map(SHOPS.flatMap((sh) => sh.items).map((it) => [it.label, it.id]));

export function Satchel({ serverSpend, round, alive, refresh }: Props) {
  const [open, setOpen] = useState(false);

  const purchases = serverSpend?.purchases ?? [];
  const countEver = (id: string) =>
    purchases.filter((p) => p.item !== null && LABEL_TO_ID.get(p.item) === id).length;

  const nailsHeld = Math.max(0, countEver("horseshoe_nail") - (serverSpend?.spent?.horseshoe_nail ?? 0));
  const pizzasHeld = Math.max(0, countEver("pizza_party") - (serverSpend?.spent?.pizza_party ?? 0));
  const restArmed = alive && !serverSpend?.ghostVoteDecided && countEver("unquiet_rest") > 0;

  const todays = purchases.filter((p) => p.round === round && p.item !== null);
  const aims: Record<string, string> = (() => {
    try {
      return JSON.parse(localStorage.getItem(`gerald:aims:${loadGameId()}:${round}`) ?? "{}");
    } catch {
      return {};
    }
  })();

  const held: string[] = [];
  if (nailsHeld > 0) held.push(`🍀 Horseshoe nail ×${nailsHeld} — steps you out of a tie`);
  if (pizzasHeld > 0) held.push(`🍕 Pizza party ×${pizzasHeld} — saves you from a banishment`);
  if (restArmed) held.push("👻 Unquiet rest — armed until you die");

  // The server replays the ladder and credits only legal relics; raw local
  // counts are the fallback for a stale serverSpend.
  const fingers = serverSpend?.relics?.fingers ?? countEver("geralds_finger");
  const thumbs = serverSpend?.relics?.thumbs ?? countEver("geralds_thumb");
  const toes = serverSpend?.relics?.toes ?? countEver("geralds_toe");
  const relicTotal = fingers + thumbs + toes;
  const [relicsOpen, setRelicsOpen] = useState(false);

  return (
    <div className="satchel-wrap">
      <button
        className="satchel-btn"
        aria-expanded={open}
        title="Satchel"
        onClick={() => {
          setOpen((o) => {
            if (!o) refresh?.();
            return !o;
          });
        }}
      >
        <img className="satchel-icon" src="/characters/satchel.png" alt="Satchel" />
      </button>
      {/* The reliquary: a second, holier bag. Gerald only. */}
      <button
        className="satchel-btn relic-btn"
        aria-expanded={relicsOpen}
        title="Gerald's extremities"
        onClick={() => {
          setRelicsOpen((o) => {
            if (!o) refresh?.();
            return !o;
          });
        }}
      >
        <img className="satchel-icon" src="/characters/geralds-hand.png" alt="Gerald's extremities" />
      </button>
      {relicsOpen && (
        <div className="panel satchel-panel relic-panel">
          <button className="panel-x" aria-label="Close" onClick={() => setRelicsOpen(false)}>
            ✕
          </button>
          <div className="role-label">Gerald's reliquary</div>
          {relicTotal === 0 ? (
            <p className="dim">You hold no piece of Gerald.</p>
          ) : (
            <>
              {fingers > 0 && <p className="satchel-line">☝️ Finger ×{fingers}</p>}
              {thumbs > 0 && <p className="satchel-line">👍 Thumb ×{thumbs}</p>}
              {toes > 0 && <p className="satchel-line">🦶 Toe ×{toes}</p>}
              <p className="dim satchel-note">
                {relicTotal >= 20
                  ? "All twenty. You are Gerald now."
                  : `${relicTotal} of Gerald's twenty extremities. He appreciates your devotion.`}
              </p>
            </>
          )}
        </div>
      )}
      {open && (
        <div className="panel satchel-panel">
          <button className="panel-x" aria-label="Close" onClick={() => setOpen(false)}>
            ✕
          </button>
          <div className="role-label">Your satchel</div>
          {held.length === 0 && todays.length === 0 && fingers === 0 && (
            <p className="dim">Empty. The shops await.</p>
          )}
          {held.length > 0 && (
            <>
              <p className="satchel-head">Held (until used)</p>
              {held.map((h, i) => (
                <p key={i} className="satchel-line">{h}</p>
              ))}
            </>
          )}
          {todays.length > 0 && (
            <>
              <p className="satchel-head">Bought today (gone at dawn)</p>
              {todays.map((p, i) => {
                const id = p.item ? LABEL_TO_ID.get(p.item) : undefined;
                const aimedAt = id ? aims[id] : undefined;
                return (
                  <p key={i} className="satchel-line">
                    {p.item}
                    {aimedAt ? <span className="dim"> — 🎯 {aimedAt}</span> : null}
                  </p>
                );
              })}
            </>
          )}
          <p className="dim satchel-note">Only you can see this.</p>
        </div>
      )}
    </div>
  );
}
