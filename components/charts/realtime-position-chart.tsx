"use client";

import { useMemo } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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

export interface RealtimePositionDataPoint {
  symbol: string;
  exchange: string;
  position: number; // positive for long, negative for short
  avg_price: number;
  mark_price: number;
  notional_value: number;
  unrealized_pnl: number;
  leverage: number;
  liq_price: number;
  ts: string;
}

interface RealtimePositionChartProps {
  data: RealtimePositionDataPoint[];
}

function formatCurrency(value: number, decimals: number = 2) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

function formatNumber(value: number, decimals: number = 4) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

function getPnLColor(pnl: number) {
  if (pnl > 0) return "text-emerald-600 dark:text-emerald-400";
  if (pnl < 0) return "text-red-600 dark:text-red-400";
  return "";
}

export function RealtimePositionChart({ data }: RealtimePositionChartProps) {
  // Get the latest positions - must be recent (within 1.5s of now) to be considered "open"
  const latestPositions = useMemo(() => {
    if (data.length === 0) return [];

    // Find the maximum timestamp in the data
    let maxTs = 0;
    for (const pos of data) {
      const ts = new Date(pos.ts).getTime();
      if (ts > maxTs) maxTs = ts;
    }

    // Check if the most recent data is within 1.5 seconds of NOW
    // If not, there are no open positions (strategy stopped updating)
    const now = Date.now();
    if (maxTs < now - 1500) {
      return []; // No recent data = no open positions
    }

    // Filter positions within 1.5 seconds of the max timestamp in data
    // This ensures all positions from the same "batch" are shown together
    const cutoffTime = maxTs - 1500;
    const recentPositions = data.filter(
      (pos) => new Date(pos.ts).getTime() >= cutoffTime
    );

    // Group by symbol+exchange and get the latest entry
    const positionMap = new Map<string, RealtimePositionDataPoint>();

    for (const pos of recentPositions) {
      const key = `${pos.symbol}-${pos.exchange}`;
      const existing = positionMap.get(key);

      if (!existing || new Date(pos.ts) > new Date(existing.ts)) {
        positionMap.set(key, pos);
      }
    }

    // Filter out positions where position value is 0
    return Array.from(positionMap.values())
      .filter((pos) => pos.position !== 0)
      .sort((a, b) => Math.abs(b.notional_value) - Math.abs(a.notional_value));
  }, [data]);

  const totalNotional = latestPositions.reduce((sum, d) => sum + Math.abs(d.notional_value), 0);
  const totalUnrealizedPnl = latestPositions.reduce((sum, d) => sum + d.unrealized_pnl, 0);

  return (
    <Card>
      <CardHeader className="flex flex-col items-stretch border-b p-0 sm:flex-row">
        <div className="flex flex-1 flex-col justify-center gap-1 px-4 py-3 sm:px-6 sm:py-6">
          <CardTitle className="text-base sm:text-lg">Realtime Positions</CardTitle>
          <CardDescription className="text-xs sm:text-sm">Current open positions ({latestPositions.length})</CardDescription>
        </div>
        <div className="flex">
          <div className="flex flex-1 flex-col justify-center gap-1 border-t px-3 py-2 text-left sm:border-t-0 sm:border-l sm:px-8 sm:py-6">
            <span className="text-xs text-muted-foreground">Total Notional</span>
            <span className="text-sm font-bold leading-none sm:text-2xl">
              {formatCurrency(totalNotional, 0)}
            </span>
          </div>
          <div className="flex flex-1 flex-col justify-center gap-1 border-t border-l px-3 py-2 text-left sm:border-t-0 sm:px-8 sm:py-6">
            <span className="text-xs text-muted-foreground">Unrealized P&L</span>
            <span className={cn(
              "text-sm font-bold leading-none sm:text-2xl",
              getPnLColor(totalUnrealizedPnl)
            )}>
              {formatCurrency(totalUnrealizedPnl)}
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {latestPositions.length === 0 ? (
          <div className="flex items-center justify-center h-[150px] sm:h-[250px] text-muted-foreground text-sm">
            No open positions
          </div>
        ) : (
          <div className="max-h-[200px] sm:max-h-[250px] overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Symbol</TableHead>
                  <TableHead>Exchange</TableHead>
                  <TableHead>Side</TableHead>
                  <TableHead className="text-right">Position</TableHead>
                  <TableHead className="text-right">Notional</TableHead>
                  <TableHead className="text-right">Avg Price</TableHead>
                  <TableHead className="text-right">Mark Price</TableHead>
                  <TableHead className="text-right">P&L</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {latestPositions.map((pos) => {
                  const side = pos.position >= 0 ? "long" : "short";
                  return (
                    <TableRow key={`${pos.symbol}-${pos.exchange}`}>
                      <TableCell className="font-medium">{pos.symbol}</TableCell>
                      <TableCell>{pos.exchange}</TableCell>
                      <TableCell>
                        <Badge variant={side === "long" ? "default" : "secondary"}>
                          {side}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatNumber(Math.abs(pos.position))}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatCurrency(Math.abs(pos.notional_value), 0)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatCurrency(pos.avg_price)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatCurrency(pos.mark_price)}
                      </TableCell>
                      <TableCell className={cn(
                        "text-right font-mono font-medium",
                        getPnLColor(pos.unrealized_pnl)
                      )}>
                        {formatCurrency(pos.unrealized_pnl)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
