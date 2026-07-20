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

    if (exchange.toLowerCase() === "okx") {
      const base = symbol.replace(/USDT$/i, "");
      const instId = `${base}-USDT-SWAP`;
      const url = `https://www.okx.com/api/v5/public/funding-rate?instId=${encodeURIComponent(instId)}`;
      const res = await fetch(url);
      if (!res.ok) return NextResponse.json(null);
      const data = await res.json();
      if (data.code !== "0" || !data.data?.length) return NextResponse.json(null);
      const item = data.data[0];
      const fundingTime = parseInt(item.fundingTime, 10);
      const nextFundingTime = parseInt(item.nextFundingTime, 10);
      return NextResponse.json({
        currentRate: parseFloat(item.fundingRate),
        nextFundingTime,
        // OKX 各幣種 funding interval 不一，用 nextFundingTime - fundingTime 換算，不寫死 8
        intervalHours: (nextFundingTime - fundingTime) / 3600000,
      });
    }

    if (exchange.toLowerCase() === "hyperliquid") {
      // symbol 為 HL 原生 coin 名（大小寫敏感，如 BTC、kPEPE），不做大小寫轉換
      // builder-deployed perp DEX 標的名為 `dex:TICKER`（如 mkts:TSLA），要帶對應 dex 參數
      const dex = symbol.includes(":") ? symbol.split(":")[0] : undefined;
      const res = await fetch("https://api.hyperliquid.xyz/info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(dex ? { type: "metaAndAssetCtxs", dex } : { type: "metaAndAssetCtxs" }),
      });
      if (!res.ok) return NextResponse.json(null);
      const data = await res.json();
      const universe = (data?.[0]?.universe ?? []) as { name: string }[];
      const assetCtxs = (data?.[1] ?? []) as { funding: string }[];
      const idx = universe.findIndex((u) => u.name === symbol);
      if (idx < 0 || !assetCtxs[idx]) return NextResponse.json(null);
      return NextResponse.json({
        currentRate: parseFloat(assetCtxs[idx].funding),
        // Hyperliquid 每小時整點結算
        nextFundingTime: Math.ceil(Date.now() / 3600000) * 3600000,
        intervalHours: 1,
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
