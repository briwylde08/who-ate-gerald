/**
 * The village catalog for the UI: shops, wares, prices, addresses. Same
 * committed JSON the auditor worker reads — the price IS the item.
 */
import catalogRaw from "../../../../config/catalog.json";
import shopsRaw from "../../../../config/shops.testnet.json";

export interface CatalogItem {
  id: string;
  label: string;
  priceXlm: number;
  effect: string;
}

export interface ShopInfo {
  id: string;
  label: string;
  address: string;
  tithe: boolean;
  items: CatalogItem[];
}

interface CatalogJson {
  startingBudgetXlm: number;
  shops: Record<string, { label: string; tithe?: boolean; items?: CatalogItem[] }>;
}

const catalog = catalogRaw as unknown as CatalogJson;
const shopAddresses = shopsRaw as Record<string, string>;

export const STARTING_BUDGET_XLM = catalog.startingBudgetXlm;

export const SHOPS: ShopInfo[] = Object.entries(catalog.shops).map(([id, s]) => ({
  id,
  label: s.label,
  address: shopAddresses[id] ?? "",
  tithe: s.tithe === true,
  items: s.items ?? [],
}));

export const CHAPEL = SHOPS.find((s) => s.tithe)!;
export const SHOP_BY_ADDRESS = new Map(SHOPS.map((s) => [s.address, s]));

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
