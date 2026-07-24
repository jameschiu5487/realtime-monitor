import { NextRequest, NextResponse } from "next/server";
import type { Exchange } from "@/lib/types/opportunity";
import { getKlineConfig } from "@/lib/kline-config";

export const runtime = "edge";
export const preferredRegion = ["sin1", "hkg1", "kix1"];

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

function getExchangeInterval(exchange: Exchange, intervalMinutes: number): string {
  switch (exchange) {
    case "Binance":
    case "BingX":
      return intervalMinutes < 60 ? `${intervalMinutes}m` : `${intervalMinutes / 60}h`;
    case "Gate":
      return intervalMinutes < 60 ? `${intervalMinutes}m` : `${intervalMinutes / 60}h`;
    case "Bybit":
    case "Zoomex":
      return String(intervalMinutes);
    case "Bitget":
      return intervalMinutes < 60 ? `${intervalMinutes}m` : `${intervalMinutes / 60}H`;
    case "BitMart":
      return String(intervalMinutes);
    default:
      return `${intervalMinutes}m`;
  }
}

async function fetchBinanceKlines(
  symbol: string,
  interval: string,
  maxKlines: number,
  market: "perp" | "spot"
): Promise<[number, number][]> {
  // spot 端點單次上限 1000，futures 為 1500
  const LIMIT = market === "perp" ? 1500 : 1000;
  const baseUrl =
    market === "perp"
      ? "https://fapi.binance.com/fapi/v1/klines"
      : "https://api.binance.com/api/v3/klines";
  const maxRequests = Math.ceil(maxKlines / LIMIT);
  const allKlines: [number, number][] = [];
  let oldestTime = Date.now();
  for (let i = 0; i < maxRequests && allKlines.length < maxKlines; i++) {
    const url =
      i === 0
        ? `${baseUrl}?symbol=${symbol.toUpperCase()}&interval=${interval}&limit=${LIMIT}`
        : `${baseUrl}?symbol=${symbol.toUpperCase()}&interval=${interval}&limit=${LIMIT}&endTime=${oldestTime - 1}`;
    const response = await fetch(url);
    if (!response.ok) break;
    const data = await response.json();
    const klines: [number, number][] = data.map((k: (string | number)[]) => [Number(k[0]), parseFloat(k[4] as string)]);
    if (klines.length === 0) break;
    allKlines.unshift(...klines);
    oldestTime = klines[0][0];
    if (klines.length < LIMIT) break;
  }
  return allKlines;
}

async function fetchBybitKlines(
  symbol: string,
  interval: string,
  maxKlines: number,
  market: "perp" | "spot"
): Promise<[number, number][]> {
  const category = market === "perp" ? "linear" : "spot";
  const LIMIT = 1000;
  const maxRequests = Math.ceil(maxKlines / LIMIT);
  const allKlines: [number, number][] = [];
  let endTime = Date.now();
  for (let i = 0; i < maxRequests && allKlines.length < maxKlines; i++) {
    const url = `https://api.bybit.com/v5/market/kline?category=${category}&symbol=${symbol.toUpperCase()}&interval=${interval}&limit=${LIMIT}&end=${endTime}`;
    const response = await fetch(url);
    if (!response.ok) break;
    const data = await response.json();
    if (data.retCode !== 0 || !data.result?.list?.length) break;
    const klines: [number, number][] = data.result.list.map((k: string[]) => [parseInt(k[0]), parseFloat(k[4])]);
    allKlines.push(...klines);
    const oldest = Math.min(...klines.map((k) => k[0]));
    endTime = oldest - 1;
    if (klines.length < LIMIT) break;
  }
  return allKlines.sort((a, b) => a[0] - b[0]);
}

async function fetchBingXKlines(symbol: string, interval: string, maxKlines: number): Promise<[number, number][]> {
  const fmtSymbol = formatExchangeSymbol(symbol, "BingX");
  const LIMIT = 1440;
  const maxRequests = Math.ceil(maxKlines / LIMIT);
  const allKlines: [number, number][] = [];
  let endTime = Date.now();
  for (let i = 0; i < maxRequests && allKlines.length < maxKlines; i++) {
    const url = `https://open-api.bingx.com/openApi/swap/v2/quote/klines?symbol=${encodeURIComponent(fmtSymbol)}&interval=${interval}&limit=${LIMIT}&endTime=${endTime}`;
    const response = await fetch(url);
    if (!response.ok) break;
    const data = await response.json();
    if (data.code !== 0 || !data.data?.length) break;
    const klines: [number, number][] = data.data.map((k: { time: number; close: string }) => [k.time, parseFloat(k.close)]);
    if (klines.length === 0) break;
    allKlines.unshift(...klines);
    const oldest = Math.min(...klines.map((k) => k[0]));
    endTime = oldest - 1;
    if (klines.length < LIMIT) break;
  }
  return allKlines.sort((a, b) => a[0] - b[0]);
}

async function fetchGateKlines(symbol: string, interval: string, maxKlines: number, intervalMinutes: number): Promise<[number, number][]> {
  const fmtSymbol = formatExchangeSymbol(symbol, "Gate");
  const LIMIT = 2000;
  const maxRequests = Math.ceil(maxKlines / LIMIT);
  const allKlines: [number, number][] = [];
  let to = Math.floor(Date.now() / 1000);
  for (let i = 0; i < maxRequests && allKlines.length < maxKlines; i++) {
    const from = to - LIMIT * intervalMinutes * 60;
    const url = `https://api.gateio.ws/api/v4/futures/usdt/candlesticks?contract=${encodeURIComponent(fmtSymbol)}&interval=${interval}&from=${from}&to=${to}`;
    const response = await fetch(url);
    if (!response.ok) break;
    const data = await response.json();
    if (!Array.isArray(data) || data.length === 0) break;
    const klines: [number, number][] = data.map((k: { t: number; c: string }) => [k.t * 1000, parseFloat(k.c)]);
    allKlines.unshift(...klines);
    to = from - 1;
    if (data.length < LIMIT) break;
  }
  return allKlines.sort((a, b) => a[0] - b[0]);
}

async function fetchBitgetKlines(symbol: string, interval: string, maxKlines: number): Promise<[number, number][]> {
  const LIMIT = 1000;
  const maxRequests = Math.ceil(maxKlines / LIMIT);
  const allKlines: [number, number][] = [];
  let endTime = String(Date.now());
  for (let i = 0; i < maxRequests && allKlines.length < maxKlines; i++) {
    const url = `https://api.bitget.com/api/v2/mix/market/candles?productType=USDT-FUTURES&symbol=${symbol.toUpperCase()}&granularity=${interval}&limit=${LIMIT}&endTime=${endTime}`;
    const response = await fetch(url);
    if (!response.ok) break;
    const data = await response.json();
    if (data.code !== "00000" || !data.data?.length) break;
    const klines: [number, number][] = data.data.map((k: string[]) => [parseInt(k[0]), parseFloat(k[4])]);
    allKlines.push(...klines);
    const oldest = Math.min(...klines.map((k) => k[0]));
    endTime = String(oldest - 1);
    if (klines.length < LIMIT) break;
  }
  return allKlines.sort((a, b) => a[0] - b[0]);
}

async function fetchBitMartKlines(symbol: string, intervalMinutes: number, maxKlines: number): Promise<[number, number][]> {
  const now = Math.floor(Date.now() / 1000);
  const start = now - maxKlines * intervalMinutes * 60;
  const url = `https://api-cloud-v2.bitmart.com/contract/public/kline?symbol=${symbol.toUpperCase()}&step=${intervalMinutes}&start_time=${start}&end_time=${now}`;
  const response = await fetch(url);
  if (!response.ok) return [];
  const data = await response.json();
  if (data.code !== 1000 || !data.data?.klines?.length) return [];
  return data.data.klines
    .map((k: { timestamp: number; close_price: string }) => [k.timestamp * 1000, parseFloat(k.close_price)] as [number, number])
    .sort((a: [number, number], b: [number, number]) => a[0] - b[0]);
}

async function fetchZoomexKlines(symbol: string, interval: string, maxKlines: number): Promise<[number, number][]> {
  const LIMIT = 1000;
  const maxRequests = Math.ceil(maxKlines / LIMIT);
  const allKlines: [number, number][] = [];
  let endTime = Date.now();
  for (let i = 0; i < maxRequests && allKlines.length < maxKlines; i++) {
    const url = `https://openapi.zoomex.com/cloud/trade/v3/market/kline?category=linear&symbol=${symbol.toUpperCase()}&interval=${interval}&limit=${LIMIT}&end=${endTime}`;
    const response = await fetch(url);
    if (!response.ok) break;
    const data = await response.json();
    if (data.retCode !== 0 || !data.result?.list?.length) break;
    const klines: [number, number][] = data.result.list.map((k: string[]) => [parseInt(k[0]), parseFloat(k[4])]);
    allKlines.push(...klines);
    const oldest = Math.min(...klines.map((k) => k[0]));
    endTime = oldest - 1;
    if (klines.length < LIMIT) break;
  }
  return allKlines.sort((a, b) => a[0] - b[0]);
}

// --- Alpaca（美股實盤數據，IEX feed，僅 spot）---

function alpacaTimeframe(intervalMinutes: number): string {
  return intervalMinutes >= 60 ? `${Math.round(intervalMinutes / 60)}Hour` : `${intervalMinutes}Min`;
}

async function fetchAlpacaKlines(
  symbol: string,
  intervalMinutes: number,
  maxKlines: number
): Promise<[number, number][]> {
  const key = process.env.ALPACA_API_KEY;
  const secret = process.env.ALPACA_API_SECRET;
  if (!key || !secret) {
    console.warn("[klines] Alpaca API keys not configured");
    return [];
  }
  const headers = { "APCA-API-KEY-ID": key, "APCA-API-SECRET-KEY": secret };
  // 美股一天只交易約 6.5 小時，日曆時間抓 K 線數的 4 倍才夠湊滿根數（上限 90 天）
  const spanMinutes = Math.min(intervalMinutes * maxKlines * 4, 90 * 1440);
  const start = new Date(Date.now() - spanMinutes * 60_000).toISOString();
  const bars: [number, number][] = [];
  let pageToken = "";
  for (let page = 0; page < 5; page++) {
    const url =
      `https://data.alpaca.markets/v2/stocks/${encodeURIComponent(symbol.toUpperCase())}/bars` +
      `?timeframe=${alpacaTimeframe(intervalMinutes)}&start=${encodeURIComponent(start)}` +
      `&limit=10000&adjustment=raw&feed=iex` +
      (pageToken ? `&page_token=${encodeURIComponent(pageToken)}` : "");
    const response = await fetch(url, { headers, cache: "no-store" });
    if (!response.ok) {
      console.warn(`[klines] Alpaca ${symbol}: HTTP ${response.status}`);
      break;
    }
    const data = await response.json();
    for (const b of (data.bars ?? []) as { t: string; c: number }[]) {
      bars.push([Date.parse(b.t), b.c]);
    }
    pageToken = data.next_page_token ?? "";
    if (!pageToken) break;
  }
  return bars.slice(-maxKlines);
}

// --- OKX（public API，免金鑰，spot + perp/swap）---

function okxInstId(symbol: string, market: "perp" | "spot"): string {
  const base = symbol.replace(/USDT$/i, "");
  return market === "perp" ? `${base}-USDT-SWAP` : `${base}-USDT`;
}

// OKX K 線粒度：分鐘用小寫 m，小時用大寫 H，日線用 1Dutc；沒對應到的回 null
function okxBar(intervalMinutes: number): string | null {
  if ([1, 3, 5, 15, 30].includes(intervalMinutes)) return `${intervalMinutes}m`;
  if (intervalMinutes === 60) return "1H";
  if (intervalMinutes === 120) return "2H";
  if (intervalMinutes === 240) return "4H";
  if (intervalMinutes === 1440) return "1Dutc";
  return null;
}

async function fetchOKXKlines(instId: string, bar: string, maxKlines: number): Promise<[number, number][]> {
  const allKlines: [number, number][] = [];
  const firstUrl = `https://www.okx.com/api/v5/market/candles?instId=${encodeURIComponent(instId)}&bar=${bar}&limit=300`;
  const firstRes = await fetch(firstUrl);
  if (!firstRes.ok) return [];
  const firstData = await firstRes.json();
  if (firstData.code !== "0") return [];
  let page: [number, number][] = ((firstData.data ?? []) as string[][]).map((k) => [Number(k[0]), parseFloat(k[4])]);
  allKlines.push(...page);
  if (page.length === 0) return [];
  let after = Math.min(...page.map((k) => k[0]));
  const maxRequests = Math.ceil(maxKlines / 100);
  for (let i = 0; i < maxRequests && allKlines.length < maxKlines && page.length > 0; i++) {
    const url = `https://www.okx.com/api/v5/market/history-candles?instId=${encodeURIComponent(instId)}&bar=${bar}&after=${after}&limit=100`;
    const res = await fetch(url);
    if (!res.ok) break;
    const data = await res.json();
    if (data.code !== "0" || !data.data?.length) break;
    page = (data.data as string[][]).map((k) => [Number(k[0]), parseFloat(k[4])]);
    allKlines.push(...page);
    after = Math.min(...page.map((k) => k[0]));
    if (page.length < 100) break;
  }
  return allKlines.sort((a, b) => a[0] - b[0]).slice(-maxKlines);
}

// --- Hyperliquid（public API，免金鑰，僅 perp；symbol 為原生 coin 名，不加 USDT 後綴）---

// HL K 線粒度：分鐘用小寫 m，小時用小寫 h，日線用 1d；沒對應到的回 null
function hyperliquidInterval(intervalMinutes: number): string | null {
  if ([1, 3, 5, 15, 30].includes(intervalMinutes)) return `${intervalMinutes}m`;
  if (intervalMinutes === 60) return "1h";
  if (intervalMinutes === 120) return "2h";
  if (intervalMinutes === 240) return "4h";
  if (intervalMinutes === 480) return "8h";
  if (intervalMinutes === 720) return "12h";
  if (intervalMinutes === 1440) return "1d";
  return null;
}

// Hyperliquid /info POST，含暫時性失敗（429 限流 / 5xx / 網路例外）退避重試。
// 這條端點被 basis 頁高頻共用（allMids、l2Book、candleSnapshot），單擊常撞限流，
// 重試可避免把「暫時被限流」誤判成「symbol 不存在」。null = 重試後仍失敗。
async function hyperliquidPost(body: object, retries = 2): Promise<Response | null> {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch("https://api.hyperliquid.xyz/info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (response.ok) return response;
      // 429 / 5xx 才重試；其餘狀態（如 4xx 參數錯）直接回、不浪費重試
      if ((response.status === 429 || response.status >= 500) && attempt < retries) {
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
        continue;
      }
      return response;
    } catch {
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
        continue;
      }
      return null;
    }
  }
}

async function fetchHyperliquidKlines(
  coin: string,
  interval: string,
  intervalMinutes: number,
  maxKlines: number
): Promise<[number, number][]> {
  const intervalMs = intervalMinutes * 60_000;
  const now = Date.now();
  const endTime = now;
  let startTime = now - maxKlines * intervalMs;
  const allKlines: [number, number][] = [];
  const LIMIT = 5000;
  const maxRequests = Math.ceil(maxKlines / LIMIT) + 1;
  for (let i = 0; i < maxRequests && allKlines.length < maxKlines; i++) {
    const response = await hyperliquidPost({
      type: "candleSnapshot",
      req: { coin, interval, startTime, endTime },
    });
    if (!response || !response.ok) break;
    const data = await response.json();
    if (!Array.isArray(data) || data.length === 0) break;
    const klines: [number, number][] = data.map((k: { t: number; c: string }) => [k.t, parseFloat(k.c)]);
    allKlines.push(...klines);
    if (klines.length < LIMIT) break;
    startTime = klines[klines.length - 1][0] + intervalMs;
  }
  return allKlines.sort((a, b) => a[0] - b[0]).slice(-maxKlines);
}

const VALID_EXCHANGES: Exchange[] = ["Binance", "Bybit", "BingX", "Gate", "Bitget", "BitMart", "Zoomex"];

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const exchange = searchParams.get("exchange") as Exchange | null;
  const symbol = searchParams.get("symbol");
  const days = parseInt(searchParams.get("days") ?? "1", 10);
  const market = (searchParams.get("market") ?? "perp") as "perp" | "spot";

  // Alpaca 不在 Exchange 型別內，先於 VALID_EXCHANGES 檢查前分流
  if (searchParams.get("exchange") === "Alpaca") {
    if (market !== "spot") {
      return NextResponse.json({ error: "Alpaca only supports spot" }, { status: 400 });
    }
    if (!symbol) {
      return NextResponse.json({ error: "Missing symbol" }, { status: 400 });
    }
    const config = getKlineConfig(days);
    const limitParam = parseInt(searchParams.get("limit") ?? "", 10);
    const maxKlines =
      Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 15000) : config.fetchKlines;
    try {
      const klines = await fetchAlpacaKlines(symbol, config.intervalMinutes, maxKlines);
      console.log(`[klines] Alpaca/${symbol} spot ${config.label}: ${klines.length} candles`);
      return NextResponse.json(klines);
    } catch (e) {
      console.error(`[klines] Alpaca/${symbol} error:`, e);
      return NextResponse.json([], { status: 200 });
    }
  }

  // OKX 不在 Exchange 型別內，先於 VALID_EXCHANGES 檢查前分流
  if (searchParams.get("exchange") === "OKX") {
    if (!symbol) {
      return NextResponse.json({ error: "Missing symbol" }, { status: 400 });
    }
    if (market !== "perp" && market !== "spot") {
      return NextResponse.json({ error: "Invalid market" }, { status: 400 });
    }
    const config = getKlineConfig(days);
    const bar = okxBar(config.intervalMinutes);
    if (!bar) {
      return NextResponse.json({ error: "Unsupported interval for OKX" }, { status: 400 });
    }
    const limitParam = parseInt(searchParams.get("limit") ?? "", 10);
    const maxKlines =
      Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 15000) : config.fetchKlines;
    const instId = okxInstId(symbol, market);
    try {
      const klines = await fetchOKXKlines(instId, bar, maxKlines);
      console.log(`[klines] OKX/${symbol} ${market} ${config.label} (${bar}): ${klines.length} candles`);
      return NextResponse.json(klines);
    } catch (e) {
      console.error(`[klines] OKX/${symbol} ${market} error:`, e);
      return NextResponse.json([], { status: 200 });
    }
  }

  // Hyperliquid 不在 Exchange 型別內，先於 VALID_EXCHANGES 檢查前分流；僅支援 perp
  if (searchParams.get("exchange") === "Hyperliquid") {
    if (!symbol) {
      return NextResponse.json({ error: "Missing symbol" }, { status: 400 });
    }
    if (market !== "perp") {
      return NextResponse.json({ error: "Hyperliquid only supports perp" }, { status: 400 });
    }
    const config = getKlineConfig(days);
    const interval = hyperliquidInterval(config.intervalMinutes);
    if (!interval) {
      return NextResponse.json({ error: "Unsupported interval for Hyperliquid" }, { status: 400 });
    }
    const limitParam = parseInt(searchParams.get("limit") ?? "", 10);
    const maxKlines =
      Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 15000) : config.fetchKlines;
    try {
      const klines = await fetchHyperliquidKlines(symbol, interval, config.intervalMinutes, maxKlines);
      console.log(`[klines] Hyperliquid/${symbol} perp ${config.label} (${interval}): ${klines.length} candles`);
      return NextResponse.json(klines);
    } catch (e) {
      console.error(`[klines] Hyperliquid/${symbol} perp error:`, e);
      return NextResponse.json([], { status: 200 });
    }
  }

  if (!exchange || !symbol || !VALID_EXCHANGES.includes(exchange)) {
    return NextResponse.json({ error: "Missing or invalid exchange/symbol" }, { status: 400 });
  }
  if (market !== "perp" && market !== "spot") {
    return NextResponse.json({ error: "Invalid market" }, { status: 400 });
  }
  if (market === "spot" && exchange !== "Binance" && exchange !== "Bybit") {
    return NextResponse.json({ error: "spot only supported for Binance/Bybit" }, { status: 400 });
  }

  const config = getKlineConfig(days);
  const interval = getExchangeInterval(exchange, config.intervalMinutes);
  // 可選 limit（根數）：呼叫方要額外 indicator warmup 時帶入，覆蓋 config.fetchKlines
  const limitParam = parseInt(searchParams.get("limit") ?? "", 10);
  const MAX_LIMIT = 15000;
  const maxKlines =
    Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, MAX_LIMIT) : config.fetchKlines;

  try {
    let klines: [number, number][];
    switch (exchange) {
      case "Binance":
        klines = await fetchBinanceKlines(symbol, interval, maxKlines, market);
        break;
      case "Bybit":
        klines = await fetchBybitKlines(symbol, interval, maxKlines, market);
        break;
      case "BingX":
        klines = await fetchBingXKlines(symbol, interval, maxKlines);
        break;
      case "Gate":
        klines = await fetchGateKlines(symbol, interval, maxKlines, config.intervalMinutes);
        break;
      case "Bitget":
        klines = await fetchBitgetKlines(symbol, interval, maxKlines);
        break;
      case "BitMart":
        klines = await fetchBitMartKlines(symbol, config.intervalMinutes, maxKlines);
        break;
      case "Zoomex":
        klines = await fetchZoomexKlines(symbol, interval, maxKlines);
        break;
    }
    console.log(`[klines] ${exchange}/${symbol} ${market} ${config.label} (${interval}): ${klines.length} candles`);
    return NextResponse.json(klines);
  } catch (e) {
    console.error(`[klines] ${exchange}/${symbol} ${market} error:`, e);
    return NextResponse.json([], { status: 200 });
  }
}
