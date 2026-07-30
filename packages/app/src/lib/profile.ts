/**
 * The player's local identity: a name and a (purely cosmetic) village
 * character. Roles — werebear or villager — are dealt by the game, never here.
 * One profile per browser per game token; the GM's roster is still the
 * canonical seat list.
 */
import { DEPLOYMENT } from "./deployment";

export interface Character {
  id: string;
  emoji: string;
  title: string;
  blurb: string;
  /** Portrait under public/characters/ — 512px web copies; originals in design/. */
  image: string;
}

export const CHARACTERS: Character[] = [
  { id: "baker", emoji: "🍞", title: "the Baker", blurb: "Up before dawn. Saw nothing. Ever.", image: "/characters/baker.jpg" },
  { id: "midwife", emoji: "🕯️", title: "the Midwife", blurb: "Knows everyone's secrets. Keeps most.", image: "/characters/midwife.jpg" },
  { id: "gravedigger", emoji: "🪦", title: "the Grave Digger", blurb: "Business is, regrettably, booming.", image: "/characters/gravedigger.jpg" },
  { id: "drunk", emoji: "🍺", title: "the Drunk", blurb: "Remembers everything. Believed about nothing.", image: "/characters/drunk.jpg" },
  { id: "poacher", emoji: "🏹", title: "the Poacher", blurb: "Out in the woods that night. For reasons.", image: "/characters/poacher.jpg" },
  { id: "beekeeper", emoji: "🐝", title: "the Beekeeper", blurb: "Talks to the hives. They talk back.", image: "/characters/beekeeper.jpg" },
  { id: "ratcatcher", emoji: "🐀", title: "the Rat Catcher", blurb: "Knows every cellar in the village.", image: "/characters/ratcatcher.jpg" },
  { id: "lamplighter", emoji: "🔦", title: "the Lamplighter", blurb: "Lit Gerald's last lantern. Hasn't slept since.", image: "/characters/lamplighter.jpg" },
];

export interface Profile {
  name: string;
  characterId: string;
}

const KEY = `gerald:profile:${DEPLOYMENT.token}`;

export function loadProfile(): Profile | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Profile;
    return p.name && p.characterId ? p : null;
  } catch {
    return null;
  }
}

export function saveProfile(p: Profile): void {
  localStorage.setItem(KEY, JSON.stringify(p));
}

export function clearProfile(): void {
  localStorage.removeItem(KEY);
}

export function characterOf(p: Profile | null): Character | null {
  return CHARACTERS.find((c) => c.id === p?.characterId) ?? null;
}
