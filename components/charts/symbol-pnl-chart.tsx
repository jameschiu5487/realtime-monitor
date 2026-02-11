"use client";

import { useMemo, useState } from "react";
import { Line, LineChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { cn } from "@/lib/utils";
import type { CombinedTrade } from "@/lib/types/database";

interface SymbolPnLChartProps {
  combinedTrades: CombinedTrade[];
  initialCapital: number;
}

// Generate distinct colors for symbols
const SYMBOL_COLORS = [
  "#22c55e", // green
  "#ef4444", // red
  "#f59e0b", // amber
  "#3b82f6", // blue
  "#a855f7", // purple
  "#ec4899", // pink
  "#14b8a6", // teal
  "#f97316", // orange
  "#6366f1", // indigo
  "#84cc16", // lime
  "#06b6d4", // cyan
  "#e11d48", // rose
  "#8b5cf6", // violet
  "#10b981", // emerald
  "#fbbf24", // yellow
];

function getSymbolColor(index: number): string {
  return SYMBOL_COLORS[index % SYMBOL_COLORS.length];
}

export function SymbolPnLChart({ combinedTrades, initialCapital }: SymbolPnLChartProps) {
  const [showMore, setShowMore] = useState(false);
  const maxSymbols = showMore ? 50 : 10;

  // Calculate cumulative PnL over time for each symbol
  // In hedge mode, trades with same symbol + timestamp are grouped as one trade
  const { chartData, symbolStats, allSymbols } = useMemo(() => {
    if (combinedTrades.length === 0) {
      return { chartData: [], symbolStats: [], allSymbols: [] };
    }

    // Filter and sort trades by time
    const validTrades = combinedTrades.filter((t) => t.total_pnl !== null);

    if (validTrades.length === 0) {
      return { chartData: [], symbolStats: [], allSymbols: [] };
    }

    // Group trades by symbol + timestamp (hedge pairs)
    // Use 1-minute window to group trades that are part of the same hedge
    // Key: "symbol|timestamp_rounded_to_minute"
    const hedgeGroups = new Map<string, { symbol: string; ts: string; totalPnl: number }>();

    for (const trade of validTrades) {
      // Round timestamp to nearest minute for grouping
      const tradeTime = new Date(trade.ts);
      const roundedTime = new Date(
        tradeTime.getFullYear(),
        tradeTime.getMonth(),
        tradeTime.getDate(),
        tradeTime.getHours(),
        tradeTime.getMinutes(),
        0,
        0
      ).toISOString();

      const key = `${trade.symbol}|${roundedTime}`;
      const existing = hedgeGroups.get(key);

      if (existing) {
        // Add PnL to existing hedge pair
        existing.totalPnl += trade.total_pnl ?? 0;
      } else {
        // Create new hedge pair entry
        hedgeGroups.set(key, {
          symbol: trade.symbol,
          ts: roundedTime,
          totalPnl: trade.total_pnl ?? 0,
        });
      }
    }

    // Convert to sorted array
    const sortedPairs = Array.from(hedgeGroups.values()).sort(
      (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime()
    );

    // Track cumulative PnL for each symbol
    const symbolCumulativePnL = new Map<string, number>();
    const symbolTradeCount = new Map<string, number>();

    // Build time series data
    const timeSeriesMap = new Map<string, Record<string, number>>();

    for (const pair of sortedPairs) {
      const symbol = pair.symbol;
      const pnl = pair.totalPnl;

      // Update cumulative PnL
      const currentPnL = symbolCumulativePnL.get(symbol) ?? 0;
      const newPnL = currentPnL + pnl;
      symbolCumulativePnL.set(symbol, newPnL);

      // Update trade count (count hedge pair as 1 trade)
      symbolTradeCount.set(symbol, (symbolTradeCount.get(symbol) ?? 0) + 1);

      // Create time point with all current cumulative values
      const timeKey = pair.ts;
      const dataPoint: Record<string, number | string> = { time: timeKey };

      // Add all symbols' current cumulative PnL as percentage
      for (const [sym, cumPnL] of symbolCumulativePnL) {
        dataPoint[sym] = initialCapital > 0 ? (cumPnL / initialCapital) * 100 : 0;
      }

      timeSeriesMap.set(timeKey, dataPoint as Record<string, number>);
    }

    // Convert to array and forward-fill missing values
    const allSymbolsList = Array.from(symbolCumulativePnL.keys());
    const chartDataArray: Record<string, number | string>[] = [];
    const lastValues = new Map<string, number>();

    for (const [time, data] of timeSeriesMap) {
      const point: Record<string, number | string> = { time };
      for (const symbol of allSymbolsList) {
        if (data[symbol] !== undefined) {
          point[symbol] = data[symbol];
          lastValues.set(symbol, data[symbol]);
        } else {
          point[symbol] = lastValues.get(symbol) ?? 0;
        }
      }
      chartDataArray.push(point);
    }

    // Calculate final stats for each symbol and sort by absolute PnL
    const stats = allSymbolsList
      .map((symbol) => ({
        symbol,
        pnlPercent: initialCapital > 0
          ? ((symbolCumulativePnL.get(symbol) ?? 0) / initialCapital) * 100
          : 0,
        pnlAbsolute: symbolCumulativePnL.get(symbol) ?? 0,
        tradeCount: symbolTradeCount.get(symbol) ?? 0,
      }))
      .sort((a, b) => Math.abs(b.pnlPercent) - Math.abs(a.pnlPercent));

    return {
      chartData: chartDataArray,
      symbolStats: stats,
      allSymbols: allSymbolsList,
    };
  }, [combinedTrades, initialCapital]);

  // Get top symbols to display
  const displaySymbols = symbolStats.slice(0, maxSymbols);
  const hasMoreSymbols = symbolStats.length > 10;

  // Create chart config
  const chartConfig = useMemo(() => {
    const config: ChartConfig = {};
    displaySymbols.forEach((stat, index) => {
      config[stat.symbol] = {
        label: stat.symbol,
        color: getSymbolColor(index),
      };
    });
    return config;
  }, [displaySymbols]);

  // Calculate Y-axis domain
  const { yMin, yMax } = useMemo(() => {
    if (chartData.length === 0) return { yMin: -1, yMax: 1 };

    let min = 0;
    let max = 0;

    for (const point of chartData) {
      for (const symbol of displaySymbols.map((s) => s.symbol)) {
        const value = point[symbol] as number;
        if (value !== undefined) {
          min = Math.min(min, value);
          max = Math.max(max, value);
        }
      }
    }

    const padding = Math.max(Math.abs(max), Math.abs(min)) * 0.1 || 0.5;
    return {
      yMin: min - padding,
      yMax: max + padding,
    };
  }, [chartData, displaySymbols]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between px-4 py-3 sm:px-6 sm:py-4 border-b">
        <div>
          <CardTitle className="text-base sm:text-lg">
            Symbol PnL
            <span className="text-xs sm:text-sm font-normal text-muted-foreground ml-2">
              (Top {Math.min(maxSymbols, symbolStats.length)} symbols)
            </span>
          </CardTitle>
        </div>
        {hasMoreSymbols && (
          <Button
            variant="outline"
            size="sm"
            className="text-xs h-7 sm:h-8"
            onClick={() => setShowMore(!showMore)}
          >
            {showMore ? "Show Less" : `Show More (Max 50)`}
          </Button>
        )}
      </CardHeader>
      <CardContent className="px-2 sm:p-6">
        {chartData.length === 0 ? (
          <div className="flex items-center justify-center h-[200px] sm:h-[300px] text-muted-foreground text-sm">
            No trade data available
          </div>
        ) : (
          <>
            <ChartContainer config={chartConfig} className="aspect-auto h-[200px] sm:h-[300px] w-full">
              <LineChart
                data={chartData}
                margin={{
                  left: 12,
                  right: 12,
                  top: 12,
                }}
              >
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
                    });
                  }}
                  tick={{ fontSize: 10 }}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  domain={[yMin, yMax]}
                  tickFormatter={(value) => `${value.toFixed(2)}%`}
                  tick={{ fontSize: 10 }}
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      className="w-[200px] max-h-[300px] overflow-y-auto"
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
                {displaySymbols.map((stat, index) => (
                  <Line
                    key={stat.symbol}
                    type="stepAfter"
                    dataKey={stat.symbol}
                    stroke={getSymbolColor(index)}
                    strokeWidth={1.5}
                    dot={false}
                    connectNulls
                  />
                ))}
              </LineChart>
            </ChartContainer>

            {/* Symbol Legend Table */}
            <div className="mt-4 border rounded-lg overflow-hidden">
              <div className="grid grid-cols-2 gap-px bg-muted text-xs sm:text-sm">
                <div className="bg-background px-3 py-2 font-medium">Symbol</div>
                <div className="bg-background px-3 py-2 font-medium text-right">Cumulative PnL (%)</div>
              </div>
              <div className="divide-y max-h-[200px] overflow-y-auto">
                {displaySymbols.map((stat, index) => (
                  <div
                    key={stat.symbol}
                    className="grid grid-cols-2 gap-px text-xs sm:text-sm hover:bg-muted/50"
                  >
                    <div className="px-3 py-2 flex items-center gap-2">
                      <div
                        className="w-3 h-3 rounded-sm flex-shrink-0"
                        style={{ backgroundColor: getSymbolColor(index) }}
                      />
                      <span className="truncate">{stat.symbol}</span>
                    </div>
                    <div
                      className={cn(
                        "px-3 py-2 text-right font-mono",
                        stat.pnlPercent >= 0
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-red-600 dark:text-red-400"
                      )}
                    >
                      {stat.pnlPercent >= 0 ? "+" : ""}
                      {stat.pnlPercent.toFixed(4)}%
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
