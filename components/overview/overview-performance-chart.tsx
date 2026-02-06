"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { createClient } from "@/lib/supabase/client";
import type { EquityCurve } from "@/lib/types/database";

const chartConfig = {
  equity: {
    label: "Total Equity",
    color: "hsl(142 76% 36%)",
  },
} satisfies ChartConfig;

interface OverviewPerformanceChartProps {
  initialEquityData: EquityCurve[];
  runningRunIds: string[];
  runToStrategyMap: Record<string, string>; // run_id -> strategy_id
}

interface ChartDataPoint {
  time: number;
  equity: number;
}

/**
 * Aggregate equity by strategy, then sum across strategies.
 *
 * Within each strategy, multiple runs are sequential (not concurrent).
 * At each timestamp, pick the latest run's value for that strategy.
 * Then sum across all strategies.
 */
function aggregateTotalEquity(
  data: EquityCurve[],
  runToStrategy: Record<string, string>
): ChartDataPoint[] {
  if (!data || data.length === 0) return [];

  // Group equity points by strategy_id, merging all runs within a strategy
  const byStrategy = new Map<string, EquityCurve[]>();
  for (const point of data) {
    const strategyId = runToStrategy[point.run_id];
    if (!strategyId) continue;
    const arr = byStrategy.get(strategyId) || [];
    arr.push(point);
    byStrategy.set(strategyId, arr);
  }

  // Sort each strategy's data by ts, then dedup by timestamp (latest run wins)
  for (const [strategyId, arr] of byStrategy) {
    const sorted = arr.sort(
      (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime()
    );
    // Dedup: if same timestamp from different runs, keep the last one (latest inserted)
    const deduped = new Map<string, EquityCurve>();
    for (const point of sorted) {
      deduped.set(point.ts, point);
    }
    byStrategy.set(
      strategyId,
      Array.from(deduped.values()).sort(
        (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime()
      )
    );
  }

  // Collect all unique timestamps across all strategies
  const allTimestamps = new Set<number>();
  for (const arr of byStrategy.values()) {
    for (const point of arr) {
      allTimestamps.add(new Date(point.ts).getTime());
    }
  }

  const sortedTimestamps = Array.from(allTimestamps).sort((a, b) => a - b);

  // Find the first timestamp where all strategies have data
  // This prevents a visual spike when new strategies join
  const strategyStartTimes = new Map<string, number>();
  for (const [strategyId, arr] of byStrategy) {
    if (arr.length > 0) {
      strategyStartTimes.set(strategyId, new Date(arr[0].ts).getTime());
    }
  }
  const latestStartTime = Math.max(...strategyStartTimes.values());

  // Forward-fill per strategy and sum at each timestamp
  const strategyIndices = new Map<string, number>();
  const lastValues = new Map<string, number>();
  for (const strategyId of byStrategy.keys()) {
    strategyIndices.set(strategyId, 0);
  }

  const result: ChartDataPoint[] = [];

  for (const ts of sortedTimestamps) {
    for (const [strategyId, strategyData] of byStrategy) {
      let idx = strategyIndices.get(strategyId) || 0;
      while (
        idx < strategyData.length &&
        new Date(strategyData[idx].ts).getTime() <= ts
      ) {
        lastValues.set(strategyId, strategyData[idx].total_equity);
        idx++;
      }
      strategyIndices.set(strategyId, idx);
    }

    // Only include points after all strategies have started
    if (ts < latestStartTime) continue;

    let total = 0;
    for (const val of lastValues.values()) {
      total += val;
    }

    if (lastValues.size > 0) {
      result.push({ time: ts, equity: total });
    }
  }

  return result;
}

export function OverviewPerformanceChart({
  initialEquityData,
  runningRunIds,
  runToStrategyMap,
}: OverviewPerformanceChartProps) {
  const [equityData, setEquityData] =
    useState<EquityCurve[]>(initialEquityData);
  const hasFetchedRef = useRef(false);

  // Fetch fresh last-24h data on mount
  useEffect(() => {
    if (hasFetchedRef.current) return;
    hasFetchedRef.current = true;

    const runIds = [
      ...new Set([
        ...initialEquityData.map((d) => d.run_id),
        ...runningRunIds,
      ]),
    ];
    if (runIds.length === 0) return;

    const fetchFreshData = async () => {
      const supabase = createClient();
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const PAGE_SIZE = 1000;
      const allData: EquityCurve[] = [];
      let offset = 0;
      let hasMore = true;

      while (hasMore) {
        const { data, error } = await supabase
          .from("equity_curve")
          .select("*")
          .in("run_id", runIds)
          .gte("ts", since)
          .order("ts", { ascending: true })
          .range(offset, offset + PAGE_SIZE - 1);

        if (error) {
          console.error("[Overview] Error fetching equity_curve:", error);
          break;
        }

        if (data && data.length > 0) {
          allData.push(...(data as EquityCurve[]));
          offset += PAGE_SIZE;
          hasMore = data.length === PAGE_SIZE;
        } else {
          hasMore = false;
        }
      }

      if (allData.length > 0) {
        setEquityData(allData);
      }
    };

    fetchFreshData();
  }, [initialEquityData, runningRunIds]);

  // Subscribe to realtime updates for running runs
  useEffect(() => {
    if (runningRunIds.length === 0) return;

    const supabase = createClient();
    const channels: ReturnType<typeof supabase.channel>[] = [];

    for (const runId of runningRunIds) {
      const channel = supabase
        .channel(`overview-equity-${runId}-${Date.now()}`)
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
                (a, b) =>
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
  }, [runningRunIds]);

  const chartData = useMemo(
    () => aggregateTotalEquity(equityData, runToStrategyMap),
    [equityData, runToStrategyMap]
  );

  if (chartData.length === 0) {
    return (
      <div className="flex h-[300px] items-center justify-center text-muted-foreground">
        No equity data available
      </div>
    );
  }

  // Y-axis domain
  const allValues = chartData.map((d) => d.equity);
  const minValue = Math.min(...allValues);
  const maxValue = Math.max(...allValues);
  const padding = (maxValue - minValue) * 0.1 || 10;
  const yMin = Math.floor(minValue - padding);
  const yMax = Math.ceil(maxValue + padding);

  return (
    <ChartContainer
      config={chartConfig}
      className="aspect-auto h-[300px] w-full"
    >
      <AreaChart
        accessibilityLayer
        data={chartData}
        margin={{ left: 12, right: 12 }}
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
          tickMargin={8}
          minTickGap={48}
          tickFormatter={(value) => {
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
        <YAxis
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          domain={[yMin, yMax]}
          tickFormatter={(value) => `$${Number(value).toLocaleString()}`}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              className="w-[180px]"
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
  );
}
