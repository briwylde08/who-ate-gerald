import type { Character } from "../lib/profile";

/** A character's emoji — or its image icon where one exists (the Baker's loaf). */
export function CharEmoji({ c }: { c: Character | null | undefined }) {
  if (c?.icon) return <img className="char-icon" src={c.icon} alt={c.emoji} />;
  return <>{c?.emoji ?? "🧑‍🌾"}</>;
}

/** The village tote — replaces the 🛍 emoji wherever shopping is meant. */
export function ToteIcon() {
  return <img className="char-icon" src="/characters/tote-icon.png" alt="" />;
}

/** The werebear — replaces the 🐻 emoji wherever the beast is meant. */
export function BearIcon() {
  return <img className="char-icon" src="/characters/bear-icon.png" alt="werebear" />;
}
