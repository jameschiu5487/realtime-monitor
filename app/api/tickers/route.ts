import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";
export const preferredRegion = ["sin1", "hkg1", "kix1"];

type Market = "perp" | "spot";

async function fetchBinanceTickers(market: Market): Promise<Record<string, number>> {
  const url =
    market === "perp"
      ? "https://fapi.binance.com/fapi/v1/ticker/price"
      : "https://api.binance.com/api/v3/ticker/price";
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) return {};
  const data = (await response.json()) as { symbol: string; price: string }[];
  const map: Record<string, number> = {};
  for (const t of data) map[t.symbol] = parseFloat(t.price);
  return map;
}

async function fetchBybitTickers(market: Market): Promise<Record<string, number>> {
  const category = market === "perp" ? "linear" : "spot";
  const url = `https://api.bybit.com/v5/market/tickers?category=${category}`;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) return {};
  const data = await response.json();
  if (data.retCode !== 0) return {};
  const map: Record<string, number> = {};
  for (const t of (data.result?.list ?? []) as { symbol: string; lastPrice: string }[]) {
    map[t.symbol] = parseFloat(t.lastPrice);
  }
  return map;
}

// Alpaca 沒有全量 ticker 端點，需帶 symbols（逗號分隔，上限 100）查最新成交價
async function fetchAlpacaTickers(symbols: string[]): Promise<Record<string, number>> {
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
  const map: Record<string, number> = {};
  for (const [sym, trade] of Object.entries((data.trades ?? {}) as Record<string, { p: number }>)) {
    map[sym] = trade.p;
  }
  return map;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const exchange = searchParams.get("exchange");
  const market = (searchParams.get("market") ?? "perp") as Market;

  if (
    (exchange !== "Binance" && exchange !== "Bybit" && exchange !== "Alpaca") ||
    (market !== "perp" && market !== "spot")
  ) {
    return NextResponse.json({ error: "Invalid exchange/market" }, { status: 400 });
  }

  try {
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
