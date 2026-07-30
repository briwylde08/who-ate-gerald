/**
 * The village catalog for the UI: shops, wares, prices, addresses. Same
 * committed JSON the auditor worker reads — the price IS the item.
 */
import catalogRaw from "../../../../config/catalog.json";
import shopsRaw from "../../../../config/shops.testnet.json";

export interface CatalogItem {
  id: string;
  label: string;
  /** One-line flavour for the shop shelf — never mechanical. */
  flavor?: string;
  priceXlm: number;
  /** V/W/B (villager/werebear/both) × off/def, or "cover". Public knowledge. */
  class?: string;
  effect: string;
}

export interface ShopInfo {
  id: string;
  label: string;
  /** Shopfront emoji + merchant's boast, for the shop header. */
  icon?: string;
  subtitle?: string;
  address: string;
  tithe: boolean;
  items: CatalogItem[];
}

interface CatalogJson {
  startingBudgetXlm: number;
  shops: Record<
    string,
    { label: string; icon?: string; subtitle?: string; tithe?: boolean; items?: CatalogItem[] }
  >;
}

const catalog = catalogRaw as unknown as CatalogJson;
const shopAddresses = shopsRaw as Record<string, string>;

export const STARTING_BUDGET_XLM = catalog.startingBudgetXlm;
export const DAILY_INCOME_XLM = (catalogRaw as { dailyIncomeXlm?: number }).dailyIncomeXlm ?? 0;

export const SHOPS: ShopInfo[] = Object.entries(catalog.shops).map(([id, s]) => ({
  id,
  label: s.label,
  icon: s.icon,
  subtitle: s.subtitle,
  address: shopAddresses[id] ?? "",
  tithe: s.tithe === true,
  items: s.items ?? [],
}));

export const SHOP_BY_ADDRESS = new Map(SHOPS.map((s) => [s.address, s]));

/** Maude's office — where old-wallet excess is surrendered before shopping. */
export const ORDER_ADDRESS: string = shopAddresses.maudes_office ?? "";

export const STROOPS_PER_XLM = 10_000_000n;

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

/**
 * Display-only formatting: grouped thousands, at most `maxDecimals` places,
 * truncated (never rounded up — a purse should not read richer than it is).
 * The underlying stroop value keeps full precision.
 */
export function xlmDisplay(stroops: bigint, maxDecimals = 2): string {
  const neg = stroops < 0n;
  const abs = neg ? -stroops : stroops;
  const grouped = (abs / STROOPS_PER_XLM).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = (abs % STROOPS_PER_XLM)
    .toString()
    .padStart(7, "0")
    .slice(0, maxDecimals)
    .replace(/0+$/, "");
  return `${neg ? "-" : ""}${grouped}${frac ? "." + frac : ""}`;
}
