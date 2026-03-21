import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { OverviewPerformanceChart } from "@/components/overview/overview-performance-chart";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PerformanceStats } from "@/components/charts/performance-stats";
import type {
  Strategy,
  StrategyRun,
  EquityCurve,
  CombinedTrade,
} from "@/lib/types/database";

export const revalidate = 60;

// Fetch equity data for specific runs with optional time filter
async function fetchEquityDataWithLimit(
  supabase: SupabaseClient,
  runIds: string[],
  since?: string
): Promise<EquityCurve[]> {
  if (runIds.length === 0) return [];

  const PAGE_SIZE = 1000;
  const allData: EquityCurve[] = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    let query = supabase
      .from("equity_curve")
      .select("*")
      .in("run_id", runIds)
      .order("ts", { ascending: true });

    if (since) {
      query = query.gte("ts", since);
    }

    const { data, error } = await query.range(offset, offset + PAGE_SIZE - 1);

    if (error) {
      console.error("Error fetching equity_curve:", error);
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

  return allData;
}

// Fetch combined trades for specific runs with optional time filter
async function fetchCombinedTradesWithLimit(
  supabase: SupabaseClient,
  runIds: string[],
  since?: string
): Promise<CombinedTrade[]> {
  if (runIds.length === 0) return [];

  const PAGE_SIZE = 1000;
  const allData: CombinedTrade[] = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    let query = supabase
      .from("combined_trades")
      .select("*")
      .in("run_id", runIds)
      .order("ts", { ascending: true });

    if (since) {
      query = query.gte("ts", since);
    }

    const { data, error } = await query.range(offset, offset + PAGE_SIZE - 1);

    if (error) {
      console.error("Error fetching combined_trades:", error);
      break;
    }

    if (data && data.length > 0) {
      allData.push(...(data as CombinedTrade[]));
      offset += PAGE_SIZE;
      hasMore = data.length === PAGE_SIZE;
    } else {
      hasMore = false;
    }
  }

  return allData;
}

// --- Skeleton Components ---

function MetricsStripSkeleton() {
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-0">
        <div className="grid grid-cols-2 gap-px bg-border lg:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="p-3 sm:p-4 lg:p-5 bg-card space-y-2">
              <Skeleton className="h-3 w-16 sm:w-20" />
              <Skeleton className="h-6 sm:h-7 w-20 sm:w-28" />
              <Skeleton className="h-3 w-14 sm:w-16" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function ChartSkeleton() {
  return <Skeleton className="h-[220px] sm:h-[300px] w-full" />;
}

function PerformanceStatsSkeleton() {
  return (
    <div className="space-y-6">
      {[...Array(2)].map((_, i) => (
        <div key={i} className="space-y-2">
          <div className="flex items-center gap-2">
            <Skeleton className="h-2 w-2 rounded-full" />
            <Skeleton className="h-5 w-32" />
          </div>
          <Card>
            <CardContent className="p-0">
              <div className="grid grid-cols-2 sm:grid-cols-4">
                {[...Array(12)].map((_, j) => (
                  <div
                    key={j}
                    className="p-3 space-y-2 flex flex-col items-center"
                  >
                    <Skeleton className="h-6 w-16" />
                    <Skeleton className="h-3 w-20" />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      ))}
    </div>
  );
}

// --- Async Data Components ---

async function MetricsStrip({
  runningRunIds,
  allRuns,
  allStrategies,
  shareRatioMap,
}: {
  runningRunIds: string[];
  allRuns: StrategyRun[];
  allStrategies: Strategy[];
  shareRatioMap: Record<string, number>;
}) {
  const supabase = await createClient();

  const runToStrategyMap: Record<string, string> = {};
  for (const run of allRuns) {
    runToStrategyMap[run.run_id] = run.strategy_id;
  }

  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  const [latestEquitiesRaw, equities24hAgoRaw, tradesResult] =
    await Promise.all([
      // Latest equity per run
      Promise.all(
        runningRunIds.map(async (runId) => {
          const { data } = await supabase
            .from("equity_curve")
            .select("run_id, total_equity, ts")
            .eq("run_id", runId)
            .order("ts", { ascending: false })
            .limit(1);
          return data?.[0] as EquityCurve | undefined;
        })
      ),
      // Equity from ~24h ago per run (earliest point in 24h window)
      Promise.all(
        runningRunIds.map(async (runId) => {
          const { data } = await supabase
            .from("equity_curve")
            .select("run_id, total_equity, ts")
            .eq("run_id", runId)
            .gte("ts", since24h)
            .order("ts", { ascending: true })
            .limit(1);
          return data?.[0] as EquityCurve | undefined;
        })
      ),
      // Today's trade count
      runningRunIds.length > 0
        ? supabase
            .from("trades")
            .select("*", { count: "exact", head: true })
            .in("run_id", runningRunIds)
            .gte("ts", todayStart.toISOString())
        : Promise.resolve({ count: 0 } as { count: number }),
    ]);

  const latestEquities = latestEquitiesRaw.filter(
    Boolean
  ) as EquityCurve[];
  const equities24hAgo = equities24hAgoRaw.filter(
    Boolean
  ) as EquityCurve[];
  const todayTradeCount = tradesResult.count ?? 0;

  const activeStrategiesCount = new Set(
    runningRunIds.map((rid) => runToStrategyMap[rid]).filter(Boolean)
  ).size;

  // Current total equity by strategy (scaled by share ratio)
  const lastEquityPerStrategy = new Map<
    string,
    { equity: number; ts: number }
  >();
  for (const point of latestEquities) {
    const strategyId = runToStrategyMap[point.run_id];
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

  // 24h-ago total equity by strategy (scaled by share ratio)
  const equity24hPerStrategy = new Map<
    string,
    { equity: number; ts: number }
  >();
  for (const point of equities24hAgo) {
    const strategyId = runToStrategyMap[point.run_id];
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

  const pnl24h = totalEquity - totalEquity24hAgo;
  const pnl24hPct =
    totalEquity24hAgo > 0 ? (pnl24h / totalEquity24hAgo) * 100 : 0;
  const hasEquityData = lastEquityPerStrategy.size > 0;

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-0">
        <div className="grid grid-cols-3 gap-px bg-border">
          {/* Total Equity */}
          <div className="p-3 sm:p-4 lg:p-5 bg-card">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Total Equity
            </p>
            <p className="text-lg sm:text-2xl lg:text-3xl font-bold font-mono tabular-nums mt-1">
              $
              {totalEquity.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5 sm:mt-1">
              {lastEquityPerStrategy.size}{" "}
              {lastEquityPerStrategy.size === 1 ? "strategy" : "strategies"}
            </p>
          </div>

          {/* Active Strategies */}
          <div className="p-3 sm:p-4 lg:p-5 bg-card">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Active Strategies
            </p>
            <p className="text-lg sm:text-2xl lg:text-3xl font-bold font-mono tabular-nums mt-1">
              {activeStrategiesCount}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5 sm:mt-1">
              of {allStrategies.length} total
            </p>
          </div>

          {/* Today's Trades */}
          <div className="p-3 sm:p-4 lg:p-5 bg-card">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Today&apos;s Trades
            </p>
            <p className="text-lg sm:text-2xl lg:text-3xl font-bold font-mono tabular-nums mt-1">
              {todayTradeCount}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5 sm:mt-1">
              {new Date().toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
              })}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// Async component for performance chart
async function PerformanceChartSection({
  runningRunIds,
  allRuns,
  runToStrategyMap,
  shareRatioMap,
}: {
  runningRunIds: string[];
  allRuns: StrategyRun[];
  runToStrategyMap: Record<string, string>;
  shareRatioMap: Record<string, number>;
}) {
  const supabase = await createClient();

  // For each strategy that has a running run, get ALL run IDs for that strategy
  const activeStrategyIds = new Set(
    runningRunIds.map((rid) => runToStrategyMap[rid]).filter(Boolean)
  );
  const strategyRunIds: Record<string, string[]> = {};
  const allActiveRunIds: string[] = [];
  for (const strategyId of activeStrategyIds) {
    const runIds = allRuns
      .filter((r) => r.strategy_id === strategyId)
      .map((r) => r.run_id);
    strategyRunIds[strategyId] = runIds;
    allActiveRunIds.push(...runIds);
  }

  // Fetch 7 days of equity data + combined trades for all runs of active strategies
  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const [equityData, combinedTradesData] = await Promise.all([
    fetchEquityDataWithLimit(supabase, allActiveRunIds, since7d),
    fetchCombinedTradesWithLimit(supabase, allActiveRunIds),
  ]);

  return (
    <OverviewPerformanceChart
      initialEquityData={equityData}
      initialCombinedTrades={combinedTradesData}
      runningRunIds={runningRunIds}
      strategyRunIds={strategyRunIds}
      runToStrategyMap={runToStrategyMap}
      shareRatioMap={shareRatioMap}
    />
  );
}

// Async component for performance stats
async function PerformanceStatsSection({
  runningRuns,
  shareRatioMap,
}: {
  runningRuns: {
    runId: string;
    strategyName: string;
    strategyId: string;
    mode: string;
    startTime: string;
  }[];
  shareRatioMap: Record<string, number>;
}) {
  if (runningRuns.length === 0) return null;

  const supabase = await createClient();
  const since7d = new Date(
    Date.now() - 7 * 24 * 60 * 60 * 1000
  ).toISOString();
  const runIds = runningRuns.map((r) => r.runId);

  const [equityData, combinedTrades] = await Promise.all([
    fetchEquityDataWithLimit(supabase, runIds, since7d),
    fetchCombinedTradesWithLimit(supabase, runIds, since7d),
  ]);

  const equityByRunId: Record<string, EquityCurve[]> = {};
  const tradesByRunId: Record<string, CombinedTrade[]> = {};
  for (const point of equityData) {
    if (!equityByRunId[point.run_id]) equityByRunId[point.run_id] = [];
    equityByRunId[point.run_id].push(point);
  }
  for (const trade of combinedTrades) {
    if (!tradesByRunId[trade.run_id]) tradesByRunId[trade.run_id] = [];
    tradesByRunId[trade.run_id].push(trade);
  }

  return (
    <div className="space-y-4">
      {runningRuns.map((run) => (
        <div key={run.runId} className="space-y-2">
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            <h3 className="text-sm sm:text-base font-semibold">{run.strategyName}</h3>
            <span className="text-xs font-mono text-muted-foreground uppercase">
              {run.mode}
            </span>
          </div>
          <PerformanceStats
            filteredEquityCurve={equityByRunId[run.runId] ?? []}
            filteredCombinedTrades={tradesByRunId[run.runId] ?? []}
            shareRatio={shareRatioMap[run.strategyId] ?? 1}
          />
        </div>
      ))}
    </div>
  );
}

export default async function DashboardPage() {
  const supabase = await createClient();

  const [{ data: strategiesData }, { data: runsData }, accessResult] = await Promise.all([
    supabase.from("strategies").select("*"),
    supabase.from("strategy_runs").select("*"),
    supabase.from("user_strategy_access").select("strategy_id, share_ratio") as unknown as Promise<{ data: { strategy_id: string; share_ratio: number }[] | null }>,
  ]);

  // Filter to crypto-futures strategies only for the overview
  const allStrategiesRaw = (strategiesData ?? []) as (Strategy & { market?: string })[];
  const cryptoFuturesStrategyIds = new Set(
    allStrategiesRaw.filter((s) => s.market === "crypto-futures").map((s) => s.strategy_id)
  );
  const allStrategies = allStrategiesRaw.filter((s) => cryptoFuturesStrategyIds.has(s.strategy_id));
  const allRuns = ((runsData ?? []) as StrategyRun[]).filter((r) => cryptoFuturesStrategyIds.has(r.strategy_id));

  // Build share ratio map: strategy_id -> share_ratio
  const shareRatioMap: Record<string, number> = {};
  for (const row of accessResult.data ?? []) {
    shareRatioMap[row.strategy_id] = row.share_ratio;
  }

  const runningRunIds = allRuns
    .filter((r) => r.status === "running")
    .map((r) => r.run_id);

  const runToStrategyMap: Record<string, string> = {};
  for (const run of allRuns) {
    runToStrategyMap[run.run_id] = run.strategy_id;
  }

  const strategyNameMap = new Map<string, string>();
  for (const s of allStrategies) {
    strategyNameMap.set(s.strategy_id, s.name);
  }

  const runningRuns = allRuns
    .filter((r) => r.status === "running")
    .map((r) => ({
      runId: r.run_id,
      strategyName: strategyNameMap.get(r.strategy_id) ?? "Unknown",
      strategyId: r.strategy_id,
      mode: r.mode,
      startTime: r.start_time,
    }))
    .sort(
      (a, b) =>
        new Date(b.startTime).getTime() - new Date(a.startTime).getTime()
    );

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl sm:text-2xl font-bold tracking-tight">Overview</h2>
        {runningRunIds.length > 0 && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_6px_rgba(16,185,129,0.5)]" />
            <span className="font-mono uppercase tracking-wider">Live</span>
          </div>
        )}
      </div>

      {/* Metrics Strip */}
      <Suspense fallback={<MetricsStripSkeleton />}>
        <MetricsStrip
          runningRunIds={runningRunIds}
          allRuns={allRuns}
          allStrategies={allStrategies}
          shareRatioMap={shareRatioMap}
        />
      </Suspense>

      {/* Performance Chart — Full Width */}
      <Card>
        <CardHeader className="px-3 sm:px-6 pb-2">
          <CardTitle className="text-sm sm:text-base font-medium">Equity Curve</CardTitle>
        </CardHeader>
        <CardContent className="px-1 sm:px-2">
          <Suspense fallback={<ChartSkeleton />}>
            <PerformanceChartSection
              runningRunIds={runningRunIds}
              allRuns={allRuns}
              runToStrategyMap={runToStrategyMap}
              shareRatioMap={shareRatioMap}
            />
          </Suspense>
        </CardContent>
      </Card>

      {/* Active Strategies */}
      {runningRuns.length > 0 ? (
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
            {runningRuns.map((run) => (
              <Link
                key={run.runId}
                href={`/strategies/${run.strategyId}/runs/${run.runId}`}
              >
                <Card className="transition-colors hover:bg-accent/50 active:bg-accent/50">
                  <CardContent className="p-3 sm:p-4">
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-2 shrink-0 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_6px_rgba(16,185,129,0.4)]" />
                      <span className="font-medium text-sm sm:text-base truncate flex-1">
                        {run.strategyName}
                      </span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-mono uppercase">
                        {run.mode}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground font-mono mt-2">
                      Started{" "}
                      {new Date(run.startTime).toLocaleString("en-US", {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                        hour12: false,
                      })}
                    </p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      ) : (
        <Card>
          <CardContent className="flex h-[80px] sm:h-[120px] items-center justify-center text-sm text-muted-foreground">
            No strategies running
          </CardContent>
        </Card>
      )}

      {/* Performance Stats */}
      {runningRuns.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
            Strategy Metrics
            <span className="ml-2 text-muted-foreground/60">(7d)</span>
          </h3>
          <Suspense fallback={<PerformanceStatsSkeleton />}>
            <PerformanceStatsSection runningRuns={runningRuns} shareRatioMap={shareRatioMap} />
          </Suspense>
        </div>
      )}
    </div>
  );
}
