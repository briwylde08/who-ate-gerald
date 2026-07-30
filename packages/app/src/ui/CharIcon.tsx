import type { Character } from "../lib/profile";

/** A character's emoji — or its image icon where one exists (the Baker's loaf). */
export function CharEmoji({ c }: { c: Character | null | undefined }) {
  if (c?.icon) return <img className="char-icon" src={c.icon} alt={c.emoji} />;
  return <>{c?.emoji ?? "🧑‍🌾"}</>;
}
