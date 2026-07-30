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
  /** Optional small icon that replaces the emoji wherever it appears. */
  icon?: string;
}

export const CHARACTERS: Character[] = [
  { id: "baker", emoji: "🍞", title: "the Baker", blurb: "Everyone loves his buns. Gerald did too.", image: "/characters/baker.jpg", icon: "/characters/baker-icon.png" },
  { id: "midwife", emoji: "🕯️", title: "the Midwife", blurb: "Delivered half the village. Regrets several of them.", image: "/characters/midwife.jpg", icon: "/characters/midwife-icon.png" },
  { id: "gravedigger", emoji: "🪦", title: "the Grave Digger", blurb: "Business is, regrettably, booming.", image: "/characters/gravedigger.jpg", icon: "/characters/gravedigger-icon.png" },
  { id: "drunk", emoji: "🍺", title: "the Drunk", blurb: "Remembers the murder. Misplaced his trousers.", image: "/characters/drunk.jpg", icon: "/characters/drunk-icon.png" },
  { id: "poacher", emoji: "🏹", title: "the Poacher", blurb: "Out in the woods that night. For reasons.", image: "/characters/poacher.jpg", icon: "/characters/poacher-icon.png" },
  { id: "beekeeper", emoji: "🐝", title: "the Beekeeper", blurb: "Talks to the bees. They have concerns about you.", image: "/characters/beekeeper.jpg", icon: "/characters/beekeeper-icon.png" },
  { id: "ratcatcher", emoji: "🐀", title: "the Rat Catcher", blurb: "Keeps the vermin under control. The rats, too.", image: "/characters/ratcatcher.jpg", icon: "/characters/ratcatcher-icon.png" },
  { id: "lamplighter", emoji: "🔦", title: "the Lamplighter", blurb: "Lit Gerald's last lantern. Hasn't slept since.", image: "/characters/lamplighter.jpg", icon: "/characters/lamplighter-icon.png" },
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
