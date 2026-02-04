"use client";

import { useState, useEffect, useMemo } from "react";
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
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
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
        <p className="text-muted-foreground">
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
                        <TableCell className="font-medium">{pos.symbol}</TableCell>
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
    </div>
  );
}
