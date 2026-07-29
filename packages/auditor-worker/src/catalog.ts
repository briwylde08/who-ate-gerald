/**
 * Typed access to the committed game config: shop catalog (config/catalog.json),
 * shop addresses (config/shops.testnet.json), and the deployment record.
 * All three are public, committed JSON — wrangler bundles them at deploy time.
 *
 * The catalog encodes the core mechanic: within a shop, the payment amount IS
 * the item. `itemByExactPrice` is therefore the only "shop fulfillment" logic
 * the game needs.
 */
import catalogRaw from "../../../config/catalog.json";
import shopsRaw from "../../../config/shops.testnet.json";
import deploymentRaw from "../../../config/deployment.testnet.json";

export interface CatalogItem {
  id: string;
  label: string;
  priceXlm: number;
  /** V/W/B (villager/werebear/both) × off/def, or "cover". Public knowledge. */
  class?: string;
  effect: string;
}

export interface ShopInfo {
  id: string;
  label: string;
  address: string;
  /** Chapel-only: accepts any amount (the tithe) instead of priced items. */
  tithe: boolean;
  items: CatalogItem[];
}

interface CatalogJson {
  startingBudgetXlm: number;
  shops: Record<string, { label: string; tithe?: boolean; items?: CatalogItem[] }>;
}

const catalog = catalogRaw as unknown as CatalogJson;
const shopAddresses = shopsRaw as Record<string, string>;

export const DEPLOYED_AT_LEDGER: number = (deploymentRaw as { deployedAtLedger: number })
  .deployedAtLedger;
export const STARTING_BUDGET_XLM = catalog.startingBudgetXlm;
export const DAILY_INCOME_XLM =
  (catalogRaw as unknown as { dailyIncomeXlm?: number }).dailyIncomeXlm ?? 0;
export const CHAPEL_ID = "chapel";

export const SHOPS: ShopInfo[] = Object.entries(catalog.shops).map(([id, s]) => ({
  id,
  label: s.label,
  address: shopAddresses[id] ?? "",
  tithe: s.tithe === true,
  items: s.items ?? [],
}));

export const SHOP_BY_ID = new Map(SHOPS.map((s) => [s.id, s]));
export const SHOP_BY_ADDRESS = new Map(SHOPS.map((s) => [s.address, s]));

/** Maude's office — where old-wallet excess is surrendered before shopping. */
export const ORDER_ADDRESS: string = shopAddresses.maudes_office ?? "";

export const STROOPS_PER_XLM = 10_000_000n;

/** Render a stroop amount as a decimal XLM string ("7", "12.5", "0.0000001"). */
export function xlmString(stroops: bigint): string {
  const neg = stroops < 0n;
  const abs = neg ? -stroops : stroops;
  const whole = abs / STROOPS_PER_XLM;
  const frac = (abs % STROOPS_PER_XLM).toString().padStart(7, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? "." + frac : ""}`;
}

export function stroopsFromXlm(xlm: number): bigint {
  return BigInt(Math.round(xlm * 1e7));
}

/** Exact price match within one shop — the payment amount selects the item. */
export function itemByExactPrice(shop: ShopInfo, stroops: bigint): CatalogItem | null {
  return shop.items.find((it) => stroopsFromXlm(it.priceXlm) === stroops) ?? null;
}

/**
 * Find an item anywhere in the catalog by id or (case-insensitive) label.
 * Returns the item together with its shop, or null.
 */
export function findItem(query: string): { shop: ShopInfo; item: CatalogItem } | null {
  const q = query.trim().toLowerCase().replace(/\s+/g, "_");
  const qLabel = query.trim().toLowerCase();
  for (const shop of SHOPS) {
    for (const item of shop.items) {
      if (item.id === q || item.label.toLowerCase() === qLabel) return { shop, item };
    }
  }
  // Loose fallback: substring match on the label ("silver" → silver charm).
  for (const shop of SHOPS) {
    for (const item of shop.items) {
      if (item.label.toLowerCase().includes(qLabel) && qLabel.length >= 4) return { shop, item };
    }
  }
  return null;
}

/** Compact catalog text for the fact-selection prompt. */
export function catalogSummary(): string {
  return SHOPS.map((s) => {
    const items = s.items.map((it) => `${it.label} ${it.priceXlm} XLM`).join(", ");
    return `- ${s.label} (${s.id}): ${items}.`;
  }).join("\n");
}
