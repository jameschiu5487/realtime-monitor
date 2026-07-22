"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { FundEquityDashboard } from "@/components/overview/fund-equity-dashboard";
import { OverviewPerformanceChart } from "@/components/overview/overview-performance-chart";
import { cn } from "@/lib/utils";
import {
  buildAccountStrategyMap,
  buildStrategyAccountMap,
  exchangeBadgeClass,
} from "@/lib/utils/fund-account-strategy";
import {
  deriveFundShareRatio,
  latestByAccount,
  totalEquityFromLatest,
} from "@/lib/utils/fund-equity";
import type {
  Strategy,
  StrategyRun,
  EquityCurve,
  CombinedTrade,
  FundAccountEquity,
} from "@/lib/types/database";

const STORAGE_KEY = "overview-selected-strategies";

interface ActiveStrategy {
  strategyId: string;
  strategyName: string;
  runCount: number;
  allRunIds: string[];
  mode: string;
  latestStartTime: string;
}

interface MetricsData {
  latestEquities: EquityCurve[];
  equities24hAgo: EquityCurve[];
  todayTrades: { run_id: string }[];
}

interface OverviewContentProps {
  allStrategies: Strategy[];
  allRuns: StrategyRun[];
  activeStrategies: ActiveStrategy[];
  runningRunIds: string[];
  shareRatioMap: Record<string, number>;
  runToStrategyMap: Record<string, string>;
  strategyNameMap: Record<string, string>;
  metricsData: MetricsData;
  equityData: EquityCurve[];
  combinedTradesData: CombinedTrade[];
  strategyRunIds: Record<string, string[]>;
  fundEquityData: FundAccountEquity[];
  fundEquityError: string | null;
}

function useSelectedStrategies(activeStrategies: ActiveStrategy[]) {
  const [selectedIds, setSelectedIds] = useState<Set<string> | null>(null);

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as string[];
        // Only keep IDs that are still active
        const activeIds = new Set(activeStrategies.map((s) => s.strategyId));
        const valid = parsed.filter((id) => activeIds.has(id));
        if (valid.length > 0) {
          setSelectedIds(new Set(valid));
          return;
        }
      }
    } catch {
      // ignore
    }
    // Default: all active strategies selected
    setSelectedIds(new Set(activeStrategies.map((s) => s.strategyId)));
  }, [activeStrategies]);

  // Persist to localStorage
  useEffect(() => {
    if (selectedIds !== null) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...selectedIds]));
    }
  }, [selectedIds]);

  const toggle = useCallback((strategyId: string) => {
    setSelectedIds((prev) => {
      if (!prev) return prev;
      const next = new Set(prev);
      if (next.has(strategyId)) {
        next.delete(strategyId);
      } else {
        next.add(strategyId);
      }
      return next;
    });
  }, []);

  return { selectedIds: selectedIds ?? new Set(activeStrategies.map((s) => s.strategyId)), toggle };
}

export function OverviewContent({
  allStrategies,
  allRuns,
  activeStrategies,
  runningRunIds,
  shareRatioMap,
  runToStrategyMap,
  strategyNameMap,
  metricsData,
  equityData,
  combinedTradesData,
  strategyRunIds,
  fundEquityData,
  fundEquityError,
}: OverviewContentProps) {
  const { selectedIds, toggle } = useSelectedStrategies(activeStrategies);
  const fundShareRatio = useMemo(
    () => deriveFundShareRatio(shareRatioMap),
    [shareRatioMap]
  );
  const isLiveMode = useCallback(
    (mode: string) => mode === "realtime" || mode === "test-realtime",
    []
  );
  const accountStrategies = useMemo(
    () => buildAccountStrategyMap(allRuns, strategyNameMap, isLiveMode),
    [allRuns, strategyNameMap, isLiveMode]
  );
  const strategyAccounts = useMemo(
    () => buildStrategyAccountMap(allRuns, isLiveMode),
    [allRuns, isLiveMode]
  );
  const initialFundSummary = useMemo(() => {
    const latest = latestByAccount(fundEquityData);
    return {
      total: totalEquityFromLatest(latest) * fundShareRatio,
      accountCount: latest.size,
    };
  }, [fundEquityData, fundShareRatio]);
  const [fundSummary, setFundSummary] = useState(initialFundSummary);
  useEffect(() => {
    setFundSummary(initialFundSummary);
  }, [initialFundSummary]);
  const handleFundSummaryChange = useCallback(
    (summary: { total: number; accountCount: number }) => {
      setFundSummary(summary);
    },
    []
  );

  // Stable key for chart remount when selection changes
  const selectionKey = useMemo(
    () => [...selectedIds].sort().join(","),
    [selectedIds]
  );

  // Filter everything by selected strategies
  const filtered = useMemo(() => {
    const selectedRunningRunIds = runningRunIds.filter((rid) =>
      selectedIds.has(runToStrategyMap[rid])
    );

    const selectedStrategyRunIds: Record<string, string[]> = {};
    const allSelectedRunIds = new Set<string>();
    for (const strategyId of selectedIds) {
      if (strategyRunIds[strategyId]) {
        selectedStrategyRunIds[strategyId] = strategyRunIds[strategyId];
        for (const rid of strategyRunIds[strategyId]) {
          allSelectedRunIds.add(rid);
        }
      }
    }

    const filteredEquity = equityData.filter((e) => allSelectedRunIds.has(e.run_id));
    const filteredCombinedTrades = combinedTradesData.filter((t) =>
      allSelectedRunIds.has(t.run_id)
    );
    const filteredLatestEquities = metricsData.latestEquities.filter((e) =>
      selectedIds.has(runToStrategyMap[e.run_id])
    );
    const filteredEquities24hAgo = metricsData.equities24hAgo.filter((e) =>
      selectedIds.has(runToStrategyMap[e.run_id])
    );
    const filteredTodayTrades = metricsData.todayTrades.filter((t) =>
      selectedIds.has(runToStrategyMap[t.run_id])
    );

    const filteredStrategyNameMap: Record<string, string> = {};
    for (const sid of selectedIds) {
      if (strategyNameMap[sid]) {
        filteredStrategyNameMap[sid] = strategyNameMap[sid];
      }
    }

    return {
      runningRunIds: selectedRunningRunIds,
      strategyRunIds: selectedStrategyRunIds,
      equityData: filteredEquity,
      combinedTradesData: filteredCombinedTrades,
      latestEquities: filteredLatestEquities,
      equities24hAgo: filteredEquities24hAgo,
      todayTrades: filteredTodayTrades,
      strategyNameMap: filteredStrategyNameMap,
    };
  }, [
    selectedIds,
    runningRunIds,
    runToStrategyMap,
    strategyRunIds,
    equityData,
    combinedTradesData,
    metricsData,
    strategyNameMap,
  ]);

  // Compute metrics from filtered data
  const metrics = useMemo(() => {
    const runToStrategy = runToStrategyMap;

    // Current total equity by strategy (scaled by share ratio)
    const lastEquityPerStrategy = new Map<string, { equity: number; ts: number }>();
    for (const point of filtered.latestEquities) {
      const strategyId = runToStrategy[point.run_id];
      if (!strategyId) continue;
      const ts = new Date(point.ts).getTime();
      const ratio = shareRatioMap[strategyId] ?? 1;
      const existing = lastEquityPerStrategy.get(strategyId);
      if (!existing || ts > existing.ts) {
        lastEquityPerStrategy.set(strategyId, {
          equity: point.total_equity * ratio,
          ts,
        });
      }
    }
    let totalEquity = 0;
    for (const val of lastEquityPerStrategy.values()) {
      totalEquity += val.equity;
    }

    // 24h-ago total equity by strategy
    const equity24hPerStrategy = new Map<string, { equity: number; ts: number }>();
    for (const point of filtered.equities24hAgo) {
      const strategyId = runToStrategy[point.run_id];
      if (!strategyId) continue;
      const ts = new Date(point.ts).getTime();
      const ratio = shareRatioMap[strategyId] ?? 1;
      const existing = equity24hPerStrategy.get(strategyId);
      if (!existing || ts < existing.ts) {
        equity24hPerStrategy.set(strategyId, {
          equity: point.total_equity * ratio,
          ts,
        });
      }
    }
    let totalEquity24hAgo = 0;
    for (const val of equity24hPerStrategy.values()) {
      totalEquity24hAgo += val.equity;
    }

    const activeStrategiesCount = selectedIds.size;
    const todayTradeCount = filtered.todayTrades.length;

    return {
      totalEquity,
      totalEquity24hAgo,
      strategyCount: lastEquityPerStrategy.size,
      activeStrategiesCount,
      todayTradeCount,
    };
  }, [filtered, runToStrategyMap, shareRatioMap, selectedIds]);

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl sm:text-2xl font-bold tracking-tight">Overview</h2>
        {filtered.runningRunIds.length > 0 && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_6px_rgba(16,185,129,0.5)]" />
            <span className="font-mono uppercase tracking-wider">Live</span>
          </div>
        )}
      </div>

      {/* Metrics Strip */}
      <Card className="overflow-hidden">
        <CardContent className="p-0">
          <div className="grid grid-cols-3 gap-px bg-border">
            {/* Total Balance (fund accounts) */}
            <div className="p-3 sm:p-4 lg:p-5 bg-card">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Total Balance
              </p>
              <p className="text-lg sm:text-2xl lg:text-3xl font-bold font-mono tabular-nums mt-1">
                $
                {fundSummary.total.toLocaleString("en-US", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5 sm:mt-1">
                {fundSummary.accountCount}{" "}
                {fundSummary.accountCount === 1 ? "account" : "accounts"}
              </p>
            </div>

            {/* Active Strategies */}
            <div className="p-3 sm:p-4 lg:p-5 bg-card">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Active Strategies
              </p>
              <p className="text-lg sm:text-2xl lg:text-3xl font-bold font-mono tabular-nums mt-1">
                {metrics.activeStrategiesCount}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5 sm:mt-1">
                of {allStrategies.length} total
              </p>
            </div>

            {/* Today&apos;s Trades */}
            <div className="p-3 sm:p-4 lg:p-5 bg-card">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Today&apos;s Trades
              </p>
              <p className="text-lg sm:text-2xl lg:text-3xl font-bold font-mono tabular-nums mt-1">
                {metrics.todayTradeCount}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5 sm:mt-1">
                {new Date().toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  timeZone: "UTC",
                })}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <FundEquityDashboard
        initialData={fundEquityData}
        fetchError={fundEquityError}
        shareRatio={fundShareRatio}
        accountStrategies={accountStrategies}
        onSummaryChange={handleFundSummaryChange}
      />

      {/* Active Strategies */}
      {activeStrategies.length > 0 ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
              Active Strategies
            </h3>
            <Link
              href="/strategies"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              View all &rarr;
            </Link>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {activeStrategies.map((strategy) => {
              const isSelected = selectedIds.has(strategy.strategyId);
              const accounts = strategyAccounts[strategy.strategyId] ?? [];
              return (
                <Card
                  key={strategy.strategyId}
                  className={cn(
                    "transition-colors",
                    isSelected
                      ? "hover:bg-accent/50"
                      : "opacity-50 hover:opacity-70"
                  )}
                >
                  <CardContent className="p-3 sm:p-4">
                    <div className="flex items-center gap-2">
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggle(strategy.strategyId)}
                        className="shrink-0"
                      />
                      <div
                        className={cn(
                          "h-2 w-2 shrink-0 rounded-full bg-emerald-500",
                          isSelected && "animate-pulse shadow-[0_0_6px_rgba(16,185,129,0.4)]"
                        )}
                      />
                      <Link
                        href={`/strategies/${strategy.strategyId}/combined`}
                        className="font-medium text-sm sm:text-base truncate flex-1 hover:underline"
                      >
                        {strategy.strategyName}
                      </Link>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-mono uppercase">
                        {strategy.mode}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground font-mono mt-2 ml-10">
                      {strategy.runCount}{" "}
                      {strategy.runCount === 1 ? "run" : "runs"} combined
                    </p>
                    {accounts.length > 0 && (
                      <div className="mt-2 ml-10 flex flex-wrap gap-1.5">
                        {accounts.map((accountId) => (
                          <span
                            key={accountId}
                            className={cn(
                              "rounded-md px-1.5 py-0.5 text-xs font-mono font-medium",
                              exchangeBadgeClass(accountId)
                            )}
                          >
                            {accountId}
                          </span>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      ) : (
        <Card>
          <CardContent className="flex h-[80px] sm:h-[120px] items-center justify-center text-sm text-muted-foreground">
            No strategies running
          </CardContent>
        </Card>
      )}

      {/* Performance Chart */}
      {selectedIds.size > 0 && (
        <Card>
          <CardHeader className="px-3 sm:px-6 pb-2">
            <CardTitle className="text-sm sm:text-base font-medium">Active Equity Curve</CardTitle>
          </CardHeader>
          <CardContent className="px-1 sm:px-2">
            <OverviewPerformanceChart
              key={selectionKey}
              initialEquityData={filtered.equityData}
              initialCombinedTrades={filtered.combinedTradesData}
              runningRunIds={filtered.runningRunIds}
              strategyRunIds={filtered.strategyRunIds}
              runToStrategyMap={runToStrategyMap}
              shareRatioMap={shareRatioMap}
              strategyNameMap={filtered.strategyNameMap}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
