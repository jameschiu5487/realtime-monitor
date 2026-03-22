"use client";

import { useMemo } from "react";
import { Line, LineChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { cn } from "@/lib/utils";
import type { PolymarketSymbolPnl } from "@/lib/types/database";

const SYMBOL_COLORS: Record<string, string> = {
  BTC: "#f7931a",
  ETH: "#627eea",
  SOL: "#9945ff",
  XRP: "#23292f",
  BNB: "#f3ba2f",
  DOGE: "#c3a634",
};

function getColor(symbol: string): string {
  return SYMBOL_COLORS[symbol] ?? "#6366f1";
}

interface PolymarketSymbolPnlChartProps {
  symbolPnlData: PolymarketSymbolPnl[];
  latestSymbolPnl: PolymarketSymbolPnl[];
  initialCapital: number;
}

export function PolymarketSymbolPnlChart({
  symbolPnlData,
  latestSymbolPnl,
  initialCapital,
}: PolymarketSymbolPnlChartProps) {
  // Build time series with one line per symbol
  const { chartData, symbols } = useMemo(() => {
    if (symbolPnlData.length === 0) return { chartData: [], symbols: [] };

    const allSymbols = [...new Set(symbolPnlData.map((d) => d.symbol))];

    // Group by timestamp
    const byTime = new Map<string, Record<string, number>>();
    for (const d of symbolPnlData) {
      if (!byTime.has(d.ts)) {
        byTime.set(d.ts, {});
      }
      const point = byTime.get(d.ts)!;
      point[d.symbol] = initialCapital > 0 ? (d.cumulative_pnl / initialCapital) * 100 : 0;
    }

    // Convert to array sorted by time
    const data: Record<string, string | number>[] = Array.from(byTime.entries())
      .sort(([a], [b]) => new Date(a).getTime() - new Date(b).getTime())
      .map(([time, values]) => ({
        time,
        ...values,
      }));

    return { chartData: data, symbols: allSymbols };
  }, [symbolPnlData, initialCapital]);

  // Chart config
  const chartConfig = useMemo(() => {
    const config: ChartConfig = {};
    for (const symbol of symbols) {
      config[symbol] = { label: symbol, color: getColor(symbol) };
    }
    return config;
  }, [symbols]);

  // Y-axis domain
  const { yMin, yMax } = useMemo(() => {
    if (chartData.length === 0) return { yMin: -1, yMax: 1 };
    let min = 0, max = 0;
    for (const point of chartData) {
      for (const symbol of symbols) {
        const val = point[symbol] as number | undefined;
        if (val !== undefined) {
          min = Math.min(min, val);
          max = Math.max(max, val);
        }
      }
    }
    const pad = Math.max(Math.abs(max), Math.abs(min)) * 0.1 || 0.5;
    return { yMin: min - pad, yMax: max + pad };
  }, [chartData, symbols]);

  return (
    <Card>
      <CardHeader className="border-b px-4 py-3 sm:px-6 sm:py-4">
        <CardTitle className="text-base sm:text-lg">Symbol P&L</CardTitle>
      </CardHeader>
      <CardContent className="px-2 sm:p-6">
        {chartData.length === 0 ? (
          <div className="flex items-center justify-center h-[250px] text-muted-foreground text-sm">
            No symbol P&L data yet
          </div>
        ) : (
          <>
            <ChartContainer config={chartConfig} className="aspect-auto h-[250px] w-full">
              <LineChart data={chartData} margin={{ left: 12, right: 12, top: 12 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis
                  dataKey="time"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  minTickGap={50}
                  tickFormatter={(value) => {
                    const date = new Date(value);
                    return date.toLocaleDateString("en-US", {
                      month: "2-digit",
                      day: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    });
                  }}
                  tick={{ fontSize: 10 }}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  domain={[yMin, yMax]}
                  tickFormatter={(value) => `${value.toFixed(1)}%`}
                  tick={{ fontSize: 10 }}
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      className="w-[200px]"
                      labelFormatter={(value) => {
                        const date = new Date(value);
                        return date.toLocaleString("en-US", {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                          hour12: false,
                        });
                      }}
                    />
                  }
                />
                {symbols.map((symbol) => (
                  <Line
                    key={symbol}
                    type="stepAfter"
                    dataKey={symbol}
                    stroke={getColor(symbol)}
                    strokeWidth={2}
                    dot={false}
                    connectNulls
                  />
                ))}
              </LineChart>
            </ChartContainer>

            {/* Symbol Stats Table */}
            <div className="mt-4 border rounded-lg overflow-hidden">
              <div className="grid grid-cols-5 gap-px bg-muted text-xs font-medium">
                <div className="bg-background px-3 py-2">Symbol</div>
                <div className="bg-background px-3 py-2 text-right">P&L</div>
                <div className="bg-background px-3 py-2 text-right">Trades</div>
                <div className="bg-background px-3 py-2 text-right">Wins</div>
                <div className="bg-background px-3 py-2 text-right">Win Rate</div>
              </div>
              <div className="divide-y">
                {latestSymbolPnl
                  .sort((a, b) => b.cumulative_pnl - a.cumulative_pnl)
                  .map((s) => (
                    <div key={s.symbol} className="grid grid-cols-5 gap-px text-xs hover:bg-muted/50">
                      <div className="px-3 py-2 flex items-center gap-2">
                        <div
                          className="w-3 h-3 rounded-sm flex-shrink-0"
                          style={{ backgroundColor: getColor(s.symbol) }}
                        />
                        <span className="font-medium">{s.symbol}</span>
                      </div>
                      <div
                        className={cn(
                          "px-3 py-2 text-right font-mono",
                          s.cumulative_pnl >= 0
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-red-600 dark:text-red-400"
                        )}
                      >
                        {s.cumulative_pnl >= 0 ? "+" : ""}${s.cumulative_pnl.toFixed(2)}
                      </div>
                      <div className="px-3 py-2 text-right font-mono">{s.trade_count}</div>
                      <div className="px-3 py-2 text-right font-mono">{s.win_count}</div>
                      <div
                        className={cn(
                          "px-3 py-2 text-right font-mono",
                          s.win_rate >= 50
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-red-600 dark:text-red-400"
                        )}
                      >
                        {s.win_rate.toFixed(1)}%
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
