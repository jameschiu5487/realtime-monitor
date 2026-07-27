import { NextRequest, NextResponse } from "next/server";
import type { Exchange } from "@/lib/types/opportunity";

export const runtime = "edge";
export const preferredRegion = ["sin1", "hkg1", "kix1"];

interface FundingRateEntry {
  timestamp: number; // ms
  rate: number;
  exchange: Exchange | "OKX" | "Hyperliquid";
}

const FETCH_TIMEOUT_MS = 5000;

function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  return fetch(url, { ...init, signal: controller.signal, cache: "no-store" }).finally(() => clearTimeout(timer));
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

async function fetchGateFundingHistory(symbol: string, startTime?: number): Promise<FundingRateEntry[]> {
  try {
    const fmtSymbol = formatExchangeSymbol(symbol, "Gate");
    // 帶 startTime 才把 limit 拉大抓滿範圍（單次上限 1000，8h 間隔逾 300 天足夠，不需分頁）；
    // 否則維持原本最近 30 期行為（供 opportunity modal）
    const limit = startTime !== undefined ? 1000 : 30;
    const url = `https://api.gateio.ws/api/v4/futures/usdt/funding_rate?contract=${encodeURIComponent(fmtSymbol)}&limit=${limit}`;
    const res = await fetchWithTimeout(url);
    if (!res.ok) { console.warn(`[funding-history] Gate ${symbol}: HTTP ${res.status}`); return []; }
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    const entries: FundingRateEntry[] = data.map((item: { t: number; r: string }) => ({
      timestamp: item.t * 1000,
      rate: parseFloat(item.r),
      exchange: "Gate" as Exchange,
    }));
    if (startTime === undefined) return entries;
    return entries.filter((e) => e.timestamp >= startTime).sort((a, b) => a.timestamp - b.timestamp);
  } catch (e) {
    console.warn(`[funding-history] Gate ${symbol} error:`, e instanceof Error ? e.message : e);
    return [];
  }
}

async function fetchBitgetFundingHistory(symbol: string, startTime?: number): Promise<FundingRateEntry[]> {
  try {
    const mapEntries = (list: { fundingTime: string; fundingRate: string }[]) =>
      list.map((item) => ({
        timestamp: parseInt(item.fundingTime),
        rate: parseFloat(item.fundingRate),
        exchange: "Bitget" as Exchange,
      }));
    const base = `https://api.bitget.com/api/v2/mix/market/history-fund-rate?symbol=${symbol.toUpperCase()}&productType=USDT-FUTURES`;
    // 無 startTime：維持原本最近 30 期行為（供 opportunity modal）
    if (startTime === undefined) {
      const res = await fetchWithTimeout(`${base}&pageSize=30`);
      if (!res.ok) { console.warn(`[funding-history] Bitget ${symbol}: HTTP ${res.status}`); return []; }
      const data = await res.json();
      if (data.code !== "00000" || !data.data?.length) return [];
      return mapEntries(data.data);
    }
    // 帶 startTime：pageNo 往回翻頁（pageSize=100，每頁更舊），直到最舊 <= startTime
    const entries: FundingRateEntry[] = [];
    for (let page = 1; page <= MAX_HISTORY_PAGES; page++) {
      const res = await fetchWithTimeout(`${base}&pageSize=100&pageNo=${page}`);
      if (!res.ok) { console.warn(`[funding-history] Bitget ${symbol}: HTTP ${res.status}`); break; }
      const data = await res.json();
      if (data.code !== "00000" || !data.data?.length) break;
      const batch = mapEntries(data.data);
      entries.push(...batch);
      const oldest = Math.min(...batch.map((e) => e.timestamp));
      if (batch.length < 100 || oldest <= startTime) break;
    }
    return entries.filter((e) => e.timestamp >= startTime).sort((a, b) => a.timestamp - b.timestamp);
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

// OKX 不在 Exchange 型別內，比照 Alpaca 前置字串分流（走 perp instId）
function okxInstId(symbol: string): string {
  const base = symbol.replace(/USDT$/i, "");
  return `${base}-USDT-SWAP`;
}

async function fetchOKXFundingHistory(symbol: string, startTime?: number): Promise<FundingRateEntry[]> {
  try {
    const instId = okxInstId(symbol);
    const mapEntries = (list: { fundingRate: string; fundingTime: string }[]) =>
      list.map((item) => ({
        timestamp: parseInt(item.fundingTime, 10),
        rate: parseFloat(item.fundingRate),
        exchange: "OKX" as const,
      }));
    if (startTime === undefined) {
      const url = `https://www.okx.com/api/v5/public/funding-rate-history?instId=${encodeURIComponent(instId)}&limit=100`;
      const res = await fetchWithTimeout(url);
      if (!res.ok) { console.warn(`[funding-history] OKX ${symbol}: HTTP ${res.status}`); return []; }
      const data = await res.json();
      if (data.code !== "0" || !data.data?.length) return [];
      return mapEntries(data.data).sort((a, b) => a.timestamp - b.timestamp);
    }
    // 帶 startTime：OKX 回傳由新到舊，用 after=<最舊 fundingTime> 往回分頁到 startTime
    const entries: FundingRateEntry[] = [];
    let after: string | undefined;
    for (let page = 0; page < MAX_HISTORY_PAGES; page++) {
      const url = `https://www.okx.com/api/v5/public/funding-rate-history?instId=${encodeURIComponent(instId)}&limit=100${after ? `&after=${after}` : ""}`;
      const res = await fetchWithTimeout(url);
      if (!res.ok) { console.warn(`[funding-history] OKX ${symbol}: HTTP ${res.status}`); break; }
      const data = await res.json();
      if (data.code !== "0" || !data.data?.length) break;
      const batch = mapEntries(data.data);
      entries.push(...batch);
      const oldest = Math.min(...batch.map((e) => e.timestamp));
      after = String(oldest);
      if (batch.length < 100 || oldest <= startTime) break;
    }
    return entries.filter((e) => e.timestamp >= startTime).sort((a, b) => a.timestamp - b.timestamp);
  } catch (e) {
    console.warn(`[funding-history] OKX ${symbol} error:`, e instanceof Error ? e.message : e);
    return [];
  }
}

// Hyperliquid 每小時結算、回應舊到新；time 有幾十 ms 偏移，落正到整點
async function fetchHyperliquidFundingHistory(symbol: string, startTime?: number): Promise<FundingRateEntry[]> {
  try {
    // 無 startTime：取最近 ~30 筆（每小時一筆），與其他交易所的「最近一批」語意對齊
    const from = startTime ?? Date.now() - 30 * 3600000;
    const entries: FundingRateEntry[] = [];
    let cursor = from;
    for (let page = 0; page < MAX_HISTORY_PAGES; page++) {
      const res = await fetchWithTimeout("https://api.hyperliquid.xyz/info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "fundingHistory", coin: symbol, startTime: cursor }),
      });
      if (!res.ok) { console.warn(`[funding-history] Hyperliquid ${symbol}: HTTP ${res.status}`); break; }
      const data = await res.json();
      if (!Array.isArray(data) || data.length === 0) break;
      const batch = (data as { fundingRate: string; time: number }[]).map((item) => ({
        timestamp: Math.floor(item.time / 3600000) * 3600000,
        rate: parseFloat(item.fundingRate),
        exchange: "Hyperliquid" as const,
      }));
      entries.push(...batch);
      // 單次上限 500 筆，回滿就從最後一筆之後向前續抓
      if (data.length < 500) break;
      cursor = data[data.length - 1].time + 1;
    }
    return entries.sort((a, b) => a.timestamp - b.timestamp);
  } catch (e) {
    console.warn(`[funding-history] Hyperliquid ${symbol} error:`, e instanceof Error ? e.message : e);
    return [];
  }
}

function getFundingHistoryFetcher(
  exchange: Exchange | "OKX" | "Hyperliquid"
): (symbol: string, startTime?: number) => Promise<FundingRateEntry[]> {
  switch (exchange) {
    case "Binance": return fetchBinanceFundingHistory;
    case "Bybit": return fetchBybitFundingHistory;
    case "Gate": return fetchGateFundingHistory;
    case "Bitget": return fetchBitgetFundingHistory;
    case "BingX": return fetchBingXFundingHistory;
    case "BitMart": return fetchBitMartFundingHistory;
    case "Zoomex": return async () => [];
    case "OKX": return fetchOKXFundingHistory;
    case "Hyperliquid": return fetchHyperliquidFundingHistory;
  }
}

const VALID_EXCHANGES: Exchange[] = ["Binance", "Bybit", "BingX", "Gate", "Bitget", "BitMart", "Zoomex"];

function isValidExchangeParam(exchange: Exchange | "OKX" | "Hyperliquid"): boolean {
  return exchange === "OKX" || exchange === "Hyperliquid" || VALID_EXCHANGES.includes(exchange);
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const exchangeA = searchParams.get("exchangeA") as Exchange | "OKX" | "Hyperliquid" | null;
  const exchangeB = searchParams.get("exchangeB") as Exchange | "OKX" | "Hyperliquid" | null;
  const symbol = searchParams.get("symbol");
  // 可選 startTime(ms)：帶了就抓滿 [startTime, now]（Binance/Bybit/OKX/Hyperliquid/Gate/Bitget 支援，其餘忽略）
  const startTimeParam = parseInt(searchParams.get("startTime") ?? "", 10);
  const startTime = Number.isFinite(startTimeParam) && startTimeParam > 0 ? startTimeParam : undefined;

  if (!exchangeA || !exchangeB || !symbol || !isValidExchangeParam(exchangeA) || !isValidExchangeParam(exchangeB)) {
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
