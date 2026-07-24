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
// allMids 只給 mid 價（last）；盤口（a1/b1）要另外用 l2Book 逐一標的抓
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

// l2Book 回傳單一標的訂單簿：levels[0] = bids（最佳在前）、levels[1] = asks（最佳在前）
async function fetchHyperliquidL2(coin: string): Promise<{ bid?: number; ask?: number }> {
  try {
    const response = await fetch("https://api.hyperliquid.xyz/info", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "l2Book", coin }),
      cache: "no-store",
    });
    if (!response.ok) return {};
    const data = (await response.json()) as {
      levels?: [{ px: string }[], { px: string }[]];
    };
    const bids = data.levels?.[0];
    const asks = data.levels?.[1];
    return {
      bid: bids?.[0] ? parseFloat(bids[0].px) : undefined,
      ask: asks?.[0] ? parseFloat(asks[0].px) : undefined,
    };
  } catch {
    return {};
  }
}

async function fetchHyperliquidTickers(symbols: string[] = []): Promise<Record<string, TickerQuote>> {
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
  // 補盤口：對清單指定的 symbols 逐一打 l2Book（無全量盤口端點）。
  // builder dex 標的（key 含 ":"）的 l2Book coin 對映不確定，先略過只保留 last。
  const bookSymbols = symbols.filter((s) => map[s] && !s.includes(":"));
  const books = await Promise.all(
    bookSymbols.map((s) => fetchHyperliquidL2(s).then((b) => [s, b] as const))
  );
  for (const [s, b] of books) {
    if (b.bid !== undefined) map[s].bid = b.bid;
    if (b.ask !== undefined) map[s].ask = b.ask;
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
      exchange !== "Hyperliquid") ||
    (market !== "perp" && market !== "spot")
  ) {
    return NextResponse.json({ error: "Invalid exchange/market" }, { status: 400 });
  }

  try {
    if (exchange === "Hyperliquid") {
      if (market !== "perp") {
        return NextResponse.json({ error: "Hyperliquid only supports perp" }, { status: 400 });
      }
      // symbols 用於補盤口（l2Book 逐一標的）；大小寫敏感，不做正規化
      const hlSymbols = (searchParams.get("symbols") ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      return NextResponse.json(await fetchHyperliquidTickers(hlSymbols));
    }
    if (exchange === "OKX") {
      return NextResponse.json(await fetchOKXTickers(market));
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
