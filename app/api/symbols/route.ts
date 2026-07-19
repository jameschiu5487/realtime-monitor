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
        // TRADIFI_PERPETUAL = 美股等傳統資產的永續（TSLAUSDT、CRCLUSDT…）
        (market === "spot" ||
          s.contractType === "PERPETUAL" ||
          s.contractType === "TRADIFI_PERPETUAL")
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

// Binance 美股 perp（TRADIFI_PERPETUAL）專用清單，供 Alpaca 交集過濾
async function fetchBinanceEquityPerpSymbols(): Promise<string[]> {
  const response = await fetch("https://fapi.binance.com/fapi/v1/exchangeInfo", CACHE_1H);
  if (!response.ok) return [];
  const data = await response.json();
  return ((data.symbols ?? []) as { symbol: string; status: string; quoteAsset: string; contractType?: string }[])
    .filter(
      (s) =>
        s.status === "TRADING" && s.quoteAsset === "USDT" && s.contractType === "TRADIFI_PERPETUAL"
    )
    .map((s) => s.symbol);
}

async function fetchAlpacaSymbols(): Promise<string[]> {
  const key = process.env.ALPACA_API_KEY;
  const secret = process.env.ALPACA_API_SECRET;
  if (!key || !secret) {
    console.warn("[symbols] Alpaca API keys not configured");
    return [];
  }
  const headers = { "APCA-API-KEY-ID": key, "APCA-API-SECRET-KEY": secret };
  // paper 金鑰只認 paper-api 主機（live 金鑰認 api 主機），先 live 後 fallback
  let response = await fetch("https://api.alpaca.markets/v2/assets?status=active&asset_class=us_equity", {
    headers,
    ...CACHE_1H,
  });
  if (response.status === 401 || response.status === 403) {
    response = await fetch(
      "https://paper-api.alpaca.markets/v2/assets?status=active&asset_class=us_equity",
      { headers, ...CACHE_1H }
    );
  }
  if (!response.ok) {
    console.warn(`[symbols] Alpaca: HTTP ${response.status}`);
    return [];
  }
  const data = (await response.json()) as { symbol: string; tradable: boolean }[];
  return data
    .filter((a) => a.tradable)
    .map((a) => a.symbol)
    .sort();
}

// OKX 不在 Exchange 型別內，比照 Alpaca 用前置字串分流；instId -> canonical symbol
function okxInstIdToSymbol(instId: string): string {
  return instId.replace(/-SWAP$/, "").replace(/-/g, "");
}

async function fetchOKXSymbols(market: Market): Promise<string[]> {
  const instType = market === "perp" ? "SWAP" : "SPOT";
  const url = `https://www.okx.com/api/v5/public/instruments?instType=${instType}`;
  const response = await fetch(url, CACHE_1H);
  if (!response.ok) return [];
  const data = await response.json();
  if (data.code !== "0") return [];
  return ((data.data ?? []) as { instId: string; state: string; settleCcy?: string; quoteCcy?: string }[])
    .filter((i) =>
      i.state === "live" && (market === "perp" ? i.settleCcy === "USDT" : i.quoteCcy === "USDT")
    )
    .map((i) => okxInstIdToSymbol(i.instId))
    .sort();
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const exchange = searchParams.get("exchange");
  const market = (searchParams.get("market") ?? "perp") as Market;

  if (
    (exchange !== "Binance" && exchange !== "Bybit" && exchange !== "Alpaca" && exchange !== "OKX") ||
    (market !== "perp" && market !== "spot")
  ) {
    return NextResponse.json({ error: "Invalid exchange/market" }, { status: 400 });
  }
  if (exchange === "Alpaca" && market !== "spot") {
    return NextResponse.json({ error: "Alpaca only supports spot" }, { status: 400 });
  }

  try {
    if (exchange === "OKX") {
      return NextResponse.json(await fetchOKXSymbols(market));
    }
    if (exchange === "Alpaca") {
      // 只留在 Binance/Bybit 有對應「美股」標的的 ticker：
      // Binance 側只認 TRADIFI_PERPETUAL（`${ticker}USDT`，撞名 crypto 不會混入）
      // Bybit 側認 spot xStocks（`${ticker}XUSDT`）
      const [alpaca, binanceEquityPerp, bybitSpot] = await Promise.all([
        fetchAlpacaSymbols(),
        fetchBinanceEquityPerpSymbols(),
        fetchBybitSymbols("spot"),
      ]);
      const equitySymbols = new Set(binanceEquityPerp);
      const bybitSpotSet = new Set(bybitSpot);
      const filtered = alpaca.filter(
        (t) => equitySymbols.has(`${t}USDT`) || bybitSpotSet.has(`${t}XUSDT`)
      );
      return NextResponse.json(filtered);
    }
    const symbols =
      exchange === "Binance" ? await fetchBinanceSymbols(market) : await fetchBybitSymbols(market);
    return NextResponse.json(symbols);
  } catch (e) {
    console.error(`[symbols] ${exchange}/${market} error:`, e);
    return NextResponse.json([], { status: 200 });
  }
}
