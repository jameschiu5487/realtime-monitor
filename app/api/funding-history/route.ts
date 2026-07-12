import { NextRequest, NextResponse } from "next/server";
import type { Exchange } from "@/lib/types/opportunity";

export const runtime = "edge";
export const preferredRegion = ["sin1", "hkg1", "kix1"];

interface FundingRateEntry {
  timestamp: number; // ms
  rate: number;
  exchange: Exchange;
}

const FETCH_TIMEOUT_MS = 5000;

function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  return fetch(url, { signal: controller.signal, cache: "no-store" }).finally(() => clearTimeout(timer));
}

function formatExchangeSymbol(symbol: string, exchange: Exchange): string {
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

// startTime 分頁上限：10 頁已可涵蓋 Binance 10000 筆 / Bybit 2000 筆結算
const MAX_HISTORY_PAGES = 10;

async function fetchBinanceFundingHistory(symbol: string, startTime?: number): Promise<FundingRateEntry[]> {
  try {
    const mapEntries = (data: { fundingTime: number; fundingRate: string }[]) =>
      data.map((item) => ({
        timestamp: item.fundingTime,
        rate: parseFloat(item.fundingRate),
        exchange: "Binance" as Exchange,
      }));
    if (startTime === undefined) {
      const url = `https://fapi.binance.com/fapi/v1/fundingRate?symbol=${symbol.toUpperCase()}&limit=30`;
      const res = await fetchWithTimeout(url);
      if (!res.ok) { console.warn(`[funding-history] Binance ${symbol}: HTTP ${res.status}`); return []; }
      return mapEntries(await res.json());
    }
    // 帶 startTime：由舊往新分頁抓滿 [startTime, now]
    const entries: FundingRateEntry[] = [];
    let from = startTime;
    for (let page = 0; page < MAX_HISTORY_PAGES; page++) {
      const url = `https://fapi.binance.com/fapi/v1/fundingRate?symbol=${symbol.toUpperCase()}&startTime=${from}&limit=1000`;
      const res = await fetchWithTimeout(url);
      if (!res.ok) { console.warn(`[funding-history] Binance ${symbol}: HTTP ${res.status}`); break; }
      const data = await res.json();
      if (!Array.isArray(data) || data.length === 0) break;
      entries.push(...mapEntries(data));
      if (data.length < 1000) break;
      from = data[data.length - 1].fundingTime + 1;
    }
    return entries;
  } catch (e) {
    console.warn(`[funding-history] Binance ${symbol} error:`, e instanceof Error ? e.message : e);
    return [];
  }
}

async function fetchBybitFundingHistory(symbol: string, startTime?: number): Promise<FundingRateEntry[]> {
  try {
    const mapEntries = (list: { fundingRateTimestamp: string; fundingRate: string }[]) =>
      list.map((item) => ({
        timestamp: parseInt(item.fundingRateTimestamp),
        rate: parseFloat(item.fundingRate),
        exchange: "Bybit" as Exchange,
      }));
    if (startTime === undefined) {
      const url = `https://api.bybit.com/v5/market/funding/history?category=linear&symbol=${symbol.toUpperCase()}&limit=30`;
      const res = await fetchWithTimeout(url);
      if (!res.ok) { console.warn(`[funding-history] Bybit ${symbol}: HTTP ${res.status}`); return []; }
      const data = await res.json();
      if (data.retCode !== 0 || !data.result?.list?.length) return [];
      return mapEntries(data.result.list);
    }
    // 帶 startTime：Bybit 回傳由新到舊、單頁上限 200，往回分頁到 startTime
    const entries: FundingRateEntry[] = [];
    let end = Date.now();
    for (let page = 0; page < MAX_HISTORY_PAGES; page++) {
      const url = `https://api.bybit.com/v5/market/funding/history?category=linear&symbol=${symbol.toUpperCase()}&limit=200&startTime=${startTime}&endTime=${end}`;
      const res = await fetchWithTimeout(url);
      if (!res.ok) { console.warn(`[funding-history] Bybit ${symbol}: HTTP ${res.status}`); break; }
      const data = await res.json();
      if (data.retCode !== 0 || !data.result?.list?.length) break;
      const batch = mapEntries(data.result.list);
      entries.push(...batch);
      const oldest = Math.min(...batch.map((e) => e.timestamp));
      if (batch.length < 200 || oldest <= startTime) break;
      end = oldest - 1;
    }
    return entries.sort((a, b) => a.timestamp - b.timestamp);
  } catch (e) {
    console.warn(`[funding-history] Bybit ${symbol} error:`, e instanceof Error ? e.message : e);
    return [];
  }
}

async function fetchGateFundingHistory(symbol: string): Promise<FundingRateEntry[]> {
  try {
    const fmtSymbol = formatExchangeSymbol(symbol, "Gate");
    const url = `https://api.gateio.ws/api/v4/futures/usdt/funding_rate?contract=${encodeURIComponent(fmtSymbol)}&limit=30`;
    const res = await fetchWithTimeout(url);
    if (!res.ok) { console.warn(`[funding-history] Gate ${symbol}: HTTP ${res.status}`); return []; }
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    return data.map((item: { t: number; r: string }) => ({
      timestamp: item.t * 1000,
      rate: parseFloat(item.r),
      exchange: "Gate" as Exchange,
    }));
  } catch (e) {
    console.warn(`[funding-history] Gate ${symbol} error:`, e instanceof Error ? e.message : e);
    return [];
  }
}

async function fetchBitgetFundingHistory(symbol: string): Promise<FundingRateEntry[]> {
  try {
    const url = `https://api.bitget.com/api/v2/mix/market/history-fund-rate?symbol=${symbol.toUpperCase()}&productType=USDT-FUTURES&pageSize=30`;
    const res = await fetchWithTimeout(url);
    if (!res.ok) { console.warn(`[funding-history] Bitget ${symbol}: HTTP ${res.status}`); return []; }
    const data = await res.json();
    if (data.code !== "00000" || !data.data?.length) return [];
    return data.data.map((item: { fundingTime: string; fundingRate: string }) => ({
      timestamp: parseInt(item.fundingTime),
      rate: parseFloat(item.fundingRate),
      exchange: "Bitget" as Exchange,
    }));
  } catch (e) {
    console.warn(`[funding-history] Bitget ${symbol} error:`, e instanceof Error ? e.message : e);
    return [];
  }
}

async function fetchBingXFundingHistory(symbol: string): Promise<FundingRateEntry[]> {
  try {
    const fmtSymbol = formatExchangeSymbol(symbol, "BingX");
    const url = `https://open-api.bingx.com/openApi/swap/v2/quote/fundingRate?symbol=${encodeURIComponent(fmtSymbol)}`;
    const res = await fetchWithTimeout(url);
    if (!res.ok) { console.warn(`[funding-history] BingX ${symbol}: HTTP ${res.status}`); return []; }
    const data = await res.json();
    if (data.code !== 0 || !data.data?.length) return [];
    return data.data.map((item: { fundingTime: number; fundingRate: string }) => ({
      timestamp: item.fundingTime,
      rate: parseFloat(item.fundingRate),
      exchange: "BingX" as Exchange,
    }));
  } catch (e) {
    console.warn(`[funding-history] BingX ${symbol} error:`, e instanceof Error ? e.message : e);
    return [];
  }
}

async function fetchBitMartFundingHistory(_symbol: string): Promise<FundingRateEntry[]> {
  // BitMart doesn't have a public historical funding rate endpoint
  return [];
}

function getFundingHistoryFetcher(
  exchange: Exchange
): (symbol: string, startTime?: number) => Promise<FundingRateEntry[]> {
  switch (exchange) {
    case "Binance": return fetchBinanceFundingHistory;
    case "Bybit": return fetchBybitFundingHistory;
    case "Gate": return fetchGateFundingHistory;
    case "Bitget": return fetchBitgetFundingHistory;
    case "BingX": return fetchBingXFundingHistory;
    case "BitMart": return fetchBitMartFundingHistory;
    case "Zoomex": return async () => [];
  }
}

const VALID_EXCHANGES: Exchange[] = ["Binance", "Bybit", "BingX", "Gate", "Bitget", "BitMart", "Zoomex"];

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const exchangeA = searchParams.get("exchangeA") as Exchange | null;
  const exchangeB = searchParams.get("exchangeB") as Exchange | null;
  const symbol = searchParams.get("symbol");
  // 可選 startTime(ms)：帶了就分頁抓滿 [startTime, now]（僅 Binance/Bybit 支援，其他交易所忽略）
  const startTimeParam = parseInt(searchParams.get("startTime") ?? "", 10);
  const startTime = Number.isFinite(startTimeParam) && startTimeParam > 0 ? startTimeParam : undefined;

  if (!exchangeA || !exchangeB || !symbol || !VALID_EXCHANGES.includes(exchangeA) || !VALID_EXCHANGES.includes(exchangeB)) {
    return NextResponse.json({ error: "Missing or invalid parameters" }, { status: 400 });
  }

  try {
    const errors: string[] = [];
    const origWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      errors.push(args.map(a => String(a)).join(" "));
      origWarn.apply(console, args);
    };

    const [historyA, historyB] = await Promise.all([
      getFundingHistoryFetcher(exchangeA)(symbol, startTime),
      getFundingHistoryFetcher(exchangeB)(symbol, startTime),
    ]);

    console.warn = origWarn;
    return NextResponse.json({ exchangeA: historyA, exchangeB: historyB, _debug: errors });
  } catch (e) {
    console.error(`[funding-history] error:`, e);
    return NextResponse.json({ exchangeA: [], exchangeB: [], _debug: [String(e)] });
  }
}
