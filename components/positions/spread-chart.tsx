"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface SpreadDataPoint {
  time: number; // timestamp in ms
  binancePrice: number;
  bybitPrice: number;
  spread: number; // basis points
  spreadPercent: number;
  ma?: number; // moving average of spread
  std?: number; // standard deviation
  upper1?: number; // MA + 1σ
  upper2?: number; // MA + 2σ
  upper3?: number; // MA + 3σ
  lower1?: number; // MA - 1σ
  lower2?: number; // MA - 2σ
  lower3?: number; // MA - 3σ
}

interface SpreadChartProps {
  symbol: string | null;
  entryTimes?: number[]; // timestamps in ms for entry points
  entrySpread?: number | null; // entry spread in basis points
  onSymbolClear?: () => void;
}

// Format price with appropriate decimals based on value
function formatPrice(price: number): string {
  if (price >= 1000) return price.toFixed(2);
  if (price >= 1) return price.toFixed(4);
  if (price >= 0.01) return price.toFixed(6);
  return price.toFixed(8);
}

// Custom tooltip component
function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number; name: string; dataKey: string }>; label?: number }) {
  if (!active || !payload || !payload.length) return null;

  const date = new Date(label || 0);
  const spreadData = payload.find((p) => p.dataKey === "spread");
  const maData = payload.find((p) => p.dataKey === "ma");
  const upper1Data = payload.find((p) => p.dataKey === "upper1");
  const lower1Data = payload.find((p) => p.dataKey === "lower1");
  const spread = spreadData?.value ?? 0;
  const ma = maData?.value;
  const upper1 = upper1Data?.value;
  const lower1 = lower1Data?.value;

  // Calculate std from upper1 and ma
  const std = ma !== undefined && upper1 !== undefined ? upper1 - ma : undefined;

  return (
    <div className="bg-background border rounded-lg shadow-lg p-3 text-sm">
      <div className="text-muted-foreground mb-2">
        {date.toLocaleString("en-US", {
          year: "numeric",
          month: "numeric",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })}
      </div>
      <div className={cn("font-bold", spread > 0 ? "text-emerald-600" : "text-red-600")}>
        Spread: {spread.toFixed(2)} bp
      </div>
      {ma !== undefined && ma !== null && (
        <div className="text-amber-500 font-medium mt-1">
          MA(1440): {ma.toFixed(2)} bp
        </div>
      )}
      {std !== undefined && std !== null && (
        <div className="text-purple-500 font-medium mt-1">
          σ: {std.toFixed(2)} bp
        </div>
      )}
      {upper1 !== undefined && lower1 !== undefined && (
        <div className="text-muted-foreground mt-1 text-xs">
          ±1σ: [{lower1.toFixed(2)}, {upper1.toFixed(2)}]
        </div>
      )}
    </div>
  );
}

// Convert symbol format (e.g., "BTCUSDT" -> "btcusdt")
function normalizeSymbol(symbol: string): string {
  return symbol.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Display 1 day of data = 1 * 24 * 60 = 1440 klines
const DISPLAY_KLINES = 1440;
// Fetch 2 days of data = 2 * 24 * 60 = 2880 klines (extra day for MA calculation)
const FETCH_KLINES = 2880;
// Moving average window = 1 day = 1440 minutes
const MA_WINDOW = 1440;

// Fetch kline data from Binance Futures (need 2 requests for 2880 klines)
async function fetchBinanceKlines(symbol: string, interval: string = "1m"): Promise<[number, number][]> {
  try {
    const allKlines: [number, number][] = [];
    let oldestTime = Date.now();

    // Binance has a max limit of 1500 per request, so we need 2 requests for 2880
    for (let i = 0; i < 2 && allKlines.length < FETCH_KLINES; i++) {
      const url = i === 0
        ? `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol.toUpperCase()}&interval=${interval}&limit=1500`
        : `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol.toUpperCase()}&interval=${interval}&limit=1500&endTime=${oldestTime - 1}`;

      console.log(`[SpreadChart] Fetching Binance klines (${i + 1}): ${url}`);
      const response = await fetch(url);
      if (!response.ok) {
        const text = await response.text();
        console.error(`[SpreadChart] Binance API error: ${response.status}`, text);
        break;
      }
      const data = await response.json();
      const klines: [number, number][] = data.map((k: (string | number)[]) => [Number(k[0]), parseFloat(k[4] as string)]);

      if (klines.length === 0) break;

      // Insert older klines at the beginning
      allKlines.unshift(...klines);
      oldestTime = klines[0][0];

      if (klines.length < 1500) break;
    }

    console.log(`[SpreadChart] Binance returned ${allKlines.length} klines total`);
    return allKlines;
  } catch (error) {
    console.error("[SpreadChart] Error fetching Binance klines:", error);
    return [];
  }
}

// Fetch kline data from Bybit (need 3 requests for 2880 klines)
async function fetchBybitKlines(symbol: string, interval: string = "1"): Promise<[number, number][]> {
  try {
    const allKlines: [number, number][] = [];
    let endTime = Date.now();

    // Bybit has a max limit of 1000 per request, so we need 3 requests for 2880
    for (let i = 0; i < 3 && allKlines.length < FETCH_KLINES; i++) {
      const url = `https://api.bybit.com/v5/market/kline?category=linear&symbol=${symbol.toUpperCase()}&interval=${interval}&limit=1000&end=${endTime}`;
      console.log(`[SpreadChart] Fetching Bybit klines (${i + 1}): ${url}`);
      const response = await fetch(url);
      if (!response.ok) {
        const text = await response.text();
        console.error(`[SpreadChart] Bybit API error: ${response.status}`, text);
        break;
      }
      const data = await response.json();

      if (data.retCode !== 0 || !data.result?.list?.length) {
        console.error(`[SpreadChart] Bybit returned error or no data:`, data);
        break;
      }

      // Bybit returns: [[startTime, open, high, low, close, volume, turnover], ...]
      const klines: [number, number][] = data.result.list.map((k: string[]) => [parseInt(k[0]), parseFloat(k[4])]);
      allKlines.push(...klines);

      // Get oldest timestamp for next request
      const oldestTime = Math.min(...klines.map((k) => k[0]));
      endTime = oldestTime - 1;

      if (klines.length < 1000) break; // No more data
    }

    console.log(`[SpreadChart] Bybit returned ${allKlines.length} klines total`);

    // Sort by time ascending (Bybit returns newest first)
    return allKlines.sort((a, b) => a[0] - b[0]);
  } catch (error) {
    console.error("[SpreadChart] Error fetching Bybit klines:", error);
    return [];
  }
}

// Merge Binance and Bybit klines and calculate spread (bybit - binance) with moving average
function mergeKlinesAndCalculateSpread(
  binanceKlines: [number, number][],
  bybitKlines: [number, number][]
): SpreadDataPoint[] {
  // Create maps for quick lookup
  const binanceMap = new Map(binanceKlines);
  const bybitMap = new Map(bybitKlines);

  // Get all unique timestamps
  const allTimestamps = new Set([
    ...binanceKlines.map((k) => k[0]),
    ...bybitKlines.map((k) => k[0]),
  ]);

  const result: SpreadDataPoint[] = [];
  let lastBinance = 0;
  let lastBybit = 0;

  // Sort timestamps
  const sortedTimestamps = Array.from(allTimestamps).sort((a, b) => a - b);

  for (const ts of sortedTimestamps) {
    const binancePrice = binanceMap.get(ts) ?? lastBinance;
    const bybitPrice = bybitMap.get(ts) ?? lastBybit;

    if (binancePrice > 0 && bybitPrice > 0) {
      lastBinance = binancePrice;
      lastBybit = bybitPrice;

      // Spread = Bybit - Binance
      const spread = bybitPrice - binancePrice;
      const spreadPercent = (spread / binancePrice) * 100;
      const spreadBps = spreadPercent * 100; // Convert to basis points

      result.push({
        time: ts,
        binancePrice,
        bybitPrice,
        spread: spreadBps,
        spreadPercent,
      });
    }
  }

  // Calculate moving average and standard deviation with window = MA_WINDOW (1440)
  for (let i = 0; i < result.length; i++) {
    if (i >= MA_WINDOW - 1) {
      // Calculate average of last MA_WINDOW points
      let sum = 0;
      for (let j = i - MA_WINDOW + 1; j <= i; j++) {
        sum += result[j].spread;
      }
      const ma = sum / MA_WINDOW;
      result[i].ma = ma;

      // Calculate standard deviation
      let sumSquaredDiff = 0;
      for (let j = i - MA_WINDOW + 1; j <= i; j++) {
        sumSquaredDiff += Math.pow(result[j].spread - ma, 2);
      }
      const std = Math.sqrt(sumSquaredDiff / MA_WINDOW);
      result[i].std = std;

      // Bollinger Bands
      result[i].upper1 = ma + std;
      result[i].upper2 = ma + 2 * std;
      result[i].upper3 = ma + 3 * std;
      result[i].lower1 = ma - std;
      result[i].lower2 = ma - 2 * std;
      result[i].lower3 = ma - 3 * std;
    }
  }

  // Only return the last 2 days (DISPLAY_KLINES) for chart display
  // The first day is only used for MA calculation
  if (result.length > DISPLAY_KLINES) {
    return result.slice(-DISPLAY_KLINES);
  }

  return result;
}

export function SpreadChart({ symbol, entryTimes = [], entrySpread = null, onSymbolClear }: SpreadChartProps) {
  const [data, setData] = useState<SpreadDataPoint[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [currentSpread, setCurrentSpread] = useState<number | null>(null);
  const [currentPrices, setCurrentPrices] = useState<{ binance: number; bybit: number } | null>(null);
  const binanceWsRef = useRef<WebSocket | null>(null);
  const bybitWsRef = useRef<WebSocket | null>(null);
  const latestPricesRef = useRef<{ binance: number; bybit: number }>({ binance: 0, bybit: 0 });

  // Filter entry times to only show those within the chart's data range
  const validEntryTimes = useMemo(() => {
    if (data.length === 0 || entryTimes.length === 0) return [];
    const minTime = data[0].time;
    const maxTime = data[data.length - 1].time;
    const filtered = entryTimes.filter((t) => t >= minTime && t <= maxTime);
    console.log(`[SpreadChart] Entry times: ${entryTimes.length}, valid (in range ${new Date(minTime).toISOString()} - ${new Date(maxTime).toISOString()}): ${filtered.length}`);
    if (filtered.length > 0) {
      console.log(`[SpreadChart] Entry time values:`, filtered.map(t => new Date(t).toISOString()));
    }
    return filtered;
  }, [data, entryTimes]);

  // Fetch historical data when symbol changes
  useEffect(() => {
    if (!symbol) {
      setData([]);
      setCurrentSpread(null);
      setCurrentPrices(null);
      return;
    }

    const fetchHistoricalData = async () => {
      setIsLoading(true);
      console.log(`[SpreadChart] Fetching historical data for ${symbol}`);

      const [binanceKlines, bybitKlines] = await Promise.all([
        fetchBinanceKlines(symbol),
        fetchBybitKlines(symbol),
      ]);

      console.log(`[SpreadChart] Got ${binanceKlines.length} Binance klines, ${bybitKlines.length} Bybit klines`);

      const mergedData = mergeKlinesAndCalculateSpread(binanceKlines, bybitKlines);
      console.log(`[SpreadChart] Merged into ${mergedData.length} data points`);

      setData(mergedData);

      if (mergedData.length > 0) {
        const latest = mergedData[mergedData.length - 1];
        setCurrentSpread(latest.spread);
        setCurrentPrices({ binance: latest.binancePrice, bybit: latest.bybitPrice });
        latestPricesRef.current = { binance: latest.binancePrice, bybit: latest.bybitPrice };
      }

      setIsLoading(false);
    };

    fetchHistoricalData();
  }, [symbol]);

  // Setup WebSocket connections for real-time updates
  useEffect(() => {
    if (!symbol) return;

    const normalizedSymbol = normalizeSymbol(symbol);

    // Binance WebSocket
    const binanceWs = new WebSocket(`wss://fstream.binance.com/ws/${normalizedSymbol}@kline_1m`);
    binanceWsRef.current = binanceWs;

    binanceWs.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.e === "kline" && msg.k) {
          const closePrice = parseFloat(msg.k.c);
          latestPricesRef.current.binance = closePrice;
          updateCurrentSpread();
        }
      } catch (error) {
        console.error("[SpreadChart] Binance WS parse error:", error);
      }
    };

    binanceWs.onerror = (error) => {
      console.error("[SpreadChart] Binance WS error:", error);
    };

    // Bybit WebSocket
    const bybitWs = new WebSocket("wss://stream.bybit.com/v5/public/linear");
    bybitWsRef.current = bybitWs;

    bybitWs.onopen = () => {
      // Subscribe to kline data
      bybitWs.send(JSON.stringify({
        op: "subscribe",
        args: [`kline.1.${symbol.toUpperCase()}`],
      }));
    };

    bybitWs.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.topic && msg.topic.startsWith("kline.") && msg.data) {
          const klineData = msg.data[0];
          if (klineData) {
            const closePrice = parseFloat(klineData.close);
            latestPricesRef.current.bybit = closePrice;
            updateCurrentSpread();
          }
        }
      } catch (error) {
        console.error("[SpreadChart] Bybit WS parse error:", error);
      }
    };

    bybitWs.onerror = (error) => {
      console.error("[SpreadChart] Bybit WS error:", error);
    };

    const updateCurrentSpread = () => {
      const { binance, bybit } = latestPricesRef.current;
      if (binance > 0 && bybit > 0) {
        // Spread = Bybit - Binance
        const spread = bybit - binance;
        const spreadBps = (spread / binance) * 100 * 100;

        // Update real-time display (every WebSocket message)
        setCurrentSpread(spreadBps);
        setCurrentPrices({ binance, bybit });

        // Add new chart data point only every 1 minute (to match kline interval)
        const now = Date.now();
        setData((prev) => {
          const lastTime = prev.length > 0 ? prev[prev.length - 1].time : 0;
          // 60 seconds = 60000ms
          if (now - lastTime >= 60000) {
            const newPoint: SpreadDataPoint = {
              time: now,
              binancePrice: binance,
              bybitPrice: bybit,
              spread: spreadBps,
              spreadPercent: (spread / binance) * 100,
            };

            // Calculate MA and Bollinger Bands for the new point
            // We need the last MA_WINDOW-1 points plus the new point
            const recentPoints = prev.slice(-(MA_WINDOW - 1));
            if (recentPoints.length >= MA_WINDOW - 1) {
              const allSpreads = [...recentPoints.map(p => p.spread), spreadBps];
              const sum = allSpreads.reduce((acc, s) => acc + s, 0);
              const ma = sum / MA_WINDOW;
              newPoint.ma = ma;

              // Calculate standard deviation
              const sumSquaredDiff = allSpreads.reduce((acc, s) => acc + Math.pow(s - ma, 2), 0);
              const std = Math.sqrt(sumSquaredDiff / MA_WINDOW);
              newPoint.std = std;

              // Bollinger Bands
              newPoint.upper1 = ma + std;
              newPoint.upper2 = ma + 2 * std;
              newPoint.upper3 = ma + 3 * std;
              newPoint.lower1 = ma - std;
              newPoint.lower2 = ma - 2 * std;
              newPoint.lower3 = ma - 3 * std;
            }

            // Keep last ~2 weeks of data
            const cutoff = now - 14 * 24 * 60 * 60 * 1000;
            return [...prev.filter((p) => p.time > cutoff), newPoint];
          }
          return prev;
        });
      }
    };

    return () => {
      if (binanceWsRef.current) {
        binanceWsRef.current.close();
        binanceWsRef.current = null;
      }
      if (bybitWsRef.current) {
        bybitWsRef.current.close();
        bybitWsRef.current = null;
      }
    };
  }, [symbol]);

  // Format data for chart (downsample if needed)
  const chartData = useMemo(() => {
    console.log(`[SpreadChart] Preparing chart data, raw data length: ${data.length}`);
    if (data.length > 0) {
      console.log(`[SpreadChart] Sample data point:`, data[0]);
    }
    if (data.length <= 2000) return data;

    // Downsample to ~2000 points
    const step = Math.ceil(data.length / 2000);
    const downsampled = data.filter((_, i) => i % step === 0);
    console.log(`[SpreadChart] Downsampled to ${downsampled.length} points`);
    return downsampled;
  }, [data]);

  // Calculate Y-axis domain (include spread, MA, and Bollinger Bands)
  const yDomain = useMemo(() => {
    if (chartData.length === 0) return [-10, 10];
    const allValues: number[] = [];
    chartData.forEach((d) => {
      allValues.push(d.spread);
      if (d.ma !== undefined) allValues.push(d.ma);
      if (d.upper3 !== undefined) allValues.push(d.upper3);
      if (d.lower3 !== undefined) allValues.push(d.lower3);
    });
    const min = Math.min(...allValues);
    const max = Math.max(...allValues);
    const padding = (max - min) * 0.1 || 5;
    return [Math.floor(min - padding), Math.ceil(max + padding)];
  }, [chartData]);

  if (!symbol) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>價差走勢圖</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex h-[300px] items-center justify-center text-muted-foreground">
            點擊上方持倉列表中的交易對查看價差走勢
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div className="flex items-center gap-3">
          <CardTitle>價差走勢圖</CardTitle>
          <Badge variant="outline" className="text-lg px-3 py-1">
            {symbol}
          </Badge>
          <span className="text-sm text-muted-foreground">(1天 / MA 1440)</span>
          {onSymbolClear && (
            <button
              onClick={onSymbolClear}
              className="text-muted-foreground hover:text-foreground text-sm"
            >
              ✕ 清除
            </button>
          )}
          {/* Legend */}
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
              <span className="text-muted-foreground">±1σ</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-0.5 bg-purple-300"></div>
              <span className="text-muted-foreground">±2σ</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-0.5 bg-purple-200"></div>
              <span className="text-muted-foreground">±3σ</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-0 border-l-2 border-dashed border-red-500"></div>
              <span className="text-muted-foreground">進場</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-4 text-sm">
          {currentPrices && (
            <>
              <div>
                <span className="text-muted-foreground">Binance: </span>
                <span className="font-mono">${formatPrice(currentPrices.binance)}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Bybit: </span>
                <span className="font-mono">${formatPrice(currentPrices.bybit)}</span>
              </div>
            </>
          )}
          {entrySpread !== null && (
            <div className="text-red-500">
              <span className="text-muted-foreground">進場: </span>
              <span className="font-mono font-medium">
                {entrySpread > 0 ? "+" : ""}{entrySpread.toFixed(2)} bp
              </span>
            </div>
          )}
          {currentSpread !== null && (
            <div className={cn(
              "font-bold text-lg",
              currentSpread > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
            )}>
              {currentSpread > 0 ? "+" : ""}{currentSpread.toFixed(2)} bp
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex h-[300px] items-center justify-center text-muted-foreground">
            載入歷史數據中...
          </div>
        ) : chartData.length === 0 ? (
          <div className="flex h-[300px] items-center justify-center text-muted-foreground">
            無可用數據
          </div>
        ) : (
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ left: 50, right: 20, top: 20, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis
                  dataKey="time"
                  type="number"
                  domain={["dataMin", "dataMax"]}
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  minTickGap={80}
                  tick={{ fontSize: 12, fill: "#888888" }}
                  tickFormatter={(value) => {
                    const date = new Date(value);
                    return date.toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    });
                  }}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  domain={yDomain}
                  tick={{ fontSize: 12, fill: "#888888" }}
                  tickFormatter={(value) => `${value}bp`}
                />
                <Tooltip content={<CustomTooltip />} />
                <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" />
                {/* Entry time vertical lines */}
                {validEntryTimes.map((time, idx) => (
                  <ReferenceLine
                    key={`entry-${idx}`}
                    x={time}
                    stroke="#ef4444"
                    strokeWidth={2}
                    ifOverflow="extendDomain"
                    label={{
                      value: "進場",
                      position: "insideTopRight",
                      fill: "#ef4444",
                      fontSize: 12,
                      fontWeight: "bold",
                    }}
                  />
                ))}
                {/* Bollinger Bands - 3σ (outermost, lightest) */}
                <Line
                  type="monotone"
                  dataKey="upper3"
                  name="+3σ"
                  stroke="#d8b4fe"
                  strokeWidth={1}
                  dot={false}
                  isAnimationActive={false}
                  connectNulls={false}
                />
                <Line
                  type="monotone"
                  dataKey="lower3"
                  name="-3σ"
                  stroke="#d8b4fe"
                  strokeWidth={1}
                  dot={false}
                  isAnimationActive={false}
                  connectNulls={false}
                />
                {/* Bollinger Bands - 2σ */}
                <Line
                  type="monotone"
                  dataKey="upper2"
                  name="+2σ"
                  stroke="#c084fc"
                  strokeWidth={1}
                  dot={false}
                  isAnimationActive={false}
                  connectNulls={false}
                />
                <Line
                  type="monotone"
                  dataKey="lower2"
                  name="-2σ"
                  stroke="#c084fc"
                  strokeWidth={1}
                  dot={false}
                  isAnimationActive={false}
                  connectNulls={false}
                />
                {/* Bollinger Bands - 1σ (innermost, darkest) */}
                <Line
                  type="monotone"
                  dataKey="upper1"
                  name="+1σ"
                  stroke="#a855f7"
                  strokeWidth={1}
                  dot={false}
                  isAnimationActive={false}
                  connectNulls={false}
                />
                <Line
                  type="monotone"
                  dataKey="lower1"
                  name="-1σ"
                  stroke="#a855f7"
                  strokeWidth={1}
                  dot={false}
                  isAnimationActive={false}
                  connectNulls={false}
                />
                {/* MA line */}
                <Line
                  type="monotone"
                  dataKey="ma"
                  name="MA(1440)"
                  stroke="#f59e0b"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                  connectNulls={false}
                />
                {/* Spread line (on top) */}
                <Line
                  type="monotone"
                  dataKey="spread"
                  name="Spread"
                  stroke="#3b82f6"
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
