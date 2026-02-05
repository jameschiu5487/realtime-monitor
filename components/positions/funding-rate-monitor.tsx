"use client";

import { useState, useEffect, useCallback, useRef } from "react";
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

interface PositionInfo {
  symbol: string;
  exchange: string;
  run_id: string;
}

interface EntryFundingInfo {
  fundingRate: number;
  intervalHours: string | null;
}

interface LiveFundingInfo {
  currentRate: number;
  nextFundingTime: number; // timestamp ms
  intervalHours: number;
}

interface FundingRowData {
  symbol: string;
  exchange: string;
  entryRate: number | null;
  entryInterval: string | null;
  liveRate: number | null;
  nextFundingTime: number | null;
  intervalHours: number | null;
}

interface FundingRateMonitorProps {
  positions: PositionInfo[];
}

function formatRate(rate: number): string {
  return (rate * 100).toFixed(4) + "%";
}

function formatCountdown(nextTime: number): string {
  const diff = nextTime - Date.now();
  if (diff <= 0) return "settling...";
  const hours = Math.floor(diff / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  const secs = Math.floor((diff % 60000) / 1000);
  return `${hours}h ${mins}m ${secs}s`;
}

function getRateColor(rate: number): string {
  if (rate > 0) return "text-emerald-600 dark:text-emerald-400";
  if (rate < 0) return "text-red-600 dark:text-red-400";
  return "";
}

// Fetch Binance funding rate via premiumIndex
async function fetchBinanceFunding(symbol: string): Promise<LiveFundingInfo | null> {
  try {
    const url = `https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${symbol.toUpperCase()}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();

    return {
      currentRate: parseFloat(data.lastFundingRate),
      nextFundingTime: data.nextFundingTime,
      intervalHours: 8, // default, will be overridden if fundingInfo available
    };
  } catch {
    return null;
  }
}

// Fetch Bybit funding rate via tickers
async function fetchBybitFunding(symbol: string): Promise<LiveFundingInfo | null> {
  try {
    const url = `https://api.bybit.com/v5/market/tickers?category=linear&symbol=${symbol.toUpperCase()}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();

    if (data.retCode !== 0 || !data.result?.list?.length) return null;

    const ticker = data.result.list[0];
    return {
      currentRate: parseFloat(ticker.fundingRate),
      nextFundingTime: parseInt(ticker.nextFundingTime),
      intervalHours: parseInt(ticker.fundingIntervalHour) || 8,
    };
  } catch {
    return null;
  }
}

export function FundingRateMonitor({ positions }: FundingRateMonitorProps) {
  const [rows, setRows] = useState<FundingRowData[]>([]);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [, setTick] = useState(0); // force re-render for countdown

  // Get unique symbol+exchange pairs from positions
  const getUniquePositions = useCallback((): PositionInfo[] => {
    const seen = new Set<string>();
    const unique: PositionInfo[] = [];
    for (const pos of positions) {
      const key = `${pos.symbol}-${pos.exchange.toLowerCase()}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(pos);
      }
    }
    return unique;
  }, [positions]);

  // Fetch entry funding rates from trades table (latest Open trade per symbol, like entry time lookup)
  const fetchEntryRates = useCallback(async (): Promise<Map<string, EntryFundingInfo>> => {
    const supabase = createClient();
    const uniquePositions = getUniquePositions();
    const entryMap = new Map<string, EntryFundingInfo>();

    // Get unique symbols
    const symbols = [...new Set(uniquePositions.map((p) => p.symbol))];

    for (const symbol of symbols) {
      // Same approach as entry time lookup: latest Open trade for this symbol, no run_id filter
      // Get the 2 most recent Open trades (one per exchange: Binance + Bybit)
      const { data: trades } = await supabase
        .from("trades")
        .select("symbol, exchange, funding_rate, interval_hours")
        .eq("symbol", symbol)
        .eq("action", "Open")
        .order("ts", { ascending: false })
        .limit(2);

      if (trades) {
        type TradeRecord = { symbol: string; exchange: string; funding_rate: number; interval_hours: string | null };
        for (const trade of trades as TradeRecord[]) {
          const key = `${trade.symbol}-${trade.exchange.toLowerCase()}`;
          if (!entryMap.has(key)) {
            console.log(`[FundingRate] Entry ${key}: rate=${trade.funding_rate}, interval=${trade.interval_hours}`);
            entryMap.set(key, {
              fundingRate: trade.funding_rate,
              intervalHours: trade.interval_hours,
            });
          }
        }
      }
    }

    return entryMap;
  }, [getUniquePositions]);

  // Fetch live funding rates from exchanges
  const fetchLiveRates = useCallback(async (): Promise<Map<string, LiveFundingInfo>> => {
    const uniquePositions = getUniquePositions();
    const liveMap = new Map<string, LiveFundingInfo>();

    const promises = uniquePositions.map(async (pos) => {
      const key = `${pos.symbol}-${pos.exchange.toLowerCase()}`;
      let info: LiveFundingInfo | null = null;

      if (pos.exchange.toLowerCase() === "binance") {
        info = await fetchBinanceFunding(pos.symbol);
      } else if (pos.exchange.toLowerCase() === "bybit") {
        info = await fetchBybitFunding(pos.symbol);
      }

      if (info) {
        liveMap.set(key, info);
      }
    });

    await Promise.all(promises);
    return liveMap;
  }, [getUniquePositions]);

  // Combined fetch and build rows
  const refreshData = useCallback(async () => {
    const uniquePositions = getUniquePositions();
    if (uniquePositions.length === 0) {
      setRows([]);
      return;
    }

    const [entryMap, liveMap] = await Promise.all([
      fetchEntryRates(),
      fetchLiveRates(),
    ]);

    // Group by symbol for display
    const newRows: FundingRowData[] = uniquePositions.map((pos) => {
      const key = `${pos.symbol}-${pos.exchange.toLowerCase()}`;
      const entry = entryMap.get(key);
      const live = liveMap.get(key);

      return {
        symbol: pos.symbol,
        exchange: pos.exchange,
        entryRate: entry?.fundingRate ?? null,
        entryInterval: entry?.intervalHours ?? null,
        liveRate: live?.currentRate ?? null,
        nextFundingTime: live?.nextFundingTime ?? null,
        intervalHours: live?.intervalHours ?? null,
      };
    });

    // Sort by symbol then exchange
    newRows.sort((a, b) => a.symbol.localeCompare(b.symbol) || a.exchange.localeCompare(b.exchange));

    setRows(newRows);
    setLastUpdate(new Date());
  }, [getUniquePositions, fetchEntryRates, fetchLiveRates]);

  // Initial fetch and set up 1-minute polling
  useEffect(() => {
    refreshData();

    intervalRef.current = setInterval(refreshData, 60000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [refreshData]);

  // Countdown timer - update every second
  useEffect(() => {
    countdownRef.current = setInterval(() => {
      setTick((t) => t + 1);
    }, 1000);

    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, []);

  if (positions.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Funding Rate 監控</CardTitle>
        <p className="text-sm text-muted-foreground">
          進場時與即時 Funding Rate 對比 • 每分鐘更新 • 最後更新: {lastUpdate.toLocaleTimeString()}
        </p>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <div className="flex h-[100px] items-center justify-center text-muted-foreground">
            載入中...
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>交易對</TableHead>
                  <TableHead>交易所</TableHead>
                  <TableHead className="text-right">進場 Rate</TableHead>
                  <TableHead className="text-right">即時 Rate</TableHead>
                  <TableHead className="text-right">Interval</TableHead>
                  <TableHead className="text-right">Next Funding</TableHead>
                  <TableHead className="text-right">倒數</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={`${row.symbol}-${row.exchange}`}>
                    <TableCell className="font-medium">{row.symbol}</TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={
                          row.exchange.toLowerCase() === "binance"
                            ? "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/20"
                            : row.exchange.toLowerCase() === "bybit"
                            ? "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20"
                            : "bg-gray-500/10 text-gray-600 dark:text-gray-400 border-gray-500/20"
                        }
                      >
                        {row.exchange}
                      </Badge>
                    </TableCell>
                    <TableCell className={cn("text-right font-mono", row.entryRate !== null ? getRateColor(row.entryRate) : "")}>
                      {row.entryRate !== null ? formatRate(row.entryRate) : "-"}
                    </TableCell>
                    <TableCell className={cn("text-right font-mono", row.liveRate !== null ? getRateColor(row.liveRate) : "")}>
                      {row.liveRate !== null ? formatRate(row.liveRate) : "-"}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {row.entryInterval ?? "-"}
                    </TableCell>
                    <TableCell className="text-right font-mono text-muted-foreground">
                      {row.nextFundingTime
                        ? new Date(row.nextFundingTime).toLocaleTimeString()
                        : "-"}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {row.nextFundingTime ? formatCountdown(row.nextFundingTime) : "-"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
