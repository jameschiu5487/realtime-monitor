import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { OverviewPerformanceChart } from "@/components/overview/overview-performance-chart";
import { Skeleton } from "@/components/ui/skeleton";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PerformanceStats } from "@/components/charts/performance-stats";
import type { Strategy, StrategyRun, EquityCurve, CombinedTrade } from "@/lib/types/database";

// Cache for 60 seconds, then revalidate in background
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

// Skeleton for summary cards
function SummaryCardSkeleton() {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <Skeleton className="h-4 w-24" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-8 w-32 mb-2" />
        <Skeleton className="h-3 w-20" />
      </CardContent>
    </Card>
  );
}

// Skeleton for chart
function ChartSkeleton() {
  return <Skeleton className="h-[300px] w-full" />;
}

// Skeleton for performance stats
function PerformanceStatsSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {[...Array(8)].map((_, i) => (
        <Card key={i}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <Skeleton className="h-4 w-20" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-7 w-24" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// Async component for summary cards that need data
async function SummaryCards({
  runningRunIds,
  allRuns,
  allStrategies,
}: {
  runningRunIds: string[];
  allRuns: StrategyRun[];
  allStrategies: Strategy[];
}) {
  const supabase = await createClient();

  // Fetch only latest equity per run (limit 1 per run, ordered by ts desc)
  // This is much faster than fetching all equity data
  const equityPromises = runningRunIds.map(async (runId) => {
    const { data } = await supabase
      .from("equity_curve")
      .select("run_id, total_equity, ts")
      .eq("run_id", runId)
      .order("ts", { ascending: false })
      .limit(1);
    return data?.[0] as EquityCurve | undefined;
  });

  const latestEquities = (await Promise.all(equityPromises)).filter(Boolean) as EquityCurve[];

  const runToStrategyMap: Record<string, string> = {};
  for (const run of allRuns) {
    runToStrategyMap[run.run_id] = run.strategy_id;
  }

  const activeStrategiesCount = new Set(
    runningRunIds.map((rid) => runToStrategyMap[rid]).filter(Boolean)
  ).size;

  // Calculate total equity by strategy
  const lastEquityPerStrategy = new Map<string, { equity: number; ts: number }>();
  for (const point of latestEquities) {
    const strategyId = runToStrategyMap[point.run_id];
    if (!strategyId) continue;
    const ts = new Date(point.ts).getTime();
    const existing = lastEquityPerStrategy.get(strategyId);
    if (!existing || ts > existing.ts) {
      lastEquityPerStrategy.set(strategyId, { equity: point.total_equity, ts });
    }
  }
  let totalEquity = 0;
  for (const val of lastEquityPerStrategy.values()) {
    totalEquity += val.equity;
  }

  const strategiesWithDataCount = lastEquityPerStrategy.size;

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Total Assets</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">
            ${totalEquity.toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </div>
          <p className="text-xs text-muted-foreground">
            Across {strategiesWithDataCount} strategies
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Unrealized P&L</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">$0.00</div>
          <p className="text-xs text-muted-foreground">
            0 positions
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Active Strategies</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{activeStrategiesCount}</div>
          <p className="text-xs text-muted-foreground">
            {allStrategies.length} total strategies
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Today&apos;s Orders</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">0</div>
          <p className="text-xs text-muted-foreground">
            0 filled
          </p>
        </CardContent>
      </Card>
    </>
  );
}

// Async component for performance chart
async function PerformanceChartSection({
  runningRunIds,
  runToStrategyMap,
}: {
  runningRunIds: string[];
  runToStrategyMap: Record<string, string>;
}) {
  const supabase = await createClient();
  // Only fetch 24h for chart - much faster
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const equityData = await fetchEquityDataWithLimit(supabase, runningRunIds, since24h);

  return (
    <OverviewPerformanceChart
      initialEquityData={equityData}
      runningRunIds={runningRunIds}
      runToStrategyMap={runToStrategyMap}
    />
  );
}

// Async component for performance stats
async function PerformanceStatsSection({
  runningRuns,
}: {
  runningRuns: { runId: string; strategyName: string; strategyId: string; mode: string; startTime: string }[];
}) {
  if (runningRuns.length === 0) return null;

  const supabase = await createClient();
  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const runIds = runningRuns.map((r) => r.runId);

  const [equityData, combinedTrades] = await Promise.all([
    fetchEquityDataWithLimit(supabase, runIds, since7d),
    fetchCombinedTradesWithLimit(supabase, runIds, since7d),
  ]);

  // Group by run_id
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
            <h3 className="text-lg font-semibold">{run.strategyName}</h3>
            <span className="text-sm text-muted-foreground">({run.mode})</span>
          </div>
          <PerformanceStats
            filteredEquityCurve={equityByRunId[run.runId] ?? []}
            filteredCombinedTrades={tradesByRunId[run.runId] ?? []}
          />
        </div>
      ))}
    </div>
  );
}

export default async function DashboardPage() {
  const supabase = await createClient();

  // Fast queries - strategies and runs are small tables
  const [{ data: strategiesData }, { data: runsData }] = await Promise.all([
    supabase.from("strategies").select("*"),
    supabase.from("strategy_runs").select("*"),
  ]);

  const allStrategies = (strategiesData ?? []) as Strategy[];
  const allRuns = (runsData ?? []) as StrategyRun[];

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
    .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Overview</h2>
        <p className="text-muted-foreground">
          Welcome to Mid-Low Frequency Trading System
        </p>
      </div>

      {/* Summary Cards with Suspense */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Suspense fallback={<><SummaryCardSkeleton /><SummaryCardSkeleton /><SummaryCardSkeleton /><SummaryCardSkeleton /></>}>
          <SummaryCards
            runningRunIds={runningRunIds}
            allRuns={allRuns}
            allStrategies={allStrategies}
          />
        </Suspense>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        {/* Performance Chart with Suspense */}
        <Card className="col-span-4">
          <CardHeader>
            <CardTitle>Performance Curve</CardTitle>
          </CardHeader>
          <CardContent className="pl-2">
            <Suspense fallback={<ChartSkeleton />}>
              <PerformanceChartSection
                runningRunIds={runningRunIds}
                runToStrategyMap={runToStrategyMap}
              />
            </Suspense>
          </CardContent>
        </Card>

        {/* Running Strategies - no Suspense needed, uses already-fetched data */}
        <Card className="col-span-3">
          <CardHeader>
            <CardTitle>Running Strategies</CardTitle>
          </CardHeader>
          <CardContent>
            {runningRuns.length === 0 ? (
              <div className="flex h-[300px] items-center justify-center text-muted-foreground">
                No strategies running
              </div>
            ) : (
              <div className="h-[300px] overflow-auto space-y-4">
                {runningRuns.map((run) => (
                  <Link
                    key={run.runId}
                    href={`/strategies/${run.strategyId}/runs/${run.runId}`}
                    className="flex items-start gap-3 rounded-md p-2 -mx-2 transition-colors hover:bg-muted"
                  >
                    <div className="mt-1 h-2 w-2 shrink-0 rounded-full bg-emerald-500 animate-pulse" />
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="text-sm font-medium leading-none truncate">
                        {run.strategyName}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {run.mode} &middot; started{" "}
                        {new Date(run.startTime).toLocaleString("en-US", {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                          hour12: false,
                        })}
                      </p>
                      <p className="text-xs text-muted-foreground font-mono truncate">
                        {run.runId}
                      </p>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Performance Stats with Suspense */}
      {runningRuns.length > 0 && (
        <Suspense fallback={<PerformanceStatsSkeleton />}>
          <PerformanceStatsSection runningRuns={runningRuns} />
        </Suspense>
      )}
    </div>
  );
}
