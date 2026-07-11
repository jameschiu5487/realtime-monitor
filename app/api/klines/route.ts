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

const VALID_EXCHANGES: Exchange[] = ["Binance", "Bybit", "BingX", "Gate", "Bitget", "BitMart", "Zoomex"];

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const exchange = searchParams.get("exchange") as Exchange | null;
  const symbol = searchParams.get("symbol");
  const days = parseInt(searchParams.get("days") ?? "1", 10);
  const market = (searchParams.get("market") ?? "perp") as "perp" | "spot";

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
