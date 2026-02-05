"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { SpreadChart } from "./spread-chart";
import { FundingRateMonitor } from "./funding-rate-monitor";
import type { Position } from "@/lib/types/database";

// Extended position type with strategy info
interface PositionWithStrategy extends Position {
  strategy_name: string;
  strategy_id: string;
}

interface AllPositionsContentProps {
  initialPositions: PositionWithStrategy[];
  initialTotalNotionalValue: number;
  initialTotalUnrealizedPnl: number;
  initialPositionCount: number;
  runIds: string[];
  runToStrategyMap: Record<string, { name: string; id: string }>;
}

function formatCurrency(value: number): string {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatNumber(value: number, decimals: number = 4): string {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function getExchangeColor(exchange: string): string {
  switch (exchange.toLowerCase()) {
    case "binance":
      return "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/20";
    case "bybit":
      return "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20";
    default:
      return "bg-gray-500/10 text-gray-600 dark:text-gray-400 border-gray-500/20";
  }
}

function getPnlColor(value: number): string {
  if (value > 0) return "text-emerald-600 dark:text-emerald-400";
  if (value < 0) return "text-red-600 dark:text-red-400";
  return "";
}

function getPositionSideColor(position: number): string {
  if (position > 0) return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20";
  if (position < 0) return "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20";
  return "bg-gray-500/10 text-gray-600 dark:text-gray-400 border-gray-500/20";
}

export function AllPositionsContent({
  initialPositions,
  initialTotalNotionalValue,
  initialTotalUnrealizedPnl,
  initialPositionCount,
  runIds,
  runToStrategyMap,
}: AllPositionsContentProps) {
  const [positions, setPositions] = useState<PositionWithStrategy[]>(initialPositions);
  const [lastUpdateTime, setLastUpdateTime] = useState<Date>(new Date());
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const [entryTimes, setEntryTimes] = useState<number[]>([]);
  const [entrySpread, setEntrySpread] = useState<number | null>(null);

  // Handle symbol selection
  const handleSymbolClick = useCallback((symbol: string) => {
    setSelectedSymbol((prev) => (prev === symbol ? null : symbol));
  }, []);

  const handleClearSymbol = useCallback(() => {
    setSelectedSymbol(null);
    setEntryTimes([]);
    setEntrySpread(null);
  }, []);

  // Fetch entry times and entry spread from trades when symbol is selected
  useEffect(() => {
    if (!selectedSymbol || runIds.length === 0) {
      setEntryTimes([]);
      setEntrySpread(null);
      return;
    }

    const fetchEntryData = async () => {
      const supabase = createClient();

      // Fetch the latest trade with action = 'open' for this symbol
      console.log(`[AllPositions] Fetching entry data for ${selectedSymbol}, runIds:`, runIds);

      // Get the latest Open trades for this symbol from both exchanges
      const { data: trades, error } = await supabase
        .from("trades")
        .select("ts, symbol, action, run_id, exchange, price")
        .eq("symbol", selectedSymbol)
        .eq("action", "Open")
        .order("ts", { ascending: false })
        .limit(10);

      console.log(`[AllPositions] Open trades query result:`, { trades, error });

      if (error) {
        console.error("[AllPositions] Error fetching entry data:", error);
        return;
      }

      if (trades && trades.length > 0) {
        // Get timestamp of the latest open trade as entry point
        const latestTrade = trades[0] as { ts: string; symbol: string; action: string; run_id: string; exchange: string; price: number };
        const entryTime = new Date(latestTrade.ts).getTime();
        console.log(`[AllPositions] Found entry time for ${selectedSymbol}: ${latestTrade.ts} (${entryTime}ms)`);
        setEntryTimes([entryTime]);

        // Find entry prices for both exchanges from the same entry event (similar timestamp)
        // Trades usually come in pairs (Binance + Bybit) at similar times
        type TradeRecord = { ts: string; symbol: string; action: string; run_id: string; exchange: string; price: number };
        const typedTrades = trades as TradeRecord[];
        const binanceTrade = typedTrades.find((t) => t.exchange.toLowerCase() === "binance");
        const bybitTrade = typedTrades.find((t) => t.exchange.toLowerCase() === "bybit");

        console.log(`[AllPositions] Entry trades - Binance:`, binanceTrade, `Bybit:`, bybitTrade);

        if (binanceTrade && bybitTrade) {
          const binancePrice = binanceTrade.price;
          const bybitPrice = bybitTrade.price;
          // Calculate spread: (Bybit - Binance) / Binance * 10000 (basis points)
          const spread = ((bybitPrice - binancePrice) / binancePrice) * 10000;
          console.log(`[AllPositions] Entry spread calculated: Binance=${binancePrice}, Bybit=${bybitPrice}, Spread=${spread.toFixed(2)} bp`);
          setEntrySpread(spread);
        } else {
          console.log(`[AllPositions] Could not find trades for both exchanges`);
          setEntrySpread(null);
        }
      } else {
        console.log(`[AllPositions] No entry time found for ${selectedSymbol}`);
        setEntryTimes([]);
        setEntrySpread(null);
      }
    };

    fetchEntryData();
  }, [selectedSymbol, runIds]);

  // Calculate summary stats
  const { totalNotionalValue, totalUnrealizedPnl, positionCount } = useMemo(() => {
    const notional = positions.reduce((sum, p) => sum + Math.abs(p.notional_value), 0);
    const pnl = positions.reduce((sum, p) => sum + p.unrealized_pnl, 0);
    return {
      totalNotionalValue: notional,
      totalUnrealizedPnl: pnl,
      positionCount: positions.length,
    };
  }, [positions]);

  // Subscribe to realtime position updates for all running runs
  useEffect(() => {
    if (runIds.length === 0) return;

    const supabase = createClient();
    const channels: ReturnType<typeof supabase.channel>[] = [];

    for (const runId of runIds) {
      const channel = supabase
        .channel(`all-positions-${runId}-${Date.now()}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "positions",
            filter: `run_id=eq.${runId}`,
          },
          (payload) => {
            const newPosition = payload.new as Position;
            const strategyInfo = runToStrategyMap[runId];

            const positionWithStrategy: PositionWithStrategy = {
              ...newPosition,
              strategy_name: strategyInfo?.name ?? "Unknown",
              strategy_id: strategyInfo?.id ?? "",
            };

            setPositions((prev) => {
              // Create map for latest positions
              const posMap = new Map<string, PositionWithStrategy>();

              // Add existing positions
              for (const pos of prev) {
                const key = `${pos.run_id}-${pos.symbol}-${pos.exchange}`;
                posMap.set(key, pos);
              }

              // Update with new position
              const newKey = `${newPosition.run_id}-${newPosition.symbol}-${newPosition.exchange}`;
              posMap.set(newKey, positionWithStrategy);

              return Array.from(posMap.values());
            });

            setLastUpdateTime(new Date());
          }
        )
        .subscribe();

      channels.push(channel);
    }

    return () => {
      channels.forEach((channel) => supabase.removeChannel(channel));
    };
  }, [runIds, runToStrategyMap]);

  // Group positions by strategy
  const positionsByStrategy = useMemo(() => {
    const grouped = new Map<string, PositionWithStrategy[]>();

    for (const pos of positions) {
      const key = pos.strategy_name;
      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key)!.push(pos);
    }

    // Sort positions within each group by symbol
    for (const [, posArr] of grouped) {
      posArr.sort((a, b) => a.symbol.localeCompare(b.symbol));
    }

    return grouped;
  }, [positions]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">持倉查看</h2>
        <p className="text-muted-foreground" suppressHydrationWarning>
          查看所有運行中策略的持倉 • 最後更新: {lastUpdateTime.toLocaleTimeString()}
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">總持倉價值</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              ${formatCurrency(totalNotionalValue)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">未實現盈虧</CardTitle>
          </CardHeader>
          <CardContent>
            <div className={cn("text-2xl font-bold", getPnlColor(totalUnrealizedPnl))}>
              {totalUnrealizedPnl >= 0 ? "+" : ""}${formatCurrency(totalUnrealizedPnl)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">持倉數量</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{positionCount}</div>
          </CardContent>
        </Card>
      </div>

      {/* Positions Table */}
      <Card>
        <CardHeader>
          <CardTitle>持倉列表</CardTitle>
          <p className="text-sm text-muted-foreground">
            點擊交易對查看兩間交易所的價差走勢
          </p>
        </CardHeader>
        <CardContent>
          {positions.length === 0 ? (
            <div className="flex h-[200px] items-center justify-center text-muted-foreground">
              目前無持倉
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>策略</TableHead>
                    <TableHead>交易對</TableHead>
                    <TableHead>交易所</TableHead>
                    <TableHead className="text-right">方向</TableHead>
                    <TableHead className="text-right">數量</TableHead>
                    <TableHead className="text-right">均價</TableHead>
                    <TableHead className="text-right">標記價</TableHead>
                    <TableHead className="text-right">名義價值</TableHead>
                    <TableHead className="text-right">未實現盈虧</TableHead>
                    <TableHead className="text-right">槓桿</TableHead>
                    <TableHead className="text-right">強平價</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {Array.from(positionsByStrategy.entries()).map(([strategyName, strategyPositions]) => (
                    strategyPositions.map((pos, idx) => (
                      <TableRow key={`${pos.run_id}-${pos.symbol}-${pos.exchange}`}>
                        {idx === 0 ? (
                          <TableCell rowSpan={strategyPositions.length} className="align-top border-r">
                            <Link
                              href={`/strategies/${pos.strategy_id}`}
                              className="hover:underline font-medium text-primary"
                            >
                              {strategyName}
                            </Link>
                            <div className="text-xs text-muted-foreground mt-1">
                              {strategyPositions.length} 持倉
                            </div>
                          </TableCell>
                        ) : null}
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="sm"
                            className={cn(
                              "font-medium px-2 h-7",
                              selectedSymbol === pos.symbol && "bg-primary/10 text-primary"
                            )}
                            onClick={() => handleSymbolClick(pos.symbol)}
                          >
                            {pos.symbol}
                          </Button>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={getExchangeColor(pos.exchange)}>
                            {pos.exchange}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge variant="outline" className={getPositionSideColor(pos.position)}>
                            {pos.position > 0 ? "LONG" : pos.position < 0 ? "SHORT" : "FLAT"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {formatNumber(Math.abs(pos.position), 4)}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          ${formatNumber(pos.avg_price, 2)}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          ${formatNumber(pos.mark_price, 2)}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          ${formatCurrency(Math.abs(pos.notional_value))}
                        </TableCell>
                        <TableCell className={cn("text-right font-mono", getPnlColor(pos.unrealized_pnl))}>
                          {pos.unrealized_pnl >= 0 ? "+" : ""}${formatCurrency(pos.unrealized_pnl)}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {pos.leverage}x
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          ${formatNumber(pos.liq_price, 2)}
                        </TableCell>
                      </TableRow>
                    ))
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Funding Rate Monitor */}
      <FundingRateMonitor
        positions={positions.map((p) => ({ symbol: p.symbol, exchange: p.exchange, run_id: p.run_id }))}
      />

      {/* Spread Chart */}
      <SpreadChart symbol={selectedSymbol} entryTimes={entryTimes} entrySpread={entrySpread} onSymbolClear={handleClearSymbol} />
    </div>
  );
}
