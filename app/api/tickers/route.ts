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

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const exchange = searchParams.get("exchange");
  const market = (searchParams.get("market") ?? "perp") as Market;

  if (
    (exchange !== "Binance" && exchange !== "Bybit") ||
    (market !== "perp" && market !== "spot")
  ) {
    return NextResponse.json({ error: "Invalid exchange/market" }, { status: 400 });
  }

  try {
    const tickers =
      exchange === "Binance" ? await fetchBinanceTickers(market) : await fetchBybitTickers(market);
    return NextResponse.json(tickers);
  } catch (e) {
    console.error(`[tickers] ${exchange}/${market} error:`, e);
    return NextResponse.json({}, { status: 200 });
  }
}
