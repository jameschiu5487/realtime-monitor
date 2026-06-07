"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Loader2, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { PerformanceStats } from "@/components/charts/performance-stats";
import { DatePickerField } from "@/components/report/date-picker-field";
import { createClient } from "@/lib/supabase/client";
import {
  mergeStrategyEquity,
  aggregateTotalEquity,
  buildCombinedEquityCurve,
  downsample,
  fillRangeBoundaries,
  type ChartDataPoint,
} from "@/lib/utils/equity";
import type {
  Strategy,
  StrategyRun,
  EquityCurve,
  CombinedTrade,
} from "@/lib/types/database";

const chartConfig = {
  equity: {
    label: "Equity",
    color: "hsl(142 76% 36%)",
  },
} satisfies ChartConfig;

interface ReportContentProps {
  allStrategies: Strategy[];
  allRuns: StrategyRun[];
  shareRatioMap: Record<string, number>;
}

const SESSION_KEY = "report-state";

interface SerializedState {
  startDate: string | null;
  endDate: string | null;
  selectedStrategyIds: string[];
  forwardFillIds: string[];
  result: {
    strategyEquity: [string, EquityCurve[]][];
    strategyCombinedTrades: [string, CombinedTrade[]][];
    totalChartData: ChartDataPoint[];
    totalEquityCurve: EquityCurve[];
    totalCombinedTrades: CombinedTrade[];
  } | null;
}

interface ReportResult {
  // Per-strategy data
  strategyEquity: Map<string, EquityCurve[]>;
  strategyCombinedTrades: Map<string, CombinedTrade[]>;
  // Aggregated
  totalChartData: ChartDataPoint[];
  totalEquityCurve: EquityCurve[];
  totalCombinedTrades: CombinedTrade[];
}

function findOverlappingRuns(
  runs: StrategyRun[],
  strategyId: string,
  rangeStart: Date,
  rangeEnd: Date
): StrategyRun[] {
  return runs.filter(
    (r) =>
      r.strategy_id === strategyId &&
      new Date(r.start_time) < rangeEnd &&
      (r.end_time === null || new Date(r.end_time) > rangeStart)
  );
}

async function fetchPaginated<T>(
  table: string,
  runIds: string[],
  startDate: Date,
  endDate: Date
): Promise<T[]> {
  if (runIds.length === 0) return [];
  const supabase = createClient();
  const PAGE_SIZE = 1000;
  const allData: T[] = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .in("run_id", runIds)
      .gte("ts", startDate.toISOString())
      .lte("ts", endDate.toISOString())
      .order("ts", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) {
      console.error(`Error fetching ${table}:`, error);
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
}

function formatPrice(price: number): string {
  if (price >= 1000000) return `$${(price / 1000000).toFixed(2)}M`;
  if (price >= 1000) return `$${(price / 1000).toFixed(2)}K`;
  return `$${price.toFixed(2)}`;
}

function EquityChart({ data, height = 300 }: { data: ChartDataPoint[]; height?: number }) {
  const displayData = useMemo(() => downsample(data), [data]);

  const yDomain = useMemo(() => {
    if (displayData.length === 0) return [0, 100];
    const values = displayData.map((d) => d.equity);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const padding = (max - min) * 0.1 || 100;
    return [Math.floor(min - padding), Math.ceil(max + padding)];
  }, [displayData]);

  if (displayData.length === 0) {
    return (
      <div className="flex items-center justify-center text-muted-foreground" style={{ height }}>
        No data
      </div>
    );
  }

  return (
    <ChartContainer config={chartConfig} className="w-full" style={{ height }}>
      <AreaChart data={displayData} margin={{ left: 10, right: 10, top: 10, bottom: 0 }}>
        <defs>
          <linearGradient id="fillEquityReport" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="hsl(142 76% 36%)" stopOpacity={0.8} />
            <stop offset="95%" stopColor="hsl(142 76% 36%)" stopOpacity={0.1} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="time"
          type="number"
          domain={["dataMin", "dataMax"]}
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={80}
          tickFormatter={(value) => {
            const date = new Date(value);
            return date.toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            });
          }}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          domain={yDomain}
          tickFormatter={formatPrice}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(_, payload) => {
                if (payload?.[0]?.payload?.time) {
                  return new Date(payload[0].payload.time).toLocaleString("en-US", {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  });
                }
                return "";
              }}
              formatter={(value) => formatPrice(value as number)}
            />
          }
        />
        <Area
          dataKey="equity"
          type="monotone"
          fill="url(#fillEquityReport)"
          stroke="hsl(142 76% 36%)"
          strokeWidth={2}
          isAnimationActive={false}
        />
      </AreaChart>
    </ChartContainer>
  );
}

export function ReportContent({ allStrategies, allRuns, shareRatioMap }: ReportContentProps) {
  const [startDate, setStartDate] = useState<Date | undefined>();
  const [endDate, setEndDate] = useState<Date | undefined>();
  const [selectedStrategyIds, setSelectedStrategyIds] = useState<Set<string>>(new Set());
  const [forwardFillIds, setForwardFillIds] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(false);
  const [reportResult, setReportResult] = useState<ReportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ total: number; completed: number; currentName: string }>({
    total: 0,
    completed: 0,
    currentName: "",
  });

  const restoredRef = useRef(false);

  // Restore state from sessionStorage on mount
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return;
      const saved: SerializedState = JSON.parse(raw);
      if (saved.startDate) setStartDate(new Date(saved.startDate));
      if (saved.endDate) setEndDate(new Date(saved.endDate));
      if (saved.selectedStrategyIds?.length) setSelectedStrategyIds(new Set(saved.selectedStrategyIds));
      if (saved.forwardFillIds?.length) setForwardFillIds(new Set(saved.forwardFillIds));
      if (saved.result) {
        setReportResult({
          strategyEquity: new Map(saved.result.strategyEquity),
          strategyCombinedTrades: new Map(saved.result.strategyCombinedTrades),
          totalChartData: saved.result.totalChartData,
          totalEquityCurve: saved.result.totalEquityCurve,
          totalCombinedTrades: saved.result.totalCombinedTrades,
        });
      }
    } catch {}
  }, []);

  // Save state to sessionStorage when results change
  useEffect(() => {
    if (!restoredRef.current) return;
    try {
      const state: SerializedState = {
        startDate: startDate?.toISOString() ?? null,
        endDate: endDate?.toISOString() ?? null,
        selectedStrategyIds: Array.from(selectedStrategyIds),
        forwardFillIds: Array.from(forwardFillIds),
        result: reportResult
          ? {
              strategyEquity: Array.from(reportResult.strategyEquity.entries()),
              strategyCombinedTrades: Array.from(reportResult.strategyCombinedTrades.entries()),
              totalChartData: reportResult.totalChartData,
              totalEquityCurve: reportResult.totalEquityCurve,
              totalCombinedTrades: reportResult.totalCombinedTrades,
            }
          : null,
      };
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(state));
    } catch {}
  }, [startDate, endDate, selectedStrategyIds, forwardFillIds, reportResult]);

  // Group strategies with their run counts
  const strategiesWithRuns = useMemo(() => {
    return allStrategies.map((s) => ({
      ...s,
      runCount: allRuns.filter((r) => r.strategy_id === s.strategy_id).length,
    }));
  }, [allStrategies, allRuns]);

  const toggleStrategy = (strategyId: string) => {
    setSelectedStrategyIds((prev) => {
      const next = new Set(prev);
      if (next.has(strategyId)) {
        next.delete(strategyId);
        // Also remove from forward-fill set
        setForwardFillIds((ff) => {
          const n = new Set(ff);
          n.delete(strategyId);
          return n;
        });
      } else {
        next.add(strategyId);
      }
      return next;
    });
  };

  const toggleForwardFill = (strategyId: string) => {
    setForwardFillIds((prev) => {
      const next = new Set(prev);
      if (next.has(strategyId)) {
        next.delete(strategyId);
      } else {
        next.add(strategyId);
      }
      return next;
    });
  };

  const selectAll = () => {
    setSelectedStrategyIds(new Set(allStrategies.map((s) => s.strategy_id)));
  };

  const deselectAll = () => {
    setSelectedStrategyIds(new Set());
  };

  const strategyNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const s of allStrategies) {
      map[s.strategy_id] = s.name;
    }
    return map;
  }, [allStrategies]);

  const canGenerate = startDate && endDate && selectedStrategyIds.size > 0 && startDate < endDate;

  const handleGenerate = useCallback(async () => {
    if (!startDate || !endDate || selectedStrategyIds.size === 0) return;

    setIsLoading(true);
    setError(null);
    setReportResult(null);

    const strategyIds = Array.from(selectedStrategyIds);
    setProgress({ total: strategyIds.length, completed: 0, currentName: "" });

    try {
      const rangeEnd = new Date(endDate);
      rangeEnd.setHours(23, 59, 59, 999);

      const strategyEquity = new Map<string, EquityCurve[]>();
      const strategyCombinedTrades = new Map<string, CombinedTrade[]>();
      let completedCount = 0;

      // Process all strategies in parallel with progress tracking
      await Promise.all(
        strategyIds.map(async (strategyId) => {
          const overlapping = findOverlappingRuns(allRuns, strategyId, startDate, rangeEnd);
          const runIds = overlapping.map((r) => r.run_id);

          if (runIds.length === 0) {
            strategyEquity.set(strategyId, []);
            strategyCombinedTrades.set(strategyId, []);
          } else {
            const [equityData, tradesData] = await Promise.all([
              fetchPaginated<EquityCurve>("equity_curve", runIds, startDate, rangeEnd),
              fetchPaginated<CombinedTrade>("combined_trades", runIds, startDate, rangeEnd),
            ]);

            // Merge runs (forward-fill between runs, same as overview)
            let merged = mergeStrategyEquity(equityData);
            merged = fillRangeBoundaries(
              merged, overlapping, startDate, rangeEnd,
              forwardFillIds.has(strategyId)
            );

            strategyEquity.set(strategyId, merged);
            strategyCombinedTrades.set(strategyId, tradesData);
          }

          completedCount++;
          const name = strategyNameMap[strategyId] ?? "Unknown";
          setProgress({ total: strategyIds.length, completed: completedCount, currentName: name });
        })
      );

      // Check if we got any data
      const hasData = Array.from(strategyEquity.values()).some((d) => d.length > 0);
      if (!hasData) {
        setError("No runs found in the selected date range.");
        setIsLoading(false);
        return;
      }

      // Aggregation step
      setProgress({ total: strategyIds.length, completed: strategyIds.length, currentName: "Aggregating..." });

      const allCombinedTrades = strategyIds.flatMap((id) => strategyCombinedTrades.get(id) ?? []);

      const totalChartData = aggregateTotalEquity(strategyEquity, shareRatioMap);
      const totalEquityCurve = buildCombinedEquityCurve(strategyEquity, shareRatioMap);

      setReportResult({
        strategyEquity,
        strategyCombinedTrades,
        totalChartData,
        totalEquityCurve,
        totalCombinedTrades: allCombinedTrades,
      });
    } catch (e) {
      console.error("Report generation error:", e);
      setError("Failed to generate report. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }, [startDate, endDate, selectedStrategyIds, forwardFillIds, allRuns, shareRatioMap, strategyNameMap]);

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Report</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Select a date range and strategies to generate performance reports.
        </p>
      </div>

      {/* Configuration */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Report Settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Date Range */}
          <div className="flex items-end gap-4">
            <DatePickerField
              label="Start Date"
              date={startDate}
              onSelect={setStartDate}
              maxDate={new Date()}
            />
            <DatePickerField
              label="End Date"
              date={endDate}
              onSelect={setEndDate}
              maxDate={new Date()}
            />
          </div>

          {/* Strategy Selection */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-sm font-medium text-muted-foreground">Strategies</span>
              <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={selectAll}>
                Select All
              </Button>
              <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={deselectAll}>
                Clear
              </Button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
              {strategiesWithRuns.map((s) => {
                const isSelected = selectedStrategyIds.has(s.strategy_id);
                const isFf = forwardFillIds.has(s.strategy_id);
                return (
                  <div
                    key={s.strategy_id}
                    className="flex items-center gap-2 p-2 rounded-md border hover:bg-accent transition-colors"
                  >
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={() => toggleStrategy(s.strategy_id)}
                    />
                    <span
                      className="text-sm truncate cursor-pointer flex-1"
                      onClick={() => toggleStrategy(s.strategy_id)}
                    >
                      {s.name}
                    </span>
                    {isSelected && (
                      <button
                        type="button"
                        onClick={() => toggleForwardFill(s.strategy_id)}
                        className={`text-[10px] px-1.5 py-0.5 rounded border shrink-0 transition-colors ${
                          isFf
                            ? "bg-primary text-primary-foreground border-primary"
                            : "text-muted-foreground border-border hover:border-primary/50"
                        }`}
                        title={isFf ? "結束後填前值" : "結束後填0"}
                      >
                        填前值
                      </button>
                    )}
                    <Badge variant="secondary" className="text-xs shrink-0">
                      {s.runCount}
                    </Badge>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Generate Button */}
          <Button onClick={handleGenerate} disabled={!canGenerate || isLoading} className="w-full sm:w-auto">
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Play className="mr-2 h-4 w-4" />
                Generate Report
              </>
            )}
          </Button>

          {/* Progress Bar */}
          {isLoading && progress.total > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  {progress.completed < progress.total ? (
                    <>Completed: <span className="font-medium text-foreground">{progress.currentName}</span></>
                  ) : (
                    <span className="font-medium text-foreground">{progress.currentName}</span>
                  )}
                </span>
                <span className="text-muted-foreground">
                  {progress.completed}/{progress.total}
                </span>
              </div>
              <div className="h-2 w-full rounded-full bg-secondary overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-300 ease-out"
                  style={{ width: `${(progress.completed / progress.total) * 100}%` }}
                />
              </div>
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>

      {/* Results */}
      {reportResult && (
        <div className="space-y-4">
          {/* Combined Overview */}
          {selectedStrategyIds.size > 1 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Combined Performance</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <EquityChart data={reportResult.totalChartData} />
                <PerformanceStats
                  filteredEquityCurve={reportResult.totalEquityCurve}
                  filteredCombinedTrades={reportResult.totalCombinedTrades}
                />
              </CardContent>
            </Card>
          )}

          {/* Per-Strategy Sections */}
          {Array.from(selectedStrategyIds).map((strategyId) => {
            const equity = reportResult.strategyEquity.get(strategyId) ?? [];
            const trades = reportResult.strategyCombinedTrades.get(strategyId) ?? [];
            const chartData = equity.map((e) => ({
              time: new Date(e.ts).getTime(),
              equity: e.total_equity * (shareRatioMap[strategyId] ?? 1),
            }));

            return (
              <Card key={strategyId}>
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-base">
                      {strategyNameMap[strategyId] ?? strategyId}
                    </CardTitle>
                    <Badge variant="outline" className="text-xs">
                      {trades.length} trades
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <EquityChart data={chartData} height={250} />
                  <PerformanceStats
                    filteredEquityCurve={equity}
                    filteredCombinedTrades={trades}
                    shareRatio={shareRatioMap[strategyId]}
                  />
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
