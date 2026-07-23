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
  enableHedge: boolean;
  shareRatio: number;
}

// Downsample time series: if range > 30 days, keep only every 5 minutes
function downsampleTimeSeries<T extends { ts: string }>(data: T[]): T[] {
  if (data.length < 2) return data;
  const sorted = [...data].sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
  const firstTs = new Date(sorted[0].ts).getTime();
  const lastTs = new Date(sorted[sorted.length - 1].ts).getTime();
  const rangeDays = (lastTs - firstTs) / (1000 * 60 * 60 * 24);

  if (rangeDays <= 30) return data;

  const intervalMs = 5 * 60 * 1000;
  const result: T[] = [];
  let lastKeptTs = 0;
  for (const point of sorted) {
    const ts = new Date(point.ts).getTime();
    if (ts - lastKeptTs >= intervalMs || result.length === 0) {
      result.push(point);
      lastKeptTs = ts;
    }
  }
  if (result[result.length - 1] !== sorted[sorted.length - 1]) {
    result.push(sorted[sorted.length - 1]);
  }
  return result;
}

// Merge equity curve data from multiple runs with gap filling (flat line during gaps)
// Gap threshold: if time between consecutive points > 10 minutes, insert a bridge point
const GAP_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

function mergeEquityCurveData(data: EquityCurve[]): EquityCurve[] {
  if (!data || data.length === 0) return [];

  // Sort all data by timestamp
  const sorted = [...data].sort(
    (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime()
  );

  // Group by timestamp - if multiple runs have data at same timestamp, use the latest one
  const timeMap = new Map<string, EquityCurve>();
  for (const point of sorted) {
    timeMap.set(point.ts, { ...point });
  }

  // Convert to array and sort
  const deduped = Array.from(timeMap.values()).sort(
    (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime()
  );

  // Fill gaps with bridge points to create flat lines
  const merged: EquityCurve[] = [];
  for (let i = 0; i < deduped.length; i++) {
    const current = deduped[i];

    // Check if there's a gap before this point
    if (i > 0) {
      const prev = deduped[i - 1];
      const prevTime = new Date(prev.ts).getTime();
      const currentTime = new Date(current.ts).getTime();
      const gap = currentTime - prevTime;

      // If gap > threshold, insert a bridge point just before current point
      // with the previous session's last values (creates flat line during gap)
      if (gap > GAP_THRESHOLD_MS) {
        const bridgeTs = new Date(currentTime - 1).toISOString();
        merged.push({
          ...prev,
          ts: bridgeTs,
          run_id: "bridge",
        });
      }
    }

    merged.push(current);
  }

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
// Each run's values are forward-filled (carry last value), then summed across runs at each timestamp
function mergePnlSeriesData(data: PnlSeries[]): PnlSeries[] {
  if (!data || data.length === 0) return [];

  // Group data by run_id
  const runDataMap = new Map<string, PnlSeries[]>();
  for (const point of data) {
    const runData = runDataMap.get(point.run_id) || [];
    runData.push(point);
    runDataMap.set(point.run_id, runData);
  }

  // Sort each run's data by timestamp
  for (const [runId, runData] of runDataMap) {
    runDataMap.set(
      runId,
      runData.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime())
    );
  }

  // Get all unique timestamps from PnL data only (sorted)
  const allTimestamps = [...new Set(data.map((d) => d.ts))].sort(
    (a, b) => new Date(a).getTime() - new Date(b).getTime()
  );

  // Track index and last value for each run
  const runIndices = new Map<string, number>();
  const lastValues = new Map<string, PnlSeries>();
  for (const runId of runDataMap.keys()) {
    runIndices.set(runId, 0);
  }

  // Build merged data with forward-fill
  const merged: PnlSeries[] = [];

  for (const ts of allTimestamps) {
    const tsTime = new Date(ts).getTime();

    // For each run, advance to find latest data point <= current timestamp
    for (const [runId, runData] of runDataMap) {
      let idx = runIndices.get(runId) || 0;
      while (idx < runData.length && new Date(runData[idx].ts).getTime() <= tsTime) {
        lastValues.set(runId, runData[idx]);
        idx++;
      }
      runIndices.set(runId, idx);
    }

    // Sum all last known values across runs
    let total_pnl = 0;
    let total_funding_pnl = 0;
    let total_price_pnl = 0;
    let total_fee = 0;
    let binance_funding_pnl = 0;
    let binance_price_pnl = 0;
    let binance_fee = 0;
    let bybit_funding_pnl = 0;
    let bybit_price_pnl = 0;
    let bybit_fee = 0;

    for (const lastValue of lastValues.values()) {
      total_pnl += lastValue.total_pnl;
      total_funding_pnl += lastValue.total_funding_pnl;
      total_price_pnl += lastValue.total_price_pnl;
      total_fee += lastValue.total_fee;
      binance_funding_pnl += lastValue.binance_funding_pnl;
      binance_price_pnl += lastValue.binance_price_pnl;
      binance_fee += lastValue.binance_fee;
      bybit_funding_pnl += lastValue.bybit_funding_pnl;
      bybit_price_pnl += lastValue.bybit_price_pnl;
      bybit_fee += lastValue.bybit_fee;
    }

    // Only add if we have at least one value
    if (lastValues.size > 0) {
      merged.push({
        ts,
        run_id: "combined",
        total_pnl,
        total_funding_pnl,
        total_price_pnl,
        total_fee,
        binance_funding_pnl,
        binance_price_pnl,
        binance_fee,
        bybit_funding_pnl,
        bybit_price_pnl,
        bybit_fee,
      });
    }
  }

  return merged;
}

// Transform functions (same as run-details-content)
function transformEquityCurveData(data: EquityCurve[], shareRatio: number): EquityCurveDataPoint[] {
  return data.map((point) => ({
    time: point.ts,
    equity: point.total_equity * shareRatio,
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

function transformPnlBreakdownData(data: PnlSeries[], shareRatio: number): PnLBreakdownDataPoint[] {
  return data.map((point) => ({
    time: point.ts,
    funding_pnl: point.total_funding_pnl * shareRatio,
    price_pnl: point.total_price_pnl * shareRatio,
    total_pnl: point.total_pnl * shareRatio,
    total_fee: point.total_fee * shareRatio,
  }));
}

export function CombinedStrategyContent({
  strategyId,
  initialEquityCurve,
  initialPnlSeries,
  initialCombinedTrades,
  initialCapital,
  runIds,
  enableHedge,
  shareRatio,
}: CombinedStrategyContentProps) {
  // State: single source of truth
  const [equityCurve, setEquityCurve] = useState<EquityCurve[]>(initialEquityCurve);
  const [pnlSeries, setPnlSeries] = useState<PnlSeries[]>(initialPnlSeries);
  const [combinedTrades, setCombinedTrades] = useState<CombinedTrade[]>(initialCombinedTrades);
  const [isFreshDataLoaded] = useState(true); // server already provided initial data
  const [isLoadingAll, setIsLoadingAll] = useState(false);
  const [allDataLoaded, setAllDataLoaded] = useState(false);

  // Fetch all data for a single run with pagination
  const fetchRunData = useCallback(async <T,>(
    supabase: ReturnType<typeof createClient>,
    table: string,
    runId: string,
  ): Promise<T[]> => {
    const PAGE_SIZE = 1000;
    const allData: T[] = [];
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const { data, error } = await supabase
        .from(table)
        .select("*")
        .eq("run_id", runId)
        .order("ts", { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);

      if (error) {
        console.error(`[Combined] Error fetching ${table} for ${runId}:`, error);
        break;
      }

      if (data && data.length > 0) {
        allData.push(...(data as T[]));
        offset += PAGE_SIZE;
        hasMore = data.length === PAGE_SIZE;
      } else {
        hasMore = false;
      }
    }

    return allData;
  }, []);

  // Fetch data for all runs in parallel (per-run queries to avoid timeout)
  const fetchAllRunsData = useCallback(async <T,>(
    supabase: ReturnType<typeof createClient>,
    table: string,
    ids: string[],
  ): Promise<T[]> => {
    const results = await Promise.all(
      ids.map(id => fetchRunData<T>(supabase, table, id))
    );
    return results.flat().sort(
      (a: any, b: any) => new Date(a.ts).getTime() - new Date(b.ts).getTime()
    );
  }, [fetchRunData]);

  // Load all data on demand (when user clicks > 1w or All)
  const handleLoadAll = useCallback(async () => {
    if (allDataLoaded || isLoadingAll) return;
    setIsLoadingAll(true);
    console.log(`[Combined] Loading all data for runIds: ${runIds.join(", ")}`);

    const supabase = createClient();
    const [allEquity, allPnl, allTrades] = await Promise.all([
      fetchAllRunsData<EquityCurve>(supabase, "equity_curve", runIds),
      fetchAllRunsData<PnlSeries>(supabase, "pnl_series", runIds),
      fetchAllRunsData<CombinedTrade>(supabase, "combined_trades", runIds),
    ]);

    console.log(`[Combined] Fetched all data: equity=${allEquity.length}, pnl=${allPnl.length}, trades=${allTrades.length}`);
    if (allEquity.length > 0) {
      const first = allEquity[0].ts;
      const last = allEquity[allEquity.length - 1].ts;
      console.log(`[Combined] Equity range: ${first} to ${last}`);
    }

    // Merge fetched data with current state (keep realtime records that may not be in DB yet)
    setEquityCurve((current) => {
      const keySet = new Set(allEquity.map(d => `${d.ts}_${d.run_id}`));
      const realtimeOnly = current.filter(d => !keySet.has(`${d.ts}_${d.run_id}`));
      const merged = [...allEquity, ...realtimeOnly].sort(
        (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime()
      );
      const ds = downsampleTimeSeries(merged);
      console.log(`[Combined] Final equity: ${allEquity.length} (DB) + ${realtimeOnly.length} (realtime) = ${merged.length} -> ${ds.length} (downsampled)`);
      return ds;
    });

    setPnlSeries((current) => {
      const keySet = new Set(allPnl.map(d => `${d.ts}_${d.run_id}`));
      const realtimeOnly = current.filter(d => !keySet.has(`${d.ts}_${d.run_id}`));
      const merged = [...allPnl, ...realtimeOnly].sort(
        (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime()
      );
      const ds = downsampleTimeSeries(merged);
      console.log(`[Combined] Final pnl: ${allPnl.length} (DB) + ${realtimeOnly.length} (realtime) = ${merged.length} -> ${ds.length} (downsampled)`);
      return ds;
    });

    setCombinedTrades(allTrades);
    setAllDataLoaded(true);
    setIsLoadingAll(false);
  }, [runIds, allDataLoaded, isLoadingAll, fetchAllRunsData]);

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
  const mergedEquityCurve = useMemo(() => {
    console.log(`[Combined] Raw equity curve count: ${equityCurve.length}`);
    if (equityCurve.length > 0) {
      const sorted = [...equityCurve].sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
      console.log(`[Combined] Raw equity curve range: ${sorted[0].ts} to ${sorted[sorted.length - 1].ts}`);
    }
    const merged = mergeEquityCurveData(equityCurve);
    console.log(`[Combined] Merged equity curve count: ${merged.length}`);
    if (merged.length > 0) {
      console.log(`[Combined] Merged equity curve range: ${merged[0].ts} to ${merged[merged.length - 1].ts}`);
    }
    return merged;
  }, [equityCurve]);
  const mergedPnlSeries = useMemo(() => mergePnlSeriesData(pnlSeries), [pnlSeries]);

  // Transform data for charts (with share ratio scaling)
  const equityCurveData = useMemo(() => transformEquityCurveData(mergedEquityCurve, shareRatio), [mergedEquityCurve, shareRatio]);
  const exposureData = useMemo(() => transformExposureData(mergedEquityCurve), [mergedEquityCurve]);
  const pnlBreakdownData = useMemo(() => transformPnlBreakdownData(mergedPnlSeries, shareRatio), [mergedPnlSeries, shareRatio]);

  // Calculate data time range
  const { dataStartTime, dataEndTime } = useMemo(() => {
    const allTimes: Date[] = [];

    equityCurveData.forEach((d) => allTimes.push(new Date(d.time)));
    pnlBreakdownData.forEach((d) => allTimes.push(new Date(d.time)));
    combinedTrades.forEach((d) => allTimes.push(new Date(d.ts)));

    console.log(`[Combined TimeRange] Calculating time range from: ${equityCurveData.length} equity points, ${pnlBreakdownData.length} pnl points, ${combinedTrades.length} trades`);

    if (allTimes.length === 0) {
      const now = new Date();
      console.log(`[Combined TimeRange] No data, using current time`);
      return { dataStartTime: now, dataEndTime: now };
    }

    const sortedTimes = allTimes.sort((a, b) => a.getTime() - b.getTime());
    console.log(`[Combined TimeRange] Calculated range: ${sortedTimes[0].toISOString()} to ${sortedTimes[sortedTimes.length - 1].toISOString()}`);
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

  const dataStartTimestamp = dataStartTime.getTime();
  const dataEndTimestamp = dataEndTime.getTime();

  // Initial sync: default to 1w on first load only
  const hasInitializedRangeRef = useRef(false);
  useEffect(() => {
    if (!isFreshDataLoaded || hasInitializedRangeRef.current) return;
    hasInitializedRangeRef.current = true;

    const end = new Date(dataEndTimestamp);
    const weekAgo = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
    const start = weekAgo < new Date(dataStartTimestamp) ? new Date(dataStartTimestamp) : weekAgo;
    console.log("[Combined TimeRange] Initial sync to 1w range");
    setTimeRange({ start, end });
  }, [isFreshDataLoaded, dataStartTimestamp, dataEndTimestamp]);

  // Realtime: extend time range end when new data arrives (keep user's start)
  useEffect(() => {
    if (!isFreshDataLoaded || !hasInitializedRangeRef.current) return;

    setTimeRange((prev) => {
      if (dataEndTimestamp > prev.end.getTime()) {
        return { start: prev.start, end: new Date(dataEndTimestamp) };
      }
      return prev;
    });
  }, [dataEndTimestamp, isFreshDataLoaded]);

  const handleTimeRangeChange = useCallback((range: TimeRange) => {
    console.log(`[Combined TimeRange] User changed range: ${range.start.toISOString()} to ${range.end.toISOString()}`);
    setTimeRange(range);
  }, []);

  const handleChartRangeChange = useCallback((startTime: Date, endTime: Date) => {
    setTimeRange({ start: startTime, end: endTime });
  }, []);

  // Filter data based on time range
  const filteredEquityCurveData = useMemo(() => {
    return equityCurveData.filter((d) => {
      const time = new Date(d.time);
      return time >= timeRange.start && time <= timeRange.end;
    });
  }, [equityCurveData, timeRange]);

  // Baseline = equity at the start of the earliest run (first point of the full,
  // unfiltered series so zooming/time-range doesn't shift the reference).
  const baselineEquity = useMemo(
    () => (equityCurveData.length > 0 ? equityCurveData[0].equity : 0),
    [equityCurveData]
  );

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

  // Cumulative Trade PnL = equity-based P&L (current − run-start equity), filtered
  // to the selected time range. Baseline is the run-start equity, not the window start.
  const filteredCumulativePnLData = useMemo(
    () =>
      filteredEquityCurveData.map((d) => ({
        time: d.time,
        cumulative: d.equity - baselineEquity,
      })),
    [filteredEquityCurveData, baselineEquity]
  );

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
  // Individual trade PnL data with hedge pairing support
  const filteredIndividualTradePnLData = useMemo(() => {
    if (!enableHedge) {
      // Non-hedge mode: filter and re-index
      return filteredCombinedTrades
        .filter((trade) => trade.total_pnl !== null)
        .map((trade, index) => ({
          trade: String(index + 1),
          pnl: trade.total_pnl! * shareRatio,
        }));
    }

    // Hedge mode: group into pairs and sum P&L
    const sorted = [...filteredCombinedTrades].sort(
      (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime()
    );
    const used = new Set<number>();
    const pairPnLs: number[] = [];

    for (let i = 0; i < sorted.length; i++) {
      if (used.has(sorted[i].combined_trade_id)) continue;

      const trade1 = sorted[i];
      let matchIndex = -1;

      for (let j = i + 1; j < sorted.length; j++) {
        if (used.has(sorted[j].combined_trade_id)) continue;
        const trade2 = sorted[j];

        if (trade2.symbol === trade1.symbol && trade2.exchange !== trade1.exchange) {
          const timeDiff = Math.abs(
            new Date(trade2.ts).getTime() - new Date(trade1.ts).getTime()
          );
          if (timeDiff <= 60 * 1000) {
            matchIndex = j;
            break;
          }
        }
      }

      if (matchIndex !== -1) {
        const trade2 = sorted[matchIndex];
        used.add(trade1.combined_trade_id);
        used.add(trade2.combined_trade_id);
        const pairPnl = ((trade1.total_pnl ?? 0) + (trade2.total_pnl ?? 0)) * shareRatio;
        pairPnLs.push(pairPnl);
      } else {
        used.add(trade1.combined_trade_id);
        if (trade1.total_pnl !== null) {
          pairPnLs.push(trade1.total_pnl * shareRatio);
        }
      }
    }

    return pairPnLs.map((pnl, index) => ({
      trade: String(index + 1),
      pnl,
    }));
  }, [filteredCombinedTrades, enableHedge, shareRatio]);

  return (
    <>
      <div className="space-y-3 sm:space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl sm:text-2xl font-bold tracking-tight">Combined Performance</h2>
        </div>

        {/* Performance Stats */}
        <PerformanceStats
          filteredEquityCurve={filteredEquityCurve}
          filteredCombinedTrades={filteredCombinedTrades}
          shareRatio={shareRatio}
        />

        {/* Time Range Selector */}
        <TimeRangeSelector
          dataStartTime={dataStartTime}
          dataEndTime={dataEndTime}
          onRangeChange={handleTimeRangeChange}
          currentRange={timeRange}
          onLoadAll={handleLoadAll}
          isLoadingAll={isLoadingAll}
          allDataLoaded={allDataLoaded}
        />

        {/* Row 1: Equity Curve */}
        <EquityCurveWithBrush
          data={filteredEquityCurveData}
          onRangeChange={handleChartRangeChange}
          initEquity={baselineEquity}
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
              enableHedge={enableHedge}
              shareRatio={shareRatio}
            />
          </div>
        </CardContent>
      </Card>
    </>
  );
}
