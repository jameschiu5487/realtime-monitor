"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TimeRangeSelector, TimeRange } from "@/components/charts/time-range-selector";
import { EquityCurveWithBrush } from "@/components/charts/equity-curve-with-brush";
import { ExposureChart } from "@/components/charts/exposure-chart";
import { PnLBreakdownChart } from "@/components/charts/pnl-breakdown-chart";
import { IndividualTradePnLChart } from "@/components/charts/individual-trade-pnl-chart";
import { CumulativeTradePnLChart } from "@/components/charts/cumulative-trade-pnl-chart";
import { CombinedTradesTable } from "@/components/trades/combined-trades-table";
import { PerformanceStats } from "@/components/charts/performance-stats";
import { SymbolPnLChart } from "@/components/charts/symbol-pnl-chart";
import { createClient } from "@/lib/supabase/client";
import type { EquityCurveDataPoint } from "@/components/charts/equity-curve-chart";
import type { ExposureDataPoint } from "@/components/charts/exposure-chart";
import type { PnLBreakdownDataPoint } from "@/components/charts/pnl-breakdown-chart";
import type { CumulativePnLDataPoint } from "@/components/charts/cumulative-trade-pnl-chart";
import type {
  EquityCurve,
  PnlSeries,
  CombinedTrade,
} from "@/lib/types/database";

interface CombinedStrategyContentProps {
  strategyId: string;
  initialEquityCurve: EquityCurve[];
  initialPnlSeries: PnlSeries[];
  initialCombinedTrades: CombinedTrade[];
  initialCapital: number;
  runIds: string[];
}

// Merge and forward-fill equity curve data from multiple runs
function mergeEquityCurveData(data: EquityCurve[]): EquityCurve[] {
  if (data.length === 0) return [];

  // Sort by timestamp
  const sorted = [...data].sort(
    (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime()
  );

  // Group by timestamp and sum values
  const timeMap = new Map<string, EquityCurve>();

  for (const point of sorted) {
    const existing = timeMap.get(point.ts);
    if (existing) {
      // Sum up values from different runs at the same timestamp
      timeMap.set(point.ts, {
        ...existing,
        total_equity: existing.total_equity + point.total_equity,
        binance_equity: existing.binance_equity + point.binance_equity,
        bybit_equity: existing.bybit_equity + point.bybit_equity,
        total_position_value: existing.total_position_value + point.total_position_value,
        binance_position_value: existing.binance_position_value + point.binance_position_value,
        bybit_position_value: existing.bybit_position_value + point.bybit_position_value,
      });
    } else {
      timeMap.set(point.ts, { ...point });
    }
  }

  // Convert back to array and sort
  const merged = Array.from(timeMap.values()).sort(
    (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime()
  );

  // Recalculate drawdown for merged data
  let peakEquity = 0;
  for (const point of merged) {
    peakEquity = Math.max(peakEquity, point.total_equity);
    point.drawdown_pct = peakEquity > 0
      ? ((peakEquity - point.total_equity) / peakEquity) * 100
      : 0;
  }

  return merged;
}

// Merge PnL series data from multiple runs
function mergePnlSeriesData(data: PnlSeries[]): PnlSeries[] {
  if (data.length === 0) return [];

  const sorted = [...data].sort(
    (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime()
  );

  const timeMap = new Map<string, PnlSeries>();

  for (const point of sorted) {
    const existing = timeMap.get(point.ts);
    if (existing) {
      timeMap.set(point.ts, {
        ...existing,
        total_pnl: existing.total_pnl + point.total_pnl,
        total_funding_pnl: existing.total_funding_pnl + point.total_funding_pnl,
        total_price_pnl: existing.total_price_pnl + point.total_price_pnl,
        total_fee: existing.total_fee + point.total_fee,
      });
    } else {
      timeMap.set(point.ts, { ...point });
    }
  }

  return Array.from(timeMap.values()).sort(
    (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime()
  );
}

// Transform functions (same as run-details-content)
function transformEquityCurveData(data: EquityCurve[]): EquityCurveDataPoint[] {
  return data.map((point) => ({
    time: point.ts,
    equity: point.total_equity,
  }));
}

function transformExposureData(data: EquityCurve[]): ExposureDataPoint[] {
  return data.map((point) => {
    const totalEquity = point.total_equity;
    const binanceExposure = totalEquity > 0
      ? (point.binance_position_value / totalEquity) * 100
      : 0;
    const bybitExposure = totalEquity > 0
      ? (point.bybit_position_value / totalEquity) * 100
      : 0;
    const totalExposure = totalEquity > 0
      ? (point.total_position_value / totalEquity) * 100
      : 0;

    return {
      time: point.ts,
      binance_exposure: binanceExposure,
      bybit_exposure: bybitExposure,
      total_exposure: totalExposure,
    };
  });
}

function transformPnlBreakdownData(data: PnlSeries[]): PnLBreakdownDataPoint[] {
  return data.map((point) => ({
    time: point.ts,
    funding_pnl: point.total_funding_pnl,
    price_pnl: point.total_price_pnl,
    total_pnl: point.total_pnl,
    total_fee: point.total_fee,
  }));
}

function transformCumulativePnLData(data: PnlSeries[]): CumulativePnLDataPoint[] {
  return data.map((point) => ({
    time: point.ts,
    cumulative: point.total_pnl,
  }));
}

export function CombinedStrategyContent({
  strategyId,
  initialEquityCurve,
  initialPnlSeries,
  initialCombinedTrades,
  initialCapital,
  runIds,
}: CombinedStrategyContentProps) {
  // State for data
  const [equityCurve, setEquityCurve] = useState<EquityCurve[]>(initialEquityCurve);
  const [pnlSeries, setPnlSeries] = useState<PnlSeries[]>(initialPnlSeries);
  const [combinedTrades, setCombinedTrades] = useState<CombinedTrade[]>(initialCombinedTrades);
  const [isFreshDataLoaded, setIsFreshDataLoaded] = useState(false);
  const hasFetchedRef = useRef(false);

  // Fetch fresh data on mount
  useEffect(() => {
    if (hasFetchedRef.current || runIds.length === 0) return;
    hasFetchedRef.current = true;

    const fetchFreshData = async () => {
      const supabase = createClient();
      console.log(`[Combined] Fetching fresh data for ${runIds.length} runs`);

      const [equityResult, pnlResult, tradesResult] = await Promise.all([
        supabase
          .from("equity_curve")
          .select("*")
          .in("run_id", runIds)
          .order("ts", { ascending: false })
          .limit(10000),
        supabase
          .from("pnl_series")
          .select("*")
          .in("run_id", runIds)
          .order("ts", { ascending: false })
          .limit(10000),
        supabase
          .from("combined_trades")
          .select("*")
          .in("run_id", runIds)
          .order("ts", { ascending: false })
          .limit(10000),
      ]);

      if (equityResult.data) {
        const reversed = [...equityResult.data].reverse() as EquityCurve[];
        console.log(`[Combined] Got ${reversed.length} fresh equity_curve records`);
        setEquityCurve(reversed);
      }
      if (pnlResult.data) {
        const reversed = [...pnlResult.data].reverse() as PnlSeries[];
        console.log(`[Combined] Got ${reversed.length} fresh pnl_series records`);
        setPnlSeries(reversed);
      }
      if (tradesResult.data) {
        const reversed = [...tradesResult.data].reverse() as CombinedTrade[];
        console.log(`[Combined] Got ${reversed.length} fresh combined_trades records`);
        setCombinedTrades(reversed);
      }
      setIsFreshDataLoaded(true);
    };

    fetchFreshData();
  }, [runIds]);

  // Subscribe to realtime updates for all runs
  useEffect(() => {
    if (runIds.length === 0) return;

    const supabase = createClient();
    const channels: ReturnType<typeof supabase.channel>[] = [];

    // Subscribe to each run's updates
    for (const runId of runIds) {
      const channel = supabase
        .channel(`combined-${strategyId}-${runId}-${Date.now()}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "equity_curve",
            filter: `run_id=eq.${runId}`,
          },
          (payload) => {
            const newRecord = payload.new as EquityCurve;
            setEquityCurve((prev) => {
              const updated = [...prev, newRecord];
              return updated.sort((a, b) =>
                new Date(a.ts).getTime() - new Date(b.ts).getTime()
              );
            });
          }
        )
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "pnl_series",
            filter: `run_id=eq.${runId}`,
          },
          (payload) => {
            const newRecord = payload.new as PnlSeries;
            setPnlSeries((prev) => {
              const updated = [...prev, newRecord];
              return updated.sort((a, b) =>
                new Date(a.ts).getTime() - new Date(b.ts).getTime()
              );
            });
          }
        )
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "combined_trades",
            filter: `run_id=eq.${runId}`,
          },
          (payload) => {
            const newRecord = payload.new as CombinedTrade;
            setCombinedTrades((prev) => {
              const updated = [...prev, newRecord];
              return updated.sort((a, b) =>
                new Date(a.ts).getTime() - new Date(b.ts).getTime()
              );
            });
          }
        )
        .subscribe();

      channels.push(channel);
    }

    return () => {
      channels.forEach((channel) => supabase.removeChannel(channel));
    };
  }, [strategyId, runIds]);

  // Merge data from multiple runs
  const mergedEquityCurve = useMemo(() => mergeEquityCurveData(equityCurve), [equityCurve]);
  const mergedPnlSeries = useMemo(() => mergePnlSeriesData(pnlSeries), [pnlSeries]);

  // Transform data for charts
  const equityCurveData = useMemo(() => transformEquityCurveData(mergedEquityCurve), [mergedEquityCurve]);
  const exposureData = useMemo(() => transformExposureData(mergedEquityCurve), [mergedEquityCurve]);
  const pnlBreakdownData = useMemo(() => transformPnlBreakdownData(mergedPnlSeries), [mergedPnlSeries]);
  const cumulativePnLData = useMemo(() => transformCumulativePnLData(mergedPnlSeries), [mergedPnlSeries]);

  // Calculate data time range
  const { dataStartTime, dataEndTime } = useMemo(() => {
    const allTimes: Date[] = [];

    equityCurveData.forEach((d) => allTimes.push(new Date(d.time)));
    pnlBreakdownData.forEach((d) => allTimes.push(new Date(d.time)));
    combinedTrades.forEach((d) => allTimes.push(new Date(d.ts)));

    if (allTimes.length === 0) {
      const now = new Date();
      return { dataStartTime: now, dataEndTime: now };
    }

    const sortedTimes = allTimes.sort((a, b) => a.getTime() - b.getTime());
    return {
      dataStartTime: sortedTimes[0],
      dataEndTime: sortedTimes[sortedTimes.length - 1],
    };
  }, [equityCurveData, pnlBreakdownData, combinedTrades]);

  // Time range state
  const [timeRange, setTimeRange] = useState<TimeRange>({
    start: dataStartTime,
    end: dataEndTime,
  });

  const userChangedRangeRef = useRef(false);
  const dataStartTimestamp = dataStartTime.getTime();
  const dataEndTimestamp = dataEndTime.getTime();

  // Sync time range when fresh data is loaded
  useEffect(() => {
    if (!isFreshDataLoaded) {
      console.log("[Combined TimeRange] Waiting for fresh data to load...");
      return;
    }

    console.log("[Combined TimeRange] Fresh data loaded, syncing time range");
    console.log("[Combined TimeRange] Data range:", new Date(dataStartTimestamp).toISOString(), "-", new Date(dataEndTimestamp).toISOString());

    if (!userChangedRangeRef.current) {
      console.log("[Combined TimeRange] Auto-syncing to full range");
      setTimeRange({
        start: new Date(dataStartTimestamp),
        end: new Date(dataEndTimestamp),
      });
    }
  }, [isFreshDataLoaded, dataStartTimestamp, dataEndTimestamp]);

  // Handle real-time updates - extend time range when new data arrives
  useEffect(() => {
    if (!isFreshDataLoaded) return;

    // If user hasn't manually changed the range, keep syncing to full range
    if (!userChangedRangeRef.current) {
      setTimeRange((prev) => {
        // Only update if the range actually changed
        if (prev.start.getTime() !== dataStartTimestamp || prev.end.getTime() !== dataEndTimestamp) {
          console.log("[Combined TimeRange] Realtime update - syncing to new range");
          return {
            start: new Date(dataStartTimestamp),
            end: new Date(dataEndTimestamp),
          };
        }
        return prev;
      });
    } else {
      // User has manually set a range - only extend if near the data end
      setTimeRange((prev) => {
        const isNearDataEnd = dataEndTimestamp - prev.end.getTime() < 2 * 60 * 1000;
        if (isNearDataEnd && prev.end.getTime() < dataEndTimestamp) {
          console.log("[Combined TimeRange] Auto-extending to new data end");
          return {
            start: prev.start,
            end: new Date(dataEndTimestamp),
          };
        }
        return prev;
      });
    }
  }, [dataEndTimestamp, dataStartTimestamp, isFreshDataLoaded]);

  const handleTimeRangeChange = useCallback((range: TimeRange) => {
    const isAllRange =
      Math.abs(range.start.getTime() - dataStartTime.getTime()) < 1000 &&
      Math.abs(range.end.getTime() - dataEndTime.getTime()) < 1000;
    userChangedRangeRef.current = !isAllRange;
    setTimeRange(range);
  }, [dataStartTime, dataEndTime]);

  const handleChartRangeChange = useCallback((startTime: Date, endTime: Date) => {
    userChangedRangeRef.current = true;
    setTimeRange({ start: startTime, end: endTime });
  }, []);

  // Filter data based on time range
  const filteredEquityCurveData = useMemo(() => {
    return equityCurveData.filter((d) => {
      const time = new Date(d.time);
      return time >= timeRange.start && time <= timeRange.end;
    });
  }, [equityCurveData, timeRange]);

  const filteredExposureData = useMemo(() => {
    return exposureData.filter((d) => {
      const time = new Date(d.time);
      return time >= timeRange.start && time <= timeRange.end;
    });
  }, [exposureData, timeRange]);

  const filteredPnlBreakdownData = useMemo(() => {
    return pnlBreakdownData.filter((d) => {
      const time = new Date(d.time);
      return time >= timeRange.start && time <= timeRange.end;
    });
  }, [pnlBreakdownData, timeRange]);

  const filteredCumulativePnLData = useMemo(() => {
    return cumulativePnLData.filter((d) => {
      const time = new Date(d.time);
      return time >= timeRange.start && time <= timeRange.end;
    });
  }, [cumulativePnLData, timeRange]);

  const filteredCombinedTrades = useMemo(() => {
    return combinedTrades.filter((d) => {
      const time = new Date(d.ts);
      return time >= timeRange.start && time <= timeRange.end;
    });
  }, [combinedTrades, timeRange]);

  const filteredEquityCurve = useMemo(() => {
    return mergedEquityCurve.filter((d) => {
      const time = new Date(d.ts);
      return time >= timeRange.start && time <= timeRange.end;
    });
  }, [mergedEquityCurve, timeRange]);

  // Individual trade PnL data
  const filteredIndividualTradePnLData = useMemo(() => {
    return filteredCombinedTrades
      .filter((trade) => trade.total_pnl !== null)
      .map((trade, index) => ({
        trade: String(index + 1),
        pnl: trade.total_pnl!,
      }));
  }, [filteredCombinedTrades]);

  return (
    <>
      <div className="space-y-3 sm:space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl sm:text-2xl font-bold tracking-tight">Combined Performance</h2>
        </div>

        {/* Performance Stats */}
        <PerformanceStats
          equityCurve={mergedEquityCurve}
          filteredEquityCurve={filteredEquityCurve}
          combinedTrades={combinedTrades}
          filteredCombinedTrades={filteredCombinedTrades}
        />

        {/* Time Range Selector */}
        <TimeRangeSelector
          dataStartTime={dataStartTime}
          dataEndTime={dataEndTime}
          onRangeChange={handleTimeRangeChange}
          currentRange={timeRange}
        />

        {/* Row 1: Equity Curve */}
        <EquityCurveWithBrush
          data={filteredEquityCurveData}
          onRangeChange={handleChartRangeChange}
        />

        {/* Row 2: Exposure */}
        <ExposureChart data={filteredExposureData} />

        {/* Row 3: PnL Breakdown */}
        <PnLBreakdownChart data={filteredPnlBreakdownData} />

        {/* Row 4: Trade PnL Charts */}
        <div className="grid gap-3 sm:gap-6 md:grid-cols-2">
          <IndividualTradePnLChart data={filteredIndividualTradePnLData} />
          <CumulativeTradePnLChart data={filteredCumulativePnLData} />
        </div>
      </div>

      {/* Symbol P&L Chart */}
      <SymbolPnLChart combinedTrades={filteredCombinedTrades} initialCapital={initialCapital} />

      {/* Combined Trades Table */}
      <Card>
        <CardHeader className="px-4 sm:px-6">
          <CardTitle className="text-lg sm:text-xl">All Trades ({filteredCombinedTrades.length})</CardTitle>
        </CardHeader>
        <CardContent className="px-2 sm:px-6">
          <div className="max-h-[500px] sm:max-h-[880px] overflow-auto relative [&_thead]:sticky [&_thead]:top-0 [&_thead]:z-10 [&_thead]:bg-background">
            <CombinedTradesTable
              combinedTrades={filteredCombinedTrades}
              enableHedge={false}
            />
          </div>
        </CardContent>
      </Card>
    </>
  );
}
