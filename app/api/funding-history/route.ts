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

async function fetchBinanceFundingHistory(symbol: string): Promise<FundingRateEntry[]> {
  try {
    const url = `https://fapi.binance.com/fapi/v1/fundingRate?symbol=${symbol.toUpperCase()}&limit=30`;
    const res = await fetchWithTimeout(url);
    if (!res.ok) { console.warn(`[funding-history] Binance ${symbol}: HTTP ${res.status}`); return []; }
    const data = await res.json();
    return data.map((item: { fundingTime: number; fundingRate: string }) => ({
      timestamp: item.fundingTime,
      rate: parseFloat(item.fundingRate),
      exchange: "Binance" as Exchange,
    }));
  } catch (e) {
    console.warn(`[funding-history] Binance ${symbol} error:`, e instanceof Error ? e.message : e);
    return [];
  }
}

async function fetchBybitFundingHistory(symbol: string): Promise<FundingRateEntry[]> {
  try {
    const url = `https://api.bybit.com/v5/market/funding/history?category=linear&symbol=${symbol.toUpperCase()}&limit=30`;
    const res = await fetchWithTimeout(url);
    if (!res.ok) { console.warn(`[funding-history] Bybit ${symbol}: HTTP ${res.status}`); return []; }
    const data = await res.json();
    if (data.retCode !== 0 || !data.result?.list?.length) return [];
    return data.result.list.map((item: { fundingRateTimestamp: string; fundingRate: string }) => ({
      timestamp: parseInt(item.fundingRateTimestamp),
      rate: parseFloat(item.fundingRate),
      exchange: "Bybit" as Exchange,
    }));
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

function getFundingHistoryFetcher(exchange: Exchange): (symbol: string) => Promise<FundingRateEntry[]> {
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
      getFundingHistoryFetcher(exchangeA)(symbol),
      getFundingHistoryFetcher(exchangeB)(symbol),
    ]);

    console.warn = origWarn;
    return NextResponse.json({ exchangeA: historyA, exchangeB: historyB, _debug: errors });
  } catch (e) {
    console.error(`[funding-history] error:`, e);
    return NextResponse.json({ exchangeA: [], exchangeB: [], _debug: [String(e)] });
  }
}
