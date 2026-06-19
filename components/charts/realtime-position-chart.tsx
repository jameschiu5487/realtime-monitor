"use client";

import { useMemo, useState, useEffect, useCallback } from "react";
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
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";

export interface RealtimePositionDataPoint {
  symbol: string;
  exchange: string;
  position: number;
  avg_price: number;
  mark_price: number;
  notional_value: number;
  unrealized_pnl: number;
  leverage: number;
  liq_price: number;
  ts: string;
}

interface Trade {
  trade_id: number;
  ts: string;
  action: string;
  side: string;
  symbol: string;
  exchange: string;
  quantity_actual: number;
  price: number;
  fee_amount_usdt: number;
  status: string;
}

interface RealtimePositionChartProps {
  data: RealtimePositionDataPoint[];
  lastInsertTime: number;
  runId: string;
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

function formatTime(ts: string) {
  const d = new Date(ts);
  return d.toLocaleString("en-US", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export function RealtimePositionChart({ data, lastInsertTime, runId }: RealtimePositionChartProps) {
  const [currentTime, setCurrentTime] = useState(Date.now());
  const [tab, setTab] = useState("positions");
  const [trades, setTrades] = useState<Trade[]>([]);
  const [isLoadingTrades, setIsLoadingTrades] = useState(false);
  const [tradesLoaded, setTradesLoaded] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const fetchTrades = useCallback(async () => {
    if (tradesLoaded) return;
    setIsLoadingTrades(true);
    try {
      const supabase = createClient();
      const { data: tradesData } = await supabase
        .from("trades")
        .select("trade_id, ts, action, side, symbol, exchange, quantity_actual, price, fee_amount_usdt, status")
        .eq("run_id", runId)
        .order("ts", { ascending: false })
        .limit(100);
      setTrades((tradesData ?? []) as Trade[]);
      setTradesLoaded(true);
    } finally {
      setIsLoadingTrades(false);
    }
  }, [runId, tradesLoaded]);

  useEffect(() => {
    if (tab === "orders" && !tradesLoaded) {
      fetchTrades();
    }
  }, [tab, tradesLoaded, fetchTrades]);

  const latestPositions = useMemo(() => {
    const timeSinceLastInsert = currentTime - lastInsertTime;
    if (timeSinceLastInsert > 5000) return [];
    if (data.length === 0) return [];

    let maxTs = 0;
    for (const pos of data) {
      const ts = new Date(pos.ts).getTime();
      if (ts > maxTs) maxTs = ts;
    }

    const cutoffTime = maxTs - 5000;
    const recentPositions = data.filter(
      (pos) => new Date(pos.ts).getTime() >= cutoffTime
    );

    const positionMap = new Map<string, RealtimePositionDataPoint>();
    for (const pos of recentPositions) {
      const key = `${pos.symbol}-${pos.exchange}`;
      const existing = positionMap.get(key);
      if (!existing || new Date(pos.ts) > new Date(existing.ts)) {
        positionMap.set(key, pos);
      }
    }

    return Array.from(positionMap.values())
      .filter((pos) => pos.position !== 0)
      .sort((a, b) => Math.abs(b.notional_value) - Math.abs(a.notional_value));
  }, [data, lastInsertTime, currentTime]);

  const totalNotional = latestPositions.reduce((sum, d) => sum + Math.abs(d.notional_value), 0);
  const totalUnrealizedPnl = latestPositions.reduce((sum, d) => sum + d.unrealized_pnl, 0);

  return (
    <Card>
      <CardHeader className="flex flex-col items-stretch border-b p-0 sm:flex-row">
        <div className="flex flex-1 flex-col justify-center gap-1 px-4 py-3 sm:px-6 sm:py-5">
          <CardTitle className="text-base sm:text-lg">
            {tab === "positions" ? "Realtime Positions" : "Executed Orders"}
          </CardTitle>
          <CardDescription className="text-xs sm:text-sm">
            {tab === "positions"
              ? `Open positions (${latestPositions.length})`
              : `Recent ${trades.length} orders`}
          </CardDescription>
        </div>
        {tab === "positions" && (
          <div className="flex">
            <div className="flex flex-1 flex-col justify-center gap-1 border-t px-3 py-2 text-left sm:border-t-0 sm:border-l sm:px-6 sm:py-5">
              <span className="text-xs text-muted-foreground">Total Notional</span>
              <span className="text-base font-bold leading-none sm:text-2xl">
                {formatCurrency(totalNotional, 0)}
              </span>
            </div>
            <div className="flex flex-1 flex-col justify-center gap-1 border-t border-l px-3 py-2 text-left sm:border-t-0 sm:px-6 sm:py-5">
              <span className="text-xs text-muted-foreground">Unrealized P&L</span>
              <span className={cn(
                "text-base font-bold leading-none sm:text-2xl",
                getPnLColor(totalUnrealizedPnl)
              )}>
                {formatCurrency(totalUnrealizedPnl)}
              </span>
            </div>
          </div>
        )}
      </CardHeader>
      <Tabs value={tab} onValueChange={setTab}>
        <div className="px-4 pt-2 sm:px-6">
          <TabsList className="w-full sm:w-auto">
            <TabsTrigger value="positions" className="text-xs sm:text-sm">Positions</TabsTrigger>
            <TabsTrigger value="orders" className="text-xs sm:text-sm">Executed Orders</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="positions" className="mt-0">
          <CardContent className="p-0">
            {latestPositions.length === 0 ? (
              <div className="flex items-center justify-center h-[150px] sm:h-[200px] text-muted-foreground text-sm">
                No open positions
              </div>
            ) : (
              <div className="max-h-[200px] sm:max-h-[250px] overflow-auto">
                <Table className="min-w-[600px]">
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
        </TabsContent>
        <TabsContent value="orders" className="mt-0">
          <CardContent className="p-0">
            {isLoadingTrades ? (
              <div className="flex items-center justify-center h-[150px] sm:h-[200px] text-muted-foreground text-sm">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Loading...
              </div>
            ) : trades.length === 0 ? (
              <div className="flex items-center justify-center h-[150px] sm:h-[200px] text-muted-foreground text-sm">
                No executed orders
              </div>
            ) : (
              <div className="max-h-[300px] sm:max-h-[400px] overflow-auto">
                <Table className="min-w-[600px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Time</TableHead>
                      <TableHead>Symbol</TableHead>
                      <TableHead>Exchange</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead>Side</TableHead>
                      <TableHead className="text-right">Quantity</TableHead>
                      <TableHead className="text-right">Price</TableHead>
                      <TableHead className="text-right">Fee</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {trades.map((trade) => (
                      <TableRow key={trade.trade_id}>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {formatTime(trade.ts)}
                        </TableCell>
                        <TableCell className="font-medium">{trade.symbol}</TableCell>
                        <TableCell>{trade.exchange}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">
                            {trade.action}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={trade.side === "buy" ? "default" : "secondary"}>
                            {trade.side}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {formatNumber(trade.quantity_actual)}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {formatCurrency(trade.price)}
                        </TableCell>
                        <TableCell className={cn(
                          "text-right font-mono",
                          getPnLColor(-trade.fee_amount_usdt)
                        )}>
                          {formatCurrency(-trade.fee_amount_usdt)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </TabsContent>
      </Tabs>
    </Card>
  );
}
