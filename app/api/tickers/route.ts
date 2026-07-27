import { NextRequest, NextResponse } from "next/server";
import type { TickerQuote } from "@/lib/basis";

export const runtime = "edge";
export const preferredRegion = ["sin1", "hkg1", "kix1"];

type Market = "perp" | "spot";

// 回傳 symbol -> { last, bid?, ask? }。last = 最後成交價（basis 用）；bid/ask = 盤口一檔（a1/b1）。
async function fetchBinanceTickers(market: Market): Promise<Record<string, TickerQuote>> {
  const base =
    market === "perp" ? "https://fapi.binance.com/fapi/v1" : "https://api.binance.com/api/v3";
  // bookTicker 只有盤口沒有 last，ticker/price 只有 last 沒有盤口，兩者合併
  const [priceRes, bookRes] = await Promise.all([
    fetch(`${base}/ticker/price`, { cache: "no-store" }),
    fetch(`${base}/ticker/bookTicker`, { cache: "no-store" }),
  ]);
  const map: Record<string, TickerQuote> = {};
  if (priceRes.ok) {
    const data = (await priceRes.json()) as { symbol: string; price: string }[];
    for (const t of data) map[t.symbol] = { last: parseFloat(t.price) };
  }
  if (bookRes.ok) {
    const data = (await bookRes.json()) as {
      symbol: string;
      bidPrice: string;
      askPrice: string;
    }[];
    for (const t of data) {
      const q = map[t.symbol] ?? { last: parseFloat(t.bidPrice) };
      q.bid = parseFloat(t.bidPrice);
      q.ask = parseFloat(t.askPrice);
      map[t.symbol] = q;
    }
  }
  return map;
}

async function fetchBybitTickers(market: Market): Promise<Record<string, TickerQuote>> {
  const category = market === "perp" ? "linear" : "spot";
  const url = `https://api.bybit.com/v5/market/tickers?category=${category}`;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) return {};
  const data = await response.json();
  if (data.retCode !== 0) return {};
  const map: Record<string, TickerQuote> = {};
  for (const t of (data.result?.list ?? []) as {
    symbol: string;
    lastPrice: string;
    bid1Price?: string;
    ask1Price?: string;
  }[]) {
    map[t.symbol] = {
      last: parseFloat(t.lastPrice),
      bid: t.bid1Price ? parseFloat(t.bid1Price) : undefined,
      ask: t.ask1Price ? parseFloat(t.ask1Price) : undefined,
    };
  }
  return map;
}

// Gate.io：canonical symbol = 去底線（BTC_USDT -> BTCUSDT）。perp/spot ticker 皆含 bid/ask
async function fetchGateTickers(market: Market): Promise<Record<string, TickerQuote>> {
  const url =
    market === "perp"
      ? "https://api.gateio.ws/api/v4/futures/usdt/tickers"
      : "https://api.gateio.ws/api/v4/spot/tickers";
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) return {};
  const data = await response.json();
  if (!Array.isArray(data)) return {};
  const map: Record<string, TickerQuote> = {};
  for (const t of data as {
    contract?: string;
    currency_pair?: string;
    last: string;
    highest_bid?: string;
    lowest_ask?: string;
  }[]) {
    const native = market === "perp" ? t.contract : t.currency_pair;
    if (!native) continue;
    map[native.replace(/_/g, "")] = {
      last: parseFloat(t.last),
      bid: t.highest_bid ? parseFloat(t.highest_bid) : undefined,
      ask: t.lowest_ask ? parseFloat(t.lowest_ask) : undefined,
    };
  }
  return map;
}

// Bitget：symbol 原生即 BTCUSDT。mix/spot ticker 皆含 bidPr/askPr
async function fetchBitgetTickers(market: Market): Promise<Record<string, TickerQuote>> {
  const url =
    market === "perp"
      ? "https://api.bitget.com/api/v2/mix/market/tickers?productType=USDT-FUTURES"
      : "https://api.bitget.com/api/v2/spot/market/tickers";
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) return {};
  const data = await response.json();
  if (data.code !== "00000") return {};
  const map: Record<string, TickerQuote> = {};
  for (const t of (data.data ?? []) as {
    symbol: string;
    lastPr: string;
    bidPr?: string;
    askPr?: string;
  }[]) {
    map[t.symbol] = {
      last: parseFloat(t.lastPr),
      bid: t.bidPr ? parseFloat(t.bidPr) : undefined,
      ask: t.askPr ? parseFloat(t.askPr) : undefined,
    };
  }
  return map;
}

// Alpaca 沒有全量端點，需帶 symbols 查最新成交價。盤口先不抓（不需要 a1/b1）
async function fetchAlpacaTickers(symbols: string[]): Promise<Record<string, TickerQuote>> {
  const key = process.env.ALPACA_API_KEY;
  const secret = process.env.ALPACA_API_SECRET;
  if (!key || !secret || symbols.length === 0) return {};
  const url = `https://data.alpaca.markets/v2/stocks/trades/latest?symbols=${encodeURIComponent(symbols.join(","))}&feed=iex`;
  const response = await fetch(url, {
    headers: { "APCA-API-KEY-ID": key, "APCA-API-SECRET-KEY": secret },
    cache: "no-store",
  });
  if (!response.ok) return {};
  const data = await response.json();
  const map: Record<string, TickerQuote> = {};
  for (const [sym, trade] of Object.entries((data.trades ?? {}) as Record<string, { p: number }>)) {
    map[sym] = { last: trade.p };
  }
  return map;
}

// OKX 不在 Exchange 型別內，比照 Alpaca 用前置字串分流；instId -> canonical symbol
function okxInstIdToSymbol(instId: string): string {
  return instId.replace(/-SWAP$/, "").replace(/-/g, "");
}

async function fetchOKXTickers(market: Market): Promise<Record<string, TickerQuote>> {
  const instType = market === "perp" ? "SWAP" : "SPOT";
  const suffix = market === "perp" ? "-USDT-SWAP" : "-USDT";
  const url = `https://www.okx.com/api/v5/market/tickers?instType=${instType}`;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) return {};
  const data = await response.json();
  if (data.code !== "0") return {};
  const map: Record<string, TickerQuote> = {};
  for (const t of (data.data ?? []) as {
    instId: string;
    last: string;
    bidPx?: string;
    askPx?: string;
  }[]) {
    if (!t.instId.endsWith(suffix)) continue;
    map[okxInstIdToSymbol(t.instId)] = {
      last: parseFloat(t.last),
      bid: t.bidPx ? parseFloat(t.bidPx) : undefined,
      ask: t.askPx ? parseFloat(t.askPx) : undefined,
    };
  }
  return map;
}

// Hyperliquid 不在 Exchange 型別內，比照 Alpaca/OKX 用前置字串分流；僅 perp
// allMids 主市場 key 有雜訊（@/# 開頭為 spot index / 內部市場，濾掉）；
// builder-deployed perp DEX（HIP-3）的標的（如 mkts:TSLA）要帶 dex 參數分別抓
// 此 REST 只給 mid 價（last，livePoint 用）；清單的盤口 a1/b1 改由前端 websocket
// 訂閱 l2Book 取得（見 basis-monitor-content），不在這裡逐標的打 REST，避免限流
async function fetchHyperliquidMids(dex?: string): Promise<Record<string, string>> {
  const response = await fetch("https://api.hyperliquid.xyz/info", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(dex ? { type: "allMids", dex } : { type: "allMids" }),
    cache: "no-store",
  });
  if (!response.ok) return {};
  return (await response.json()) as Record<string, string>;
}

async function fetchHyperliquidTickers(): Promise<Record<string, TickerQuote>> {
  const dexRes = await fetch("https://api.hyperliquid.xyz/info", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "perpDexs" }),
    cache: "no-store",
  });
  const builderDexes: string[] = dexRes.ok
    ? ((await dexRes.json()) as ({ name: string } | null)[])
        .filter((d): d is { name: string } => !!d?.name)
        .map((d) => d.name)
    : [];
  const midsList = await Promise.all([
    fetchHyperliquidMids(),
    ...builderDexes.map((dex) => fetchHyperliquidMids(dex)),
  ]);
  const map: Record<string, TickerQuote> = {};
  for (const mids of midsList) {
    for (const [key, value] of Object.entries(mids)) {
      // 主市場的 @/# 雜訊 key 濾掉；builder 標的 key 含冒號（dex:TICKER），保留
      if (key.startsWith("@") || key.startsWith("#")) continue;
      map[key] = { last: parseFloat(value) };
    }
  }
  return map;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const exchange = searchParams.get("exchange");
  const market = (searchParams.get("market") ?? "perp") as Market;

  if (
    (exchange !== "Binance" &&
      exchange !== "Bybit" &&
      exchange !== "Alpaca" &&
      exchange !== "OKX" &&
      exchange !== "Hyperliquid" &&
      exchange !== "Gate" &&
      exchange !== "Bitget") ||
    (market !== "perp" && market !== "spot")
  ) {
    return NextResponse.json({ error: "Invalid exchange/market" }, { status: 400 });
  }

  try {
    if (exchange === "Hyperliquid") {
      if (market !== "perp") {
        return NextResponse.json({ error: "Hyperliquid only supports perp" }, { status: 400 });
      }
      return NextResponse.json(await fetchHyperliquidTickers());
    }
    if (exchange === "OKX") {
      return NextResponse.json(await fetchOKXTickers(market));
    }
    if (exchange === "Gate") {
      return NextResponse.json(await fetchGateTickers(market));
    }
    if (exchange === "Bitget") {
      return NextResponse.json(await fetchBitgetTickers(market));
    }
    if (exchange === "Alpaca") {
      if (market !== "spot") {
        return NextResponse.json({ error: "Alpaca only supports spot" }, { status: 400 });
      }
      const symbols = (searchParams.get("symbols") ?? "")
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean)
        .slice(0, 100);
      if (symbols.length === 0) {
        return NextResponse.json({ error: "Alpaca requires symbols param" }, { status: 400 });
      }
      return NextResponse.json(await fetchAlpacaTickers(symbols));
    }
    const tickers =
      exchange === "Binance" ? await fetchBinanceTickers(market) : await fetchBybitTickers(market);
    return NextResponse.json(tickers);
  } catch (e) {
    console.error(`[tickers] ${exchange}/${market} error:`, e);
    return NextResponse.json({}, { status: 200 });
  }
}
