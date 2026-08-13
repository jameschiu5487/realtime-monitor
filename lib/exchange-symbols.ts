import type { Exchange } from "@/lib/types/opportunity";

/**
 * Converts a canonical symbol (BTCUSDT) into the string a given exchange's REST
 * API expects. funding-fetcher's normalizeSymbol() strips separators to merge
 * venues onto one row, so anything calling an exchange back has to undo that.
 *
 * Shared by /api/klines (price series for the spread modal) and the volume
 * fetcher — keep it in one place so the two can't drift apart.
 */
export function toExchangeSymbol(symbol: string, exchange: Exchange): string {
  const base = symbol.replace(/USDT$/i, "");
  switch (exchange) {
    case "BingX":
      return `${base}-USDT`;
    case "Gate":
      return `${base}_USDT`;
    default:
      return symbol.toUpperCase();
  }
}
