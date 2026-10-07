import type { Exchange } from "@/lib/types/opportunity";

/**
 * Chart colours per exchange.
 *
 * Shared so a given venue keeps the same colour wherever it is plotted. Keys
 * use the canonical casing of the Exchange type, but lookups go through
 * exchangeColor() because some tables store the venue lower-cased — trades.exchange
 * holds "zoomex", not "Zoomex".
 */
export const EXCHANGE_COLORS: Record<Exchange, string> = {
  Binance: "#eab308",
  Bybit: "#06b6d4",
  BingX: "#22c55e",
  Gate: "#3b82f6",
  Bitget: "#a855f7",
  Zoomex: "#f97316",
  BitMart: "#ec4899",
};

/**
 * Venues the strategies trade on that aren't part of the opportunity Exchange
 * type (lower-cased key → display name and colour).
 */
const EXTRA_VENUES = new Map<string, { label: string; color: string }>([
  ["dexless", { label: "DEXLESS", color: "#8b5cf6" }],
]);

/** Used when a venue has no assigned colour, so an unknown name still plots. */
const FALLBACK_COLORS = ["#64748b", "#0ea5e9", "#d946ef", "#14b8a6", "#f43f5e"];

const BY_LOWER = new Map(
  Object.entries(EXCHANGE_COLORS).map(([name, color]) => [name.toLowerCase(), color]),
);

/**
 * Colour for an exchange name in any casing. Unknown names get a stable colour
 * derived from the name, so the same venue keeps the same one between renders.
 */
export function exchangeColor(exchange: string): string {
  const known = BY_LOWER.get(exchange.toLowerCase()) ?? EXTRA_VENUES.get(exchange.toLowerCase())?.color;
  if (known) return known;
  let hash = 0;
  for (let i = 0; i < exchange.length; i++) hash = (hash * 31 + exchange.charCodeAt(i)) | 0;
  return FALLBACK_COLORS[Math.abs(hash) % FALLBACK_COLORS.length];
}

/** Title-cases a stored venue name for display: "zoomex" -> "Zoomex". */
export function exchangeLabel(exchange: string): string {
  const extra = EXTRA_VENUES.get(exchange.toLowerCase());
  if (extra) return extra.label;
  for (const name of Object.keys(EXCHANGE_COLORS)) {
    if (name.toLowerCase() === exchange.toLowerCase()) return name;
  }
  return exchange.charAt(0).toUpperCase() + exchange.slice(1);
}
