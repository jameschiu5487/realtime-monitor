"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Exchange } from "@/lib/types/opportunity";
import { KLINE_CONFIGS, getKlineConfig } from "@/lib/kline-config";

interface DataPoint {
  time: number;
  exchangeAPrice: number;
  exchangeBPrice: number;
  spread: number;
  spreadPercent: number;
  ma?: number;
  std?: number;
  upper1?: number;
  upper2?: number;
  upper3?: number;
  lower1?: number;
  lower2?: number;
  lower3?: number;
  // Price Bollinger Bands (based on mid-price)
  midPrice?: number;
  priceMa?: number;
  priceUpper1?: number;
  priceUpper2?: number;
  priceUpper3?: number;
  priceLower1?: number;
  priceLower2?: number;
  priceLower3?: number;
}

interface FundingRateEntry {
  timestamp: number;
  rate: number;
  exchange: Exchange;
}

interface OpportunitySpreadModalProps {
  symbol: string | null;
  exchangeA: Exchange;
  exchangeB: Exchange;
}

// ── Constants ──────────────────────────────────────────────

// Config is now dynamic via KLINE_CONFIGS

const EXCHANGE_COLORS: Record<Exchange, string> = {
  Binance: "#eab308",
  Bybit: "#06b6d4",
  BingX: "#22c55e",
  Gate: "#3b82f6",
  Bitget: "#a855f7",
  Zoomex: "#f97316",
  BitMart: "#ec4899",
};

const EXCHANGE_TEXT_CLASSES: Record<Exchange, string> = {
  Binance: "text-yellow-500",
  Bybit: "text-cyan-500",
  BingX: "text-green-500",
  Gate: "text-blue-500",
  Bitget: "text-purple-500",
  Zoomex: "text-orange-500",
  BitMart: "text-pink-500",
};

// ── Helpers ────────────────────────────────────────────────

function formatPrice(price: number): string {
  if (price >= 1000) return price.toFixed(2);
  if (price >= 1) return price.toFixed(4);
  if (price >= 0.01) return price.toFixed(6);
  return price.toFixed(8);
}

function normalizeSymbol(symbol: string): string {
  return symbol.toLowerCase().replace(/[^a-z0-9]/g, "");
}

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

// ── Kline Fetcher (via server-side API proxy to avoid CORS) ──

async function fetchKlines(exchange: Exchange, symbol: string): Promise<[number, number][]> {
  try {
    const res = await fetch(`/api/klines?exchange=${encodeURIComponent(exchange)}&symbol=${encodeURIComponent(symbol)}`);
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

async function fetchFundingHistory(symbol: string, exchangeA: Exchange, exchangeB: Exchange): Promise<{ exchangeA: FundingRateEntry[]; exchangeB: FundingRateEntry[] }> {
  try {
    const url = `/api/funding-history?symbol=${encodeURIComponent(symbol)}&exchangeA=${encodeURIComponent(exchangeA)}&exchangeB=${encodeURIComponent(exchangeB)}`;
    console.log("[funding-history] fetching:", url);
    const res = await fetch(url);
    console.log("[funding-history] status:", res.status);
    if (!res.ok) {
      const text = await res.text();
      console.error("[funding-history] error response:", text);
      return { exchangeA: [], exchangeB: [] };
    }
    const data = await res.json();
    console.log("[funding-history] result:", { a: data.exchangeA?.length, b: data.exchangeB?.length });
    if (data._debug?.length) console.warn("[funding-history] server errors:", data._debug);
    return data;
  } catch (e) {
    console.error("[funding-history] fetch failed:", e);
    return { exchangeA: [], exchangeB: [] };
  }
}


// ── WebSocket Connectors ───────────────────────────────────

function connectExchangeWs(exchange: Exchange, symbol: string, onPrice: (price: number) => void): WebSocket | null {
  switch (exchange) {
    case "Binance": {
      const ws = new WebSocket(`wss://fstream.binance.com/ws/${normalizeSymbol(symbol)}@kline_1m`);
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.e === "kline" && msg.k) onPrice(parseFloat(msg.k.c));
        } catch {}
      };
      return ws;
    }
    case "Bybit": {
      const ws = new WebSocket("wss://stream.bybit.com/v5/public/linear");
      ws.onopen = () => {
        ws.send(JSON.stringify({ op: "subscribe", args: [`kline.1.${symbol.toUpperCase()}`] }));
      };
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.topic?.startsWith("kline.") && msg.data?.[0]) onPrice(parseFloat(msg.data[0].close));
        } catch {}
      };
      return ws;
    }
    case "Gate": {
      const fmtSymbol = formatExchangeSymbol(symbol, "Gate");
      const ws = new WebSocket("wss://fx-ws.gateio.ws/v4/ws/usdt");
      ws.onopen = () => {
        ws.send(JSON.stringify({ time: Math.floor(Date.now() / 1000), channel: "futures.candlesticks", event: "subscribe", payload: ["1m", fmtSymbol] }));
      };
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.channel === "futures.candlesticks" && msg.event === "update" && msg.result?.[0]) onPrice(parseFloat(msg.result[0].c));
        } catch {}
      };
      return ws;
    }
    case "Bitget": {
      const ws = new WebSocket("wss://ws.bitget.com/v2/ws/public");
      ws.onopen = () => {
        ws.send(JSON.stringify({ op: "subscribe", args: [{ instType: "USDT-FUTURES", channel: "candle1m", instId: symbol.toUpperCase() }] }));
      };
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if ((msg.action === "snapshot" || msg.action === "update") && msg.data?.[0]?.[4]) onPrice(parseFloat(msg.data[0][4]));
        } catch {}
      };
      return ws;
    }
    default:
      return null;
  }
}

// ── Merge & Calculate ──────────────────────────────────────

function mergeKlinesAndCalculateSpread(klinesA: [number, number][], klinesB: [number, number][], displayKlines: number, maWindow: number): DataPoint[] {
  const mapA = new Map(klinesA);
  const mapB = new Map(klinesB);
  const allTimestamps = new Set([...klinesA.map((k) => k[0]), ...klinesB.map((k) => k[0])]);

  const result: DataPoint[] = [];
  let lastA = 0;
  let lastB = 0;
  const sortedTimestamps = Array.from(allTimestamps).sort((a, b) => a - b);

  for (const ts of sortedTimestamps) {
    const priceA = mapA.get(ts) ?? lastA;
    const priceB = mapB.get(ts) ?? lastB;

    if (priceA > 0 && priceB > 0) {
      lastA = priceA;
      lastB = priceB;

      const spread = priceB - priceA;
      const spreadPercent = (spread / priceA) * 100;
      const spreadBps = spreadPercent * 100;

      result.push({ time: ts, exchangeAPrice: priceA, exchangeBPrice: priceB, midPrice: (priceA + priceB) / 2, spread: spreadBps, spreadPercent });
    }
  }

  // Calculate MA and Bollinger Bands
  for (let i = 0; i < result.length; i++) {
    if (i >= maWindow - 1) {
      let sum = 0;
      for (let j = i - maWindow + 1; j <= i; j++) sum += result[j].spread;
      const ma = sum / maWindow;
      result[i].ma = ma;

      let sumSquaredDiff = 0;
      for (let j = i - maWindow + 1; j <= i; j++) sumSquaredDiff += Math.pow(result[j].spread - ma, 2);
      const std = Math.sqrt(sumSquaredDiff / maWindow);
      result[i].std = std;
      result[i].upper1 = ma + std;
      result[i].upper2 = ma + 2 * std;
      result[i].upper3 = ma + 3 * std;
      result[i].lower1 = ma - std;
      result[i].lower2 = ma - 2 * std;
      result[i].lower3 = ma - 3 * std;

      // Price Bollinger Bands (based on mid-price)
      let priceSum = 0;
      for (let j = i - maWindow + 1; j <= i; j++) priceSum += result[j].midPrice!;
      const priceMa = priceSum / maWindow;
      result[i].priceMa = priceMa;

      let priceSumSqDiff = 0;
      for (let j = i - maWindow + 1; j <= i; j++) priceSumSqDiff += Math.pow(result[j].midPrice! - priceMa, 2);
      const priceStd = Math.sqrt(priceSumSqDiff / maWindow);
      result[i].priceUpper1 = priceMa + priceStd;
      result[i].priceUpper2 = priceMa + 2 * priceStd;
      result[i].priceUpper3 = priceMa + 3 * priceStd;
      result[i].priceLower1 = priceMa - priceStd;
      result[i].priceLower2 = priceMa - 2 * priceStd;
      result[i].priceLower3 = priceMa - 3 * priceStd;
    }
  }

  return result.length > displayKlines ? result.slice(-displayKlines) : result;
}

// ── Component ──────────────────────────────────────────────

export function OpportunitySpreadModal({ symbol, exchangeA, exchangeB }: OpportunitySpreadModalProps) {
  const [data, setData] = useState<DataPoint[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedDays, setSelectedDays] = useState(1);
  const [currentSpread, setCurrentSpread] = useState<number | null>(null);
  const [currentPrices, setCurrentPrices] = useState<{ a: number; b: number } | null>(null);
  const [fundingRates, setFundingRates] = useState<{ exchangeA: FundingRateEntry[]; exchangeB: FundingRateEntry[] }>({ exchangeA: [], exchangeB: [] });
  const wsARef = useRef<WebSocket | null>(null);
  const wsBRef = useRef<WebSocket | null>(null);
  const latestPricesRef = useRef<{ a: number; b: number }>({ a: 0, b: 0 });

  const config = getKlineConfig(selectedDays);
  const colorA = EXCHANGE_COLORS[exchangeA];
  const colorB = EXCHANGE_COLORS[exchangeB];
  const textClassA = EXCHANGE_TEXT_CLASSES[exchangeA];
  const textClassB = EXCHANGE_TEXT_CLASSES[exchangeB];

  // Fetch historical data
  useEffect(() => {
    if (!symbol) {
      setData([]);
      return;
    }

    let cancelled = false;

    const fetchData = async () => {
      setIsLoading(true);
      const daysParam = selectedDays > 1 ? `&days=${selectedDays}` : "";
      const [klinesA, klinesB] = await Promise.all([
        fetch(`/api/klines?exchange=${encodeURIComponent(exchangeA)}&symbol=${encodeURIComponent(symbol)}${daysParam}`).then(r => r.ok ? r.json() : []).catch(() => []) as Promise<[number, number][]>,
        fetch(`/api/klines?exchange=${encodeURIComponent(exchangeB)}&symbol=${encodeURIComponent(symbol)}${daysParam}`).then(r => r.ok ? r.json() : []).catch(() => []) as Promise<[number, number][]>,
      ]);
      if (cancelled) return;
      const mergedData = mergeKlinesAndCalculateSpread(klinesA, klinesB, config.displayKlines, config.maWindow);
      setData(mergedData);

      if (mergedData.length > 0) {
        const latest = mergedData[mergedData.length - 1];
        setCurrentSpread(latest.spread);
        setCurrentPrices({ a: latest.exchangeAPrice, b: latest.exchangeBPrice });
        latestPricesRef.current = { a: latest.exchangeAPrice, b: latest.exchangeBPrice };
      }
      setIsLoading(false);
    };

    fetchData();

    // Fetch funding history independently (non-blocking)
    fetchFundingHistory(symbol, exchangeA, exchangeB).then((history) => {
      if (!cancelled) setFundingRates(history);
    });

    return () => { cancelled = true; };
  }, [symbol, exchangeA, exchangeB, selectedDays, config]);

  // WebSocket for real-time updates (deferred to avoid Strict Mode double-mount warnings)
  useEffect(() => {
    if (!symbol) return;

    let cancelled = false;
    let wsA: WebSocket | null = null;
    let wsB: WebSocket | null = null;

    const updateCurrentSpread = () => {
      if (cancelled) return;
      const { a, b } = latestPricesRef.current;
      if (a > 0 && b > 0) {
        const spread = b - a;
        const spreadBps = (spread / a) * 100 * 100;
        setCurrentSpread(spreadBps);
        setCurrentPrices({ a, b });
      }
    };

    // Defer WebSocket creation so Strict Mode cleanup can cancel before connections open
    const timerId = setTimeout(() => {
      if (cancelled) return;

      wsA = connectExchangeWs(exchangeA, symbol, (price) => {
        latestPricesRef.current.a = price;
        updateCurrentSpread();
      });
      wsARef.current = wsA;

      wsB = connectExchangeWs(exchangeB, symbol, (price) => {
        latestPricesRef.current.b = price;
        updateCurrentSpread();
      });
      wsBRef.current = wsB;
    }, 100);

    return () => {
      cancelled = true;
      clearTimeout(timerId);
      if (wsA) { wsA.onmessage = null; wsA.onopen = null; wsA.close(); }
      if (wsB) { wsB.onmessage = null; wsB.onopen = null; wsB.close(); }
    };
  }, [symbol, exchangeA, exchangeB]);

  const chartData = useMemo(() => {
    if (data.length <= 2000) return data;
    const step = Math.ceil(data.length / 2000);
    return data.filter((_, i) => i % step === 0);
  }, [data]);

  const spreadYDomain = useMemo(() => {
    if (chartData.length === 0) return [-10, 10];
    const allValues: number[] = [];
    chartData.forEach((d) => {
      allValues.push(d.spread);
      if (d.upper3 !== undefined) allValues.push(d.upper3);
      if (d.lower3 !== undefined) allValues.push(d.lower3);
    });
    const min = Math.min(...allValues);
    const max = Math.max(...allValues);
    const padding = (max - min) * 0.1 || 5;
    return [Math.floor(min - padding), Math.ceil(max + padding)];
  }, [chartData]);

  // Filter and group funding rates within chart time range
  const groupedFundingRates = useMemo(() => {
    if (chartData.length === 0) return [];
    const minTime = chartData[0].time;
    const maxTime = chartData[chartData.length - 1].time;

    const allRates: { timestamp: number; exchange: Exchange; rateBps: string }[] = [];

    for (const entry of fundingRates.exchangeA) {
      if (entry.timestamp >= minTime && entry.timestamp <= maxTime) {
        allRates.push({ timestamp: entry.timestamp, exchange: exchangeA, rateBps: (entry.rate * 100 * 100).toFixed(2) });
      }
    }
    for (const entry of fundingRates.exchangeB) {
      if (entry.timestamp >= minTime && entry.timestamp <= maxTime) {
        allRates.push({ timestamp: entry.timestamp, exchange: exchangeB, rateBps: (entry.rate * 100 * 100).toFixed(2) });
      }
    }

    allRates.sort((a, b) => a.timestamp - b.timestamp);

    // Group events within 30 minutes of each other
    const MERGE_THRESHOLD_MS = 30 * 60 * 1000;
    const groups: { timestamp: number; lines: string[] }[] = [];

    for (const rate of allRates) {
      const last = groups[groups.length - 1];
      if (last && Math.abs(rate.timestamp - last.timestamp) < MERGE_THRESHOLD_MS) {
        last.lines.push(`${rate.exchange} ${rate.rateBps}bp`);
      } else {
        groups.push({ timestamp: rate.timestamp, lines: [`${rate.exchange} ${rate.rateBps}bp`] });
      }
    }

    return groups;
  }, [chartData, fundingRates, exchangeA, exchangeB]);

  const priceYDomain = useMemo(() => {
    if (chartData.length === 0) return [0, 100];
    const allPrices: number[] = [];
    chartData.forEach((d) => {
      allPrices.push(d.exchangeAPrice, d.exchangeBPrice);
      if (d.priceUpper3 !== undefined) allPrices.push(d.priceUpper3);
      if (d.priceLower3 !== undefined) allPrices.push(d.priceLower3);
    });
    const min = Math.min(...allPrices);
    const max = Math.max(...allPrices);
    const padding = (max - min) * 0.05 || 1;
    return [min - padding, max + padding];
  }, [chartData]);

  // Tooltip components (defined inside to access exchange names)
  function SpreadTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number; dataKey: string }>; label?: number }) {
    if (!active || !payload || !payload.length) return null;
    const ts = label || 0;
    const date = new Date(ts);
    const spreadData = payload.find((p) => p.dataKey === "spread");
    const maData = payload.find((p) => p.dataKey === "ma");
    const spread = spreadData?.value ?? 0;
    const ma = maData?.value;

    // Find the next upcoming funding event (ts falls in the interval leading up to it)
    const nextFunding = groupedFundingRates.find((g) => g.timestamp >= ts);

    return (
      <div className="bg-background border rounded-lg shadow-lg p-3 text-sm">
        <div className="text-muted-foreground mb-2">
          {date.toLocaleString("en-US", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
        </div>
        <div className={cn("font-bold", spread > 0 ? "text-emerald-600" : "text-red-600")}>
          Spread: {spread.toFixed(2)} bp
        </div>
        {ma !== undefined && <div className="text-amber-500 mt-1">MA: {ma.toFixed(2)} bp</div>}
        {nextFunding && (
          <div className="mt-2 pt-2 border-t border-red-500/30">
            {nextFunding.lines.map((line, i) => (
              <div key={i} className="text-red-400 text-xs">{line}</div>
            ))}
          </div>
        )}
      </div>
    );
  }

  function PriceTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number; dataKey: string }>; label?: number }) {
    if (!active || !payload || !payload.length) return null;
    const ts = label || 0;
    const date = new Date(ts);
    const dataA = payload.find((p) => p.dataKey === "exchangeAPrice");
    const dataB = payload.find((p) => p.dataKey === "exchangeBPrice");
    const priceMaData = payload.find((p) => p.dataKey === "priceMa");
    const priceUpper1Data = payload.find((p) => p.dataKey === "priceUpper1");
    const priceMa = priceMaData?.value;
    const priceStd = priceMa !== undefined && priceUpper1Data?.value !== undefined ? priceUpper1Data.value - priceMa : undefined;

    const nextFunding = groupedFundingRates.find((g) => g.timestamp >= ts);

    return (
      <div className="bg-background border rounded-lg shadow-lg p-3 text-sm">
        <div className="text-muted-foreground mb-2">
          {date.toLocaleString("en-US", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
        </div>
        {dataA && (
          <div className={textClassA}>
            {exchangeA}: ${formatPrice(dataA.value)}
          </div>
        )}
        {dataB && (
          <div className={textClassB}>
            {exchangeB}: ${formatPrice(dataB.value)}
          </div>
        )}
        {priceMa !== undefined && (
          <div className="text-amber-500 mt-1">MA(1D): ${formatPrice(priceMa)}</div>
        )}
        {priceStd !== undefined && (
          <div className="text-purple-500 mt-1 text-xs">
            &sigma;: ${formatPrice(priceStd)}
          </div>
        )}
        {nextFunding && (
          <div className="mt-2 pt-2 border-t border-red-500/30">
            {nextFunding.lines.map((line, i) => (
              <div key={i} className="text-red-400 text-xs">{line}</div>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (!symbol) return null;

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Loading historical data...
      </div>
    );
  }

  if (chartData.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        No data available
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full gap-4">
      {/* Header with current values */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Badge variant="outline" className="text-lg px-3 py-1">
            {symbol}
          </Badge>
          <div className="flex items-center gap-1">
            {KLINE_CONFIGS.map((c) => (
              <Button
                key={c.days}
                variant={selectedDays === c.days ? "default" : "outline"}
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={() => setSelectedDays(c.days)}
              >
                {c.label}
              </Button>
            ))}
          </div>
          <div className="flex items-center gap-3 ml-4 text-xs">
            <div className="flex items-center gap-1">
              <div className="w-3 h-0.5 bg-blue-500"></div>
              <span className="text-muted-foreground">Spread</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-0.5 bg-amber-500"></div>
              <span className="text-muted-foreground">MA</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-0.5 bg-purple-400"></div>
              <span className="text-muted-foreground">&plusmn;1&sigma;</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-0.5 bg-red-500" style={{ borderTop: "1px dashed #ef4444" }}></div>
              <span className="text-muted-foreground">Funding</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-4 text-sm">
          {currentPrices && (
            <>
              <div>
                <span className={textClassA}>{exchangeA}: </span>
                <span className="font-mono">${formatPrice(currentPrices.a)}</span>
              </div>
              <div>
                <span className={textClassB}>{exchangeB}: </span>
                <span className="font-mono">${formatPrice(currentPrices.b)}</span>
              </div>
            </>
          )}
          {currentSpread !== null && (
            <div className={cn("font-bold text-lg", currentSpread > 0 ? "text-emerald-500" : "text-red-500")}>
              {currentSpread > 0 ? "+" : ""}
              {currentSpread.toFixed(2)} bp
            </div>
          )}
        </div>
      </div>

      {/* Spread Chart */}
      <div className="flex-1 min-h-0">
        <div className="text-sm text-muted-foreground mb-1">
          Spread ({exchangeB} - {exchangeA})
        </div>
        <div className="h-[calc(100%-20px)]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ left: 50, right: 20, top: 10, bottom: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis
                dataKey="time"
                type="number"
                domain={["dataMin", "dataMax"]}
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={100}
                tick={{ fontSize: 11, fill: "#888888" }}
                tickFormatter={(value) => {
                  const date = new Date(value);
                  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
                }}
              />
              <YAxis tickLine={false} axisLine={false} tickMargin={8} domain={spreadYDomain} tick={{ fontSize: 11, fill: "#888888" }} tickFormatter={(value) => `${value}bp`} />
              <Tooltip content={<SpreadTooltip />} />
              <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" />
              {groupedFundingRates.map((group, idx) => (
                <ReferenceLine
                  key={`funding-spread-${idx}`}
                  x={group.timestamp}
                  stroke="#ef4444"
                  strokeWidth={1}
                  strokeDasharray="4 2"
                />
              ))}
              <Line type="monotone" dataKey="upper3" stroke="#d8b4fe" strokeWidth={1} dot={false} isAnimationActive={false} connectNulls={false} />
              <Line type="monotone" dataKey="lower3" stroke="#d8b4fe" strokeWidth={1} dot={false} isAnimationActive={false} connectNulls={false} />
              <Line type="monotone" dataKey="upper2" stroke="#c084fc" strokeWidth={1} dot={false} isAnimationActive={false} connectNulls={false} />
              <Line type="monotone" dataKey="lower2" stroke="#c084fc" strokeWidth={1} dot={false} isAnimationActive={false} connectNulls={false} />
              <Line type="monotone" dataKey="upper1" stroke="#a855f7" strokeWidth={1} dot={false} isAnimationActive={false} connectNulls={false} />
              <Line type="monotone" dataKey="lower1" stroke="#a855f7" strokeWidth={1} dot={false} isAnimationActive={false} connectNulls={false} />
              <Line type="monotone" dataKey="ma" stroke="#f59e0b" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls={false} />
              <Line type="monotone" dataKey="spread" stroke="#3b82f6" strokeWidth={1.5} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Price Chart */}
      <div className="flex-1 min-h-0">
        <div className="flex items-center gap-3 text-sm mb-1">
          <span className="text-muted-foreground">Price</span>
          <div className="flex items-center gap-2 text-xs">
            <div className="flex items-center gap-1">
              <div className="w-3 h-0.5 bg-amber-500"></div>
              <span className="text-muted-foreground">MA(1D)</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-0.5 bg-purple-400"></div>
              <span className="text-muted-foreground">&plusmn;1&sigma;</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-0.5 bg-purple-300"></div>
              <span className="text-muted-foreground">&plusmn;2&sigma;</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-0.5 bg-purple-200"></div>
              <span className="text-muted-foreground">&plusmn;3&sigma;</span>
            </div>
          </div>
        </div>
        <div className="h-[calc(100%-20px)]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ left: 50, right: 20, top: 10, bottom: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis
                dataKey="time"
                type="number"
                domain={["dataMin", "dataMax"]}
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={100}
                tick={{ fontSize: 11, fill: "#888888" }}
                tickFormatter={(value) => {
                  const date = new Date(value);
                  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
                }}
              />
              <YAxis tickLine={false} axisLine={false} tickMargin={8} domain={priceYDomain} tick={{ fontSize: 11, fill: "#888888" }} tickFormatter={(value) => `$${formatPrice(value)}`} />
              <Tooltip content={<PriceTooltip />} />
              {groupedFundingRates.map((group, idx) => (
                <ReferenceLine
                  key={`funding-price-${idx}`}
                  x={group.timestamp}
                  stroke="#ef4444"
                  strokeWidth={1}
                  strokeDasharray="4 2"
                />
              ))}
              {/* Price Bollinger Bands - 3σ */}
              <Line type="monotone" dataKey="priceUpper3" stroke="#d8b4fe" strokeWidth={1} dot={false} isAnimationActive={false} connectNulls={false} />
              <Line type="monotone" dataKey="priceLower3" stroke="#d8b4fe" strokeWidth={1} dot={false} isAnimationActive={false} connectNulls={false} />
              {/* Price Bollinger Bands - 2σ */}
              <Line type="monotone" dataKey="priceUpper2" stroke="#c084fc" strokeWidth={1} dot={false} isAnimationActive={false} connectNulls={false} />
              <Line type="monotone" dataKey="priceLower2" stroke="#c084fc" strokeWidth={1} dot={false} isAnimationActive={false} connectNulls={false} />
              {/* Price Bollinger Bands - 1σ */}
              <Line type="monotone" dataKey="priceUpper1" stroke="#a855f7" strokeWidth={1} dot={false} isAnimationActive={false} connectNulls={false} />
              <Line type="monotone" dataKey="priceLower1" stroke="#a855f7" strokeWidth={1} dot={false} isAnimationActive={false} connectNulls={false} />
              {/* Price MA */}
              <Line type="monotone" dataKey="priceMa" stroke="#f59e0b" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls={false} />
              {/* Exchange prices */}
              <Line type="monotone" dataKey="exchangeAPrice" name={exchangeA} stroke={colorA} strokeWidth={1.5} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="exchangeBPrice" name={exchangeB} stroke={colorB} strokeWidth={1.5} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
