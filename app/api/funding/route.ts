import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";
export const preferredRegion = ["sin1", "hkg1", "kix1"];

export async function GET(request: NextRequest) {
  const exchange = request.nextUrl.searchParams.get("exchange");
  const symbol = request.nextUrl.searchParams.get("symbol");

  if (!exchange || !symbol) {
    return NextResponse.json({ error: "Missing exchange/symbol" }, { status: 400 });
  }

  try {
    if (exchange.toLowerCase() === "binance") {
      const url = `https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${symbol.toUpperCase()}`;
      const res = await fetch(url);
      if (!res.ok) return NextResponse.json(null);
      const data = await res.json();
      return NextResponse.json({
        currentRate: parseFloat(data.lastFundingRate),
        nextFundingTime: data.nextFundingTime,
        intervalHours: 8,
      });
    }

    if (exchange.toLowerCase() === "bybit" || exchange.toLowerCase() === "zoomex") {
      const baseUrl = exchange.toLowerCase() === "zoomex"
        ? "https://api.zoomex.com"
        : "https://api.bybit.com";
      const url = `${baseUrl}/v5/market/tickers?category=linear&symbol=${symbol.toUpperCase()}`;
      const res = await fetch(url);
      if (!res.ok) return NextResponse.json(null);
      const data = await res.json();
      if (data.retCode !== 0 || !data.result?.list?.length) return NextResponse.json(null);
      const ticker = data.result.list[0];
      return NextResponse.json({
        currentRate: parseFloat(ticker.fundingRate),
        nextFundingTime: parseInt(ticker.nextFundingTime),
        intervalHours: parseInt(ticker.fundingIntervalHour) || 8,
      });
    }

    return NextResponse.json(null);
  } catch (e) {
    console.error(`[funding] ${exchange}/${symbol} error:`, e);
    return NextResponse.json(null);
  }
}
