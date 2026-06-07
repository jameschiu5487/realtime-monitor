"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { TimeRangeSelector, TimeRange } from "@/components/charts/time-range-selector";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { PerformanceStats } from "@/components/charts/performance-stats";
import {
  mergeStrategyEquity,
  aggregateTotalEquity,
  buildCombinedEquityCurve,
  downsample,
  type ChartDataPoint,
} from "@/lib/utils/equity";
import type { EquityCurve, CombinedTrade } from "@/lib/types/database";

const chartConfig = {
  equity: {
    label: "Total Equity",
    color: "hsl(142 76% 36%)",
  },
} satisfies ChartConfig;

interface OverviewPerformanceChartProps {
  initialEquityData: EquityCurve[];
  initialCombinedTrades: CombinedTrade[];
  runningRunIds: string[];
  /** All run IDs grouped by strategy: strategy_id -> run_id[] */
  strategyRunIds: Record<string, string[]>;
  runToStrategyMap: Record<string, string>;
  shareRatioMap: Record<string, number>;
  /** strategy_id -> strategy name for per-strategy stats display */
  strategyNameMap: Record<string, string>;
}



export function OverviewPerformanceChart({
  initialEquityData,
  initialCombinedTrades,
  runningRunIds,
  strategyRunIds,
  runToStrategyMap,
  shareRatioMap,
  strategyNameMap,
}: OverviewPerformanceChartProps) {
  const [equityData, setEquityData] = useState<EquityCurve[]>(initialEquityData);
  const [combinedTrades, setCombinedTrades] = useState<CombinedTrade[]>(initialCombinedTrades);
  const [isLoadingAll, setIsLoadingAll] = useState(false);
  const [allDataLoaded, setAllDataLoaded] = useState(false);

  // Subscribe to realtime updates for running runs
  useEffect(() => {
    if (runningRunIds.length === 0) return;
    const supabase = createClient();
    const channels: ReturnType<typeof supabase.channel>[] = [];

    for (const runId of runningRunIds) {
      const channel = supabase
        .channel(`overview-${runId}-${Date.now()}`)
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
            setEquityData((prev) => {
              const updated = [...prev, newRecord];
              return updated.sort(
                (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime()
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
              return updated.sort(
                (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime()
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
  }, [runningRunIds]);

  // Load all historical data
  const handleLoadAll = useCallback(async () => {
    if (allDataLoaded || isLoadingAll) return;
    setIsLoadingAll(true);

    const supabase = createClient();
    const allRunIds = Object.values(strategyRunIds).flat();
    const PAGE_SIZE = 1000;

    // Find earliest timestamp in current data to avoid re-fetching
    const earliestTs = equityData.length > 0
      ? equityData.reduce((min, p) => p.ts < min ? p.ts : min, equityData[0].ts)
      : undefined;

    const fetchRunData = async (runId: string): Promise<EquityCurve[]> => {
      const allData: EquityCurve[] = [];
      let offset = 0;
      let hasMore = true;
      while (hasMore) {
        let query = supabase
          .from("equity_curve")
          .select("*")
          .eq("run_id", runId)
          .order("ts", { ascending: true })
          .range(offset, offset + PAGE_SIZE - 1);
        if (earliestTs) {
          query = query.lt("ts", earliestTs);
        }
        const { data } = await query;
        if (data && data.length > 0) {
          allData.push(...(data as EquityCurve[]));
          offset += PAGE_SIZE;
          hasMore = data.length === PAGE_SIZE;
        } else {
          hasMore = false;
        }
      }
      return allData;
    };

    // Also fetch all combined trades
    const fetchRunTrades = async (runId: string): Promise<CombinedTrade[]> => {
      const allData: CombinedTrade[] = [];
      let offset = 0;
      let hasMore = true;
      while (hasMore) {
        const { data } = await supabase
          .from("combined_trades")
          .select("*")
          .eq("run_id", runId)
          .order("ts", { ascending: true })
          .range(offset, offset + PAGE_SIZE - 1);
        if (data && data.length > 0) {
          allData.push(...(data as CombinedTrade[]));
          offset += PAGE_SIZE;
          hasMore = data.length === PAGE_SIZE;
        } else {
          hasMore = false;
        }
      }
      return allData;
    };

    const [equityResults, tradesResults] = await Promise.all([
      Promise.all(allRunIds.map(fetchRunData)),
      Promise.all(allRunIds.map(fetchRunTrades)),
    ]);
    const historicalData = equityResults.flat();
    const allTrades = tradesResults.flat();

    setEquityData((current) => {
      const keySet = new Set(historicalData.map(d => `${d.ts}_${d.run_id}`));
      const currentOnly = current.filter(d => !keySet.has(`${d.ts}_${d.run_id}`));
      return [...historicalData, ...currentOnly].sort(
        (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime()
      );
    });

    setCombinedTrades(allTrades.sort(
      (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime()
    ));

    setAllDataLoaded(true);
    setIsLoadingAll(false);
  }, [equityData, strategyRunIds, allDataLoaded, isLoadingAll]);

  // Merge equity per strategy
  const mergedPerStrategy = useMemo(() => {
    const grouped = new Map<string, EquityCurve[]>();
    for (const point of equityData) {
      const strategyId = runToStrategyMap[point.run_id];
      if (!strategyId) continue;
      const arr = grouped.get(strategyId) || [];
      arr.push(point);
      grouped.set(strategyId, arr);
    }

    const merged = new Map<string, EquityCurve[]>();
    for (const [strategyId, data] of grouped) {
      merged.set(strategyId, mergeStrategyEquity(data));
    }
    return merged;
  }, [equityData, runToStrategyMap]);

  // Aggregate across strategies (for chart)
  const chartData = useMemo(() => {
    const raw = aggregateTotalEquity(mergedPerStrategy, shareRatioMap);
    return downsample(raw);
  }, [mergedPerStrategy, shareRatioMap]);

  // Build combined EquityCurve for PerformanceStats
  const combinedEquityCurve = useMemo(
    () => buildCombinedEquityCurve(mergedPerStrategy, shareRatioMap),
    [mergedPerStrategy, shareRatioMap]
  );

  // Time range
  const { dataStartTime, dataEndTime } = useMemo(() => {
    if (chartData.length === 0) {
      const now = new Date();
      return { dataStartTime: now, dataEndTime: now };
    }
    return {
      dataStartTime: new Date(chartData[0].time),
      dataEndTime: new Date(chartData[chartData.length - 1].time),
    };
  }, [chartData]);

  const [timeRange, setTimeRange] = useState<TimeRange>({
    start: dataStartTime,
    end: dataEndTime,
  });

  const hasInitializedRef = useRef(false);
  const dataStartTimestamp = dataStartTime.getTime();
  const dataEndTimestamp = dataEndTime.getTime();

  // Initial sync: default to 1w
  useEffect(() => {
    if (hasInitializedRef.current || chartData.length === 0) return;
    hasInitializedRef.current = true;
    const end = new Date(dataEndTimestamp);
    const weekAgo = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
    const start = weekAgo < new Date(dataStartTimestamp) ? new Date(dataStartTimestamp) : weekAgo;
    setTimeRange({ start, end });
  }, [chartData.length, dataStartTimestamp, dataEndTimestamp]);

  // Extend end on new data
  useEffect(() => {
    if (!hasInitializedRef.current) return;
    setTimeRange((prev) => {
      if (dataEndTimestamp > prev.end.getTime()) {
        return { start: prev.start, end: new Date(dataEndTimestamp) };
      }
      return prev;
    });
  }, [dataEndTimestamp]);

  const handleTimeRangeChange = useCallback((range: TimeRange) => {
    setTimeRange(range);
  }, []);

  // Filter chart data by time range
  const filteredChartData = useMemo(() => {
    return chartData.filter((d) => {
      return d.time >= timeRange.start.getTime() && d.time <= timeRange.end.getTime();
    });
  }, [chartData, timeRange]);

  // Filter combined equity curve by time range (for PerformanceStats)
  const filteredEquityCurve = useMemo(() => {
    return combinedEquityCurve.filter((d) => {
      const time = new Date(d.ts).getTime();
      return time >= timeRange.start.getTime() && time <= timeRange.end.getTime();
    });
  }, [combinedEquityCurve, timeRange]);

  // Filter combined trades by time range
  const filteredCombinedTrades = useMemo(() => {
    return combinedTrades.filter((d) => {
      const time = new Date(d.ts).getTime();
      return time >= timeRange.start.getTime() && time <= timeRange.end.getTime();
    });
  }, [combinedTrades, timeRange]);

  // Per-strategy filtered data for individual strategy stats
  const perStrategyStats = useMemo(() => {
    const strategyIds = Array.from(mergedPerStrategy.keys());
    return strategyIds.map((strategyId) => {
      // Build combined equity curve for this single strategy
      const singleStrategyMap = new Map<string, EquityCurve[]>();
      singleStrategyMap.set(strategyId, mergedPerStrategy.get(strategyId) || []);
      const equityCurve = buildCombinedEquityCurve(singleStrategyMap, shareRatioMap);

      // Filter by time range
      const filteredEquity = equityCurve.filter((d) => {
        const time = new Date(d.ts).getTime();
        return time >= timeRange.start.getTime() && time <= timeRange.end.getTime();
      });

      // Filter trades for this strategy's runs
      const runIdsForStrategy = new Set(strategyRunIds[strategyId] || []);
      const filteredTrades = combinedTrades.filter((d) => {
        if (!runIdsForStrategy.has(d.run_id)) return false;
        const time = new Date(d.ts).getTime();
        return time >= timeRange.start.getTime() && time <= timeRange.end.getTime();
      });

      return {
        strategyId,
        strategyName: strategyNameMap[strategyId] ?? "Unknown",
        filteredEquity,
        filteredTrades,
        runCount: strategyRunIds[strategyId]?.length ?? 0,
      };
    });
  }, [mergedPerStrategy, shareRatioMap, timeRange, combinedTrades, strategyRunIds, strategyNameMap]);

  // Compute P&L for selected time range
  const rangePnl = useMemo(() => {
    if (filteredChartData.length < 2) return { pnl: 0, pct: 0, hasData: false };
    const startEquity = filteredChartData[0].equity;
    const endEquity = filteredChartData[filteredChartData.length - 1].equity;
    const pnl = endEquity - startEquity;
    const pct = startEquity > 0 ? (pnl / startEquity) * 100 : 0;
    return { pnl, pct, hasData: true };
  }, [filteredChartData]);

  if (chartData.length === 0) {
    return (
      <div className="flex h-[220px] sm:h-[300px] items-center justify-center text-sm text-muted-foreground">
        No equity data available
      </div>
    );
  }

  // Y-axis domain
  const allValues = filteredChartData.map((d) => d.equity);
  const minValue = allValues.length > 0 ? Math.min(...allValues) : 0;
  const maxValue = allValues.length > 0 ? Math.max(...allValues) : 0;
  const padding = (maxValue - minValue) * 0.1 || 10;
  const yMin = Math.floor(minValue - padding);
  const yMax = Math.ceil(maxValue + padding);

  return (
    <div className="space-y-3">
      {/* Range P&L */}
      <div className="flex items-baseline gap-3 px-1">
        <span
          className={cn(
            "text-xl sm:text-2xl font-bold font-mono tabular-nums",
            rangePnl.hasData
              ? rangePnl.pnl > 0
                ? "text-emerald-500"
                : rangePnl.pnl < 0
                  ? "text-red-500"
                  : ""
              : ""
          )}
        >
          {rangePnl.hasData ? (
            <>
              {rangePnl.pnl >= 0 ? "+" : "-"}$
              {Math.abs(rangePnl.pnl).toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </>
          ) : (
            "--"
          )}
        </span>
        <span
          className={cn(
            "text-sm font-mono",
            rangePnl.hasData
              ? rangePnl.pnl > 0
                ? "text-emerald-500/70"
                : rangePnl.pnl < 0
                  ? "text-red-500/70"
                  : "text-muted-foreground"
              : "text-muted-foreground"
          )}
        >
          {rangePnl.hasData
            ? `${rangePnl.pct >= 0 ? "+" : ""}${rangePnl.pct.toFixed(2)}%`
            : ""}
        </span>
      </div>

      <TimeRangeSelector
        dataStartTime={dataStartTime}
        dataEndTime={dataEndTime}
        onRangeChange={handleTimeRangeChange}
        currentRange={timeRange}
        onLoadAll={handleLoadAll}
        isLoadingAll={isLoadingAll}
        allDataLoaded={allDataLoaded}
      />
      <ChartContainer
        config={chartConfig}
        className="aspect-auto h-[220px] sm:h-[300px] w-full"
      >
        <AreaChart
          accessibilityLayer
          data={filteredChartData}
          margin={{ left: 4, right: 4 }}
        >
          <defs>
            <linearGradient id="fillEquityOverview" x1="0" y1="0" x2="0" y2="1">
              <stop
                offset="5%"
                stopColor="hsl(142 76% 36%)"
                stopOpacity={0.8}
              />
              <stop
                offset="95%"
                stopColor="hsl(142 76% 36%)"
                stopOpacity={0.1}
              />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="time"
            type="number"
            scale="time"
            domain={["dataMin", "dataMax"]}
            tickLine={false}
            axisLine={false}
            tickMargin={6}
            minTickGap={60}
            tickFormatter={(value) => {
              const date = new Date(value);
              // Show date+time if range > 1 day
              const rangeMs = timeRange.end.getTime() - timeRange.start.getTime();
              if (rangeMs > 24 * 60 * 60 * 1000) {
                return date.toLocaleString("en-US", {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                  hour12: false,
                });
              }
              return date.toLocaleString("en-US", {
                hour: "2-digit",
                minute: "2-digit",
                hour12: false,
              });
            }}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            tickMargin={4}
            width={52}
            domain={[yMin, yMax]}
            tickFormatter={(value) => {
              const num = Number(value);
              if (num >= 1000000) return `$${(num / 1000000).toFixed(1)}M`;
              if (num >= 1000) return `$${(num / 1000).toFixed(1)}K`;
              return `$${num.toLocaleString()}`;
            }}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                className="w-[180px]"
                labelFormatter={(_value, payload) => {
                  const time = payload?.[0]?.payload?.time;
                  if (!time) return "Invalid Date";
                  const date = new Date(time);
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
          <Area
            dataKey="equity"
            name="Total Equity"
            type="monotone"
            fill="url(#fillEquityOverview)"
            stroke="hsl(142 76% 36%)"
            strokeWidth={2}
          />
        </AreaChart>
      </ChartContainer>

      {/* Combined Performance Stats */}
      <PerformanceStats
        filteredEquityCurve={filteredEquityCurve}
        filteredCombinedTrades={filteredCombinedTrades}
      />

      {/* Per-Strategy Stats */}
      {perStrategyStats.length > 1 && (
        <div className="space-y-4 pt-2">
          <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
            Per Strategy
          </h3>
          {perStrategyStats.map((s) => (
            <div key={s.strategyId} className="space-y-2">
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                <h4 className="text-sm sm:text-base font-semibold">{s.strategyName}</h4>
                <span className="text-xs font-mono text-muted-foreground">
                  {s.runCount} {s.runCount === 1 ? "run" : "runs"}
                </span>
              </div>
              <PerformanceStats
                filteredEquityCurve={s.filteredEquity}
                filteredCombinedTrades={s.filteredTrades}
                shareRatio={shareRatioMap[s.strategyId] ?? 1}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
