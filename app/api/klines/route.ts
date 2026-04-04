import { NextRequest, NextResponse } from "next/server";
import type { Exchange } from "@/lib/types/opportunity";

export const runtime = "edge";
export const preferredRegion = ["sin1", "hkg1", "kix1"];

const FETCH_KLINES = 2880;

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

async function fetchBinanceKlines(symbol: string): Promise<[number, number][]> {
  const allKlines: [number, number][] = [];
  let oldestTime = Date.now();
  for (let i = 0; i < 2 && allKlines.length < FETCH_KLINES; i++) {
    const url =
      i === 0
        ? `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol.toUpperCase()}&interval=1m&limit=1500`
        : `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol.toUpperCase()}&interval=1m&limit=1500&endTime=${oldestTime - 1}`;
    const response = await fetch(url);
    if (!response.ok) break;
    const data = await response.json();
    const klines: [number, number][] = data.map((k: (string | number)[]) => [Number(k[0]), parseFloat(k[4] as string)]);
    if (klines.length === 0) break;
    allKlines.unshift(...klines);
    oldestTime = klines[0][0];
    if (klines.length < 1500) break;
  }
  return allKlines;
}

async function fetchBybitKlines(symbol: string): Promise<[number, number][]> {
  const allKlines: [number, number][] = [];
  let endTime = Date.now();
  for (let i = 0; i < 3 && allKlines.length < FETCH_KLINES; i++) {
    const url = `https://api.bybit.com/v5/market/kline?category=linear&symbol=${symbol.toUpperCase()}&interval=1&limit=1000&end=${endTime}`;
    const response = await fetch(url);
    if (!response.ok) break;
    const data = await response.json();
    if (data.retCode !== 0 || !data.result?.list?.length) break;
    const klines: [number, number][] = data.result.list.map((k: string[]) => [parseInt(k[0]), parseFloat(k[4])]);
    allKlines.push(...klines);
    const oldest = Math.min(...klines.map((k) => k[0]));
    endTime = oldest - 1;
    if (klines.length < 1000) break;
  }
  return allKlines.sort((a, b) => a[0] - b[0]);
}

async function fetchBingXKlines(symbol: string): Promise<[number, number][]> {
  const fmtSymbol = formatExchangeSymbol(symbol, "BingX");
  const allKlines: [number, number][] = [];
  let endTime = Date.now();
  for (let i = 0; i < 2 && allKlines.length < FETCH_KLINES; i++) {
    const url = `https://open-api.bingx.com/openApi/swap/v2/quote/klines?symbol=${encodeURIComponent(fmtSymbol)}&interval=1m&limit=1440&endTime=${endTime}`;
    const response = await fetch(url);
    if (!response.ok) break;
    const data = await response.json();
    if (data.code !== 0 || !data.data?.length) break;
    const klines: [number, number][] = data.data.map((k: { time: number; close: string }) => [k.time, parseFloat(k.close)]);
    if (klines.length === 0) break;
    allKlines.unshift(...klines);
    const oldest = Math.min(...klines.map((k) => k[0]));
    endTime = oldest - 1;
    if (klines.length < 1440) break;
  }
  return allKlines.sort((a, b) => a[0] - b[0]);
}

async function fetchGateKlines(symbol: string): Promise<[number, number][]> {
  const fmtSymbol = formatExchangeSymbol(symbol, "Gate");
  const allKlines: [number, number][] = [];
  let to = Math.floor(Date.now() / 1000);
  for (let i = 0; i < 2 && allKlines.length < FETCH_KLINES; i++) {
    const from = to - 2000 * 60;
    // Gate API does not allow limit + from/to together
    const url = `https://api.gateio.ws/api/v4/futures/usdt/candlesticks?contract=${encodeURIComponent(fmtSymbol)}&interval=1m&from=${from}&to=${to}`;
    const response = await fetch(url);
    if (!response.ok) break;
    const data = await response.json();
    if (!Array.isArray(data) || data.length === 0) break;
    const klines: [number, number][] = data.map((k: { t: number; c: string }) => [k.t * 1000, parseFloat(k.c)]);
    allKlines.unshift(...klines);
    to = from - 1;
    if (data.length < 2000) break;
  }
  return allKlines.sort((a, b) => a[0] - b[0]);
}

async function fetchBitgetKlines(symbol: string): Promise<[number, number][]> {
  const allKlines: [number, number][] = [];
  let endTime = String(Date.now());
  for (let i = 0; i < 3 && allKlines.length < FETCH_KLINES; i++) {
    const url = `https://api.bitget.com/api/v2/mix/market/candles?productType=USDT-FUTURES&symbol=${symbol.toUpperCase()}&granularity=1m&limit=1000&endTime=${endTime}`;
    const response = await fetch(url);
    if (!response.ok) break;
    const data = await response.json();
    if (data.code !== "00000" || !data.data?.length) break;
    const klines: [number, number][] = data.data.map((k: string[]) => [parseInt(k[0]), parseFloat(k[4])]);
    allKlines.push(...klines);
    const oldest = Math.min(...klines.map((k) => k[0]));
    endTime = String(oldest - 1);
    if (klines.length < 1000) break;
  }
  return allKlines.sort((a, b) => a[0] - b[0]);
}

async function fetchBitMartKlines(symbol: string): Promise<[number, number][]> {
  const now = Math.floor(Date.now() / 1000);
  const start = now - FETCH_KLINES * 60;
  const url = `https://api-cloud-v2.bitmart.com/contract/public/kline?symbol=${symbol.toUpperCase()}&step=1&start_time=${start}&end_time=${now}`;
  const response = await fetch(url);
  if (!response.ok) return [];
  const data = await response.json();
  if (data.code !== 1000 || !data.data?.klines?.length) return [];
  return data.data.klines
    .map((k: { timestamp: number; close_price: string }) => [k.timestamp * 1000, parseFloat(k.close_price)] as [number, number])
    .sort((a: [number, number], b: [number, number]) => a[0] - b[0]);
}

async function fetchZoomexKlines(symbol: string): Promise<[number, number][]> {
  const allKlines: [number, number][] = [];
  let endTime = Date.now();
  for (let i = 0; i < 3 && allKlines.length < FETCH_KLINES; i++) {
    const url = `https://openapi.zoomex.com/cloud/trade/v3/market/kline?category=linear&symbol=${symbol.toUpperCase()}&interval=1&limit=1000&end=${endTime}`;
    const response = await fetch(url);
    if (!response.ok) break;
    const data = await response.json();
    if (data.retCode !== 0 || !data.result?.list?.length) break;
    const klines: [number, number][] = data.result.list.map((k: string[]) => [parseInt(k[0]), parseFloat(k[4])]);
    allKlines.push(...klines);
    const oldest = Math.min(...klines.map((k) => k[0]));
    endTime = oldest - 1;
    if (klines.length < 1000) break;
  }
  return allKlines.sort((a, b) => a[0] - b[0]);
}

function getKlineFetcher(exchange: Exchange): (symbol: string) => Promise<[number, number][]> {
  switch (exchange) {
    case "Binance": return fetchBinanceKlines;
    case "Bybit": return fetchBybitKlines;
    case "BingX": return fetchBingXKlines;
    case "Gate": return fetchGateKlines;
    case "Bitget": return fetchBitgetKlines;
    case "BitMart": return fetchBitMartKlines;
    case "Zoomex": return fetchZoomexKlines;
  }
}

const VALID_EXCHANGES: Exchange[] = ["Binance", "Bybit", "BingX", "Gate", "Bitget", "BitMart", "Zoomex"];

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const exchange = searchParams.get("exchange") as Exchange | null;
  const symbol = searchParams.get("symbol");

  if (!exchange || !symbol || !VALID_EXCHANGES.includes(exchange)) {
    return NextResponse.json({ error: "Missing or invalid exchange/symbol" }, { status: 400 });
  }

  try {
    const fetcher = getKlineFetcher(exchange);
    const klines = await fetcher(symbol);
    console.log(`[klines] ${exchange}/${symbol}: ${klines.length} candles`);
    return NextResponse.json(klines);
  } catch (e) {
    console.error(`[klines] ${exchange}/${symbol} error:`, e);
    return NextResponse.json([], { status: 200 });
  }
}
