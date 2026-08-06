/**
 * The shelf's own exam — offline, no chain, no worker, no secrets, seconds.
 *
 * Catches what item-test.ts structurally cannot: an item the RULES still act
 * on that the SHELF no longer sells. countBought() looks the id up in the
 * catalog and returns 0 on a miss, so a retired item never throws — its whole
 * effect just stops happening, silently, forever. lantern_oil did exactly
 * this for three catalog revisions, and neither tsc (the ids are strings) nor
 * the item exam (it only tests what is still on the shelf) saw it.
 *
 * game.ts imports `cloudflare:workers` and cannot be imported here, so the
 * item ids are read out of its source text. Crude, and it works.
 *
 * Usage: npm run test:catalog
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(join(repoRoot, p), "utf8");

interface Ware {
  id: string;
  label: string;
  priceXlm: number;
  aim?: string;
}
const catalog = JSON.parse(read("config/catalog.json")) as {
  startingBudgetXlm: number;
  shops: Record<string, { items?: Ware[] }>;
};
const shopAddresses = JSON.parse(read("config/shops.testnet.json")) as Record<string, string>;
const gameSrc = read("packages/auditor-worker/src/game.ts");

const wares = Object.values(catalog.shops).flatMap((s) => s.items ?? []);

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  console.log(`  ${ok ? "✓" : "✗"} ${name}${ok ? "" : ` — ${JSON.stringify(detail)}`}`);
  if (!ok) failures++;
}

console.log("\nThe shelf's exam\n");

// 1. Design law 5. The amount IS the item, so no two wares may share a price.
const byPrice = new Map<number, string[]>();
for (const w of wares) byPrice.set(w.priceXlm, [...(byPrice.get(w.priceXlm) ?? []), w.id]);
const collisions = [...byPrice].filter(([, ids]) => ids.length > 1);
check("prices are globally unique", collisions.length === 0, collisions);

// 2. Every item the rules act on is still on the shelf. (A retired id is not
//    an error to countBought — it is a permanent, silent "never bought".)
const onShelf = new Set(wares.map((w) => w.id));
const acted = new Set(
  [
    ...gameSrc.matchAll(
      /(?:bought|countBought|boughtThisRound|boughtEver|aimedToday)\([^)]*?"([a-z_]+)"/g,
    ),
  ].map((m) => m[1]!),
);
const retired = [...acted].filter((id) => !onShelf.has(id));
check("every item game.ts acts on is still sold", retired.length === 0, retired);

// 3. Every shop has somewhere for the coin to land — a missing address makes
//    SHOP_BY_ADDRESS miss and every purchase there invisible to Maude.
const shopless = Object.keys(catalog.shops).filter((id) => !shopAddresses[id]);
check("every shop in the catalog has an address", shopless.length === 0, shopless);

// 4. An aimed item asks the player to point it somewhere; the resolver had
//    better read that id, or the aim goes nowhere.
const unread = wares.filter((w) => w.aim && !gameSrc.includes(`"${w.id}"`)).map((w) => w.id);
check("every aimed item is named in game.ts", unread.length === 0, unread);

// 5. The shelf must fit the purse on day one.
const budget = catalog.startingBudgetXlm;
const dear = wares.filter((w) => w.priceXlm > budget).map((w) => w.id);
check(`nothing costs more than the ${budget} XLM buy-in`, dear.length === 0, dear);

console.log(
  failures === 0 ? `\n✅ SHELF CLEAN (${wares.length} wares)` : `\n❌ ${failures} failure(s)`,
);
if (failures > 0) process.exit(1);
