import type { Exchange } from "@/lib/types/opportunity";
import { toExchangeSymbol } from "@/lib/exchange-symbols";

/**
 * Estimates a daily traded volume for a (symbol, exchange) pair from the last
 * few completed hourly candles.
 *
 * Why klines and not the 24h ticker: no exchange exposes a bulk "volume over
 * the last 4 hours" endpoint — Binance/Bybit/Gate/Bitget tickers only carry a
 * rolling 24h turnover, which is too slow to show that a coin is hot right now.
 * So this walks hourly candles per symbol, which is why every upstream call is
 * cached (see KLINE_CACHE_SECONDS) and the pool below bounds concurrency.
 *
 * All field positions and units below were verified against live responses on
 * 2026-08-13; two exchanges do not report quote volume at all and have to be
 * reconstructed. Do not "simplify" these by assuming a shared shape.
 */

export interface VolumePair {
  exchange: Exchange;
  /** Canonical symbol (BTCUSDT); toExchangeSymbol() maps it per venue. */
  symbol: string;
}

export interface VolumeEntry {
  /** Summed quote volume of the completed hours that were available. */
  quoteVolumeWindow: number;
  /** How many completed hourly candles went into the sum (<= WINDOW_HOURS). */
  hoursUsed: number;
  /** quoteVolumeWindow scaled up to 24 hours. */
  estimatedDailyVolume: number;
}

/** Hours of completed candles to average over. */
const WINDOW_HOURS = 4;
/** Candles requested — one spare for the in-progress hour that gets dropped. */
const KLINE_LIMIT = WINDOW_HOURS + 2;
const KLINE_CACHE_SECONDS = 300;
const CONTRACT_META_CACHE_SECONDS = 3600;
const MAX_CONCURRENT = 12;

export function volumeKey(exchange: Exchange, symbol: string): string {
  return `${exchange}:${symbol}`;
}

/** An hourly candle reduced to just what this module needs. */
interface Candle {
  openTimeMs: number;
  quoteVolume: number;
}

async function getJson(url: string, revalidate = KLINE_CACHE_SECONDS): Promise<unknown> {
  const res = await fetch(url, { next: { revalidate } });
  if (!res.ok) return null;
  return res.json();
}

function num(value: unknown): number {
  const n = typeof value === "number" ? value : parseFloat(String(value));
  return Number.isFinite(n) ? n : 0;
}

// --- per-exchange candle parsers -----------------------------------------
// Ordering differs between exchanges (noted per parser) but the caller sorts
// by openTimeMs anyway, so parsers only need to map fields correctly.

// Binance: ascending. k[7] is quoteAssetVolume, already in USDT.
async function binanceCandles(native: string): Promise<Candle[]> {
  const data = await getJson(
    `https://fapi.binance.com/fapi/v1/klines?symbol=${encodeURIComponent(native)}&interval=1h&limit=${KLINE_LIMIT}`,
  );
  if (!Array.isArray(data)) return [];
  return (data as unknown[][]).map((k) => ({
    openTimeMs: num(k[0]),
    quoteVolume: num(k[7]),
  }));
}

// Bybit v5: newest first. list entry is [start, o, h, l, c, volume, turnover];
// turnover is the quote-currency figure.
async function bybitLikeCandles(baseUrl: string, native: string): Promise<Candle[]> {
  const data = (await getJson(
    `${baseUrl}?category=linear&symbol=${encodeURIComponent(native)}&interval=60&limit=${KLINE_LIMIT}`,
  )) as { result?: { list?: unknown[][] } } | null;
  const list = data?.result?.list;
  if (!Array.isArray(list)) return [];
  return list.map((k) => ({
    openTimeMs: num(k[0]),
    quoteVolume: num(k[6]),
  }));
}

// Gate: ascending, t is in seconds. `sum` is the settle-currency (USDT) volume;
// `v` is contract count and must not be used here.
async function gateCandles(native: string): Promise<Candle[]> {
  const data = await getJson(
    `https://api.gateio.ws/api/v4/futures/usdt/candlesticks?contract=${encodeURIComponent(native)}&interval=1h&limit=${KLINE_LIMIT}`,
  );
  if (!Array.isArray(data)) return [];
  return (data as { t?: number; sum?: string }[]).map((k) => ({
    openTimeMs: num(k.t) * 1000,
    quoteVolume: num(k.sum),
  }));
}

// Bitget: ascending. k[5] is base volume, k[6] is quote volume.
async function bitgetCandles(native: string): Promise<Candle[]> {
  const data = (await getJson(
    `https://api.bitget.com/api/v2/mix/market/candles?symbol=${encodeURIComponent(native)}&productType=USDT-FUTURES&granularity=1H&limit=${KLINE_LIMIT}`,
  )) as { data?: unknown[][] } | null;
  if (!Array.isArray(data?.data)) return [];
  return data.data.map((k) => ({
    openTimeMs: num(k[0]),
    quoteVolume: num(k[6]),
  }));
}

// BingX: newest first, and reports **base** volume only — there is no turnover
// field on this endpoint. Cross-checked against its own 24h ticker on
// 2026-08-13: volume 11748.75 BTC x price ~= quoteVolume 748.9M, so multiplying
// by the candle close is the right reconstruction.
async function bingxCandles(native: string): Promise<Candle[]> {
  const data = (await getJson(
    `https://open-api.bingx.com/openApi/swap/v3/quote/klines?symbol=${encodeURIComponent(native)}&interval=1h&limit=${KLINE_LIMIT}`,
  )) as { data?: { time?: number; close?: string; volume?: string }[] } | null;
  if (!Array.isArray(data?.data)) return [];
  return data.data.map((k) => ({
    openTimeMs: num(k.time),
    quoteVolume: num(k.volume) * num(k.close),
  }));
}

/**
 * BitMart reports candle volume in **contracts**, so it needs contract_size to
 * become USDT. Verified on 2026-08-13: volume_24h 56250230 x contract_size
 * 0.001 x price 63800 matches its reported turnover_24h 3587163632.
 */
async function bitmartContractSizes(): Promise<Map<string, number>> {
  const data = (await getJson(
    "https://api-cloud-v2.bitmart.com/contract/public/details",
    CONTRACT_META_CACHE_SECONDS,
  )) as { data?: { symbols?: { symbol?: string; contract_size?: string }[] } } | null;
  const map = new Map<string, number>();
  for (const s of data?.data?.symbols ?? []) {
    if (s.symbol) map.set(s.symbol, num(s.contract_size));
  }
  return map;
}

// BitMart: ascending, timestamp in seconds, and the window is passed as epoch
// seconds. The bounds are snapped to the hour so the URL — and therefore the
// cache entry — stays stable instead of changing every second.
async function bitmartCandles(native: string, contractSize: number): Promise<Candle[]> {
  if (contractSize <= 0) return [];
  const hourMs = 3600_000;
  const currentHourStartSec = Math.floor(Date.now() / hourMs) * 3600;
  const startSec = currentHourStartSec - KLINE_LIMIT * 3600;
  const data = (await getJson(
    `https://api-cloud-v2.bitmart.com/contract/public/kline?symbol=${encodeURIComponent(native)}&step=60&start_time=${startSec}&end_time=${currentHourStartSec}`,
  )) as { data?: { timestamp?: number; close_price?: string; volume?: string }[] } | null;
  if (!Array.isArray(data?.data)) return [];
  return data.data.map((k) => ({
    openTimeMs: num(k.timestamp) * 1000,
    quoteVolume: num(k.volume) * contractSize * num(k.close_price),
  }));
}

/**
 * Keeps only completed hours, then scales the average hourly volume to 24h.
 * The in-progress candle is dropped because including it drags the estimate
 * down by however far into the hour we happen to be.
 */
function summarize(candles: Candle[]): VolumeEntry | null {
  const hourMs = 3600_000;
  const currentHourStartMs = Math.floor(Date.now() / hourMs) * hourMs;
  const completed = candles
    .filter((c) => c.openTimeMs > 0 && c.openTimeMs < currentHourStartMs)
    .sort((a, b) => a.openTimeMs - b.openTimeMs)
    .slice(-WINDOW_HOURS);

  if (completed.length === 0) return null;

  const sum = completed.reduce((acc, c) => acc + c.quoteVolume, 0);
  return {
    quoteVolumeWindow: sum,
    hoursUsed: completed.length,
    estimatedDailyVolume: (sum / completed.length) * 24,
  };
}

async function candlesFor(
  pair: VolumePair,
  bitmartSizes: Map<string, number>,
): Promise<Candle[]> {
  const native = toExchangeSymbol(pair.symbol, pair.exchange);
  switch (pair.exchange) {
    case "Binance":
      return binanceCandles(native);
    case "Bybit":
      return bybitLikeCandles("https://api.bybit.com/v5/market/kline", native);
    case "Zoomex":
      return bybitLikeCandles("https://openapi.zoomex.com/cloud/trade/v3/market/kline", native);
    case "Gate":
      return gateCandles(native);
    case "Bitget":
      return bitgetCandles(native);
    case "BingX":
      return bingxCandles(native);
    case "BitMart":
      return bitmartCandles(native, bitmartSizes.get(native) ?? 0);
  }
}

/** Runs tasks with a bounded number in flight, preserving input order. */
async function pool<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index]);
    }
  });
  await Promise.all(runners);
  return results;
}

export async function fetchVolumes(
  pairs: VolumePair[],
): Promise<Record<string, VolumeEntry>> {
  if (pairs.length === 0) return {};

  // Only pay for the contract metadata call when a BitMart pair is present.
  const bitmartSizes = pairs.some((p) => p.exchange === "BitMart")
    ? await bitmartContractSizes()
    : new Map<string, number>();

  const entries = await pool(pairs, MAX_CONCURRENT, async (pair) => {
    try {
      const summary = summarize(await candlesFor(pair, bitmartSizes));
      return summary ? ([volumeKey(pair.exchange, pair.symbol), summary] as const) : null;
    } catch {
      // One bad symbol must not blank out the whole table.
      return null;
    }
  });

  const out: Record<string, VolumeEntry> = {};
  for (const entry of entries) {
    if (entry) out[entry[0]] = entry[1];
  }
  return out;
}
