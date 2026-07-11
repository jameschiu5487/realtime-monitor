import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";
export const preferredRegion = ["sin1", "hkg1", "kix1"];

// 交易所 symbol 清單變動極少，underlying fetch cache 1 小時
const CACHE_1H = { next: { revalidate: 3600 } };

type Market = "perp" | "spot";

async function fetchBinanceSymbols(market: Market): Promise<string[]> {
  const url =
    market === "perp"
      ? "https://fapi.binance.com/fapi/v1/exchangeInfo"
      : "https://api.binance.com/api/v3/exchangeInfo";
  const response = await fetch(url, CACHE_1H);
  if (!response.ok) return [];
  const data = await response.json();
  return ((data.symbols ?? []) as { symbol: string; status: string; quoteAsset: string; contractType?: string }[])
    .filter(
      (s) =>
        s.status === "TRADING" &&
        s.quoteAsset === "USDT" &&
        (market === "spot" || s.contractType === "PERPETUAL")
    )
    .map((s) => s.symbol)
    .sort();
}

async function fetchBybitSymbols(market: Market): Promise<string[]> {
  const category = market === "perp" ? "linear" : "spot";
  const symbols: string[] = [];
  let cursor = "";
  const MAX_PAGES = 20;
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = `https://api.bybit.com/v5/market/instruments-info?category=${category}&limit=1000${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    // cursor 頁不可快取：快取的第一頁可能回傳過期 cursor，後續頁會靜默失敗
    const response = await fetch(url, cursor ? { cache: "no-store" } : CACHE_1H);
    if (!response.ok) break;
    const data = await response.json();
    if (data.retCode !== 0) break;
    for (const item of (data.result?.list ?? []) as {
      symbol: string;
      status: string;
      quoteCoin: string;
      contractType?: string;
    }[]) {
      if (
        item.status === "Trading" &&
        item.quoteCoin === "USDT" &&
        (market === "spot" || item.contractType === "LinearPerpetual")
      ) {
        symbols.push(item.symbol);
      }
    }
    cursor = data.result?.nextPageCursor ?? "";
    if (!cursor) break;
  }
  return symbols.sort();
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
    const symbols =
      exchange === "Binance" ? await fetchBinanceSymbols(market) : await fetchBybitSymbols(market);
    return NextResponse.json(symbols);
  } catch (e) {
    console.error(`[symbols] ${exchange}/${market} error:`, e);
    return NextResponse.json([], { status: 200 });
  }
}
