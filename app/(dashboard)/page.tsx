import { unstable_noStore as noStore } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { OverviewPerformanceChart } from "@/components/overview/overview-performance-chart";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PerformanceStats } from "@/components/charts/performance-stats";
import type { Strategy, StrategyRun, EquityCurve, CombinedTrade } from "@/lib/types/database";

// Disable caching to ensure fresh data on every page load
export const dynamic = "force-dynamic";
export const revalidate = 0;

// Fetch last 24h of equity data with pagination
async function fetchRecentEquityData(
  supabase: SupabaseClient,
  runIds: string[]
): Promise<EquityCurve[]> {
  if (runIds.length === 0) return [];

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

// Fetch all equity data for specific runs (no time filter, for stats calculation)
async function fetchAllEquityData(
  supabase: SupabaseClient,
  runIds: string[]
): Promise<EquityCurve[]> {
  if (runIds.length === 0) return [];

  const PAGE_SIZE = 1000;
  const allData: EquityCurve[] = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabase
      .from("equity_curve")
      .select("*")
      .in("run_id", runIds)
      .order("ts", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);

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

// Fetch all combined trades for specific runs
async function fetchAllCombinedTrades(
  supabase: SupabaseClient,
  runIds: string[]
): Promise<CombinedTrade[]> {
  if (runIds.length === 0) return [];

  const PAGE_SIZE = 1000;
  const allData: CombinedTrade[] = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabase
      .from("combined_trades")
      .select("*")
      .in("run_id", runIds)
      .order("ts", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);

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

export default async function DashboardPage() {
  noStore();

  const supabase = await createClient();

  // Fetch all strategies
  const { data: strategiesData, error: strategiesError } = await supabase
    .from("strategies")
    .select("*");

  if (strategiesError) {
    console.error("Error fetching strategies:", strategiesError);
  }

  const allStrategies = (strategiesData ?? []) as Strategy[];

  // Fetch all runs
  const { data: runsData, error: runsError } = await supabase
    .from("strategy_runs")
    .select("*");

  if (runsError) {
    console.error("Error fetching strategy_runs:", runsError);
  }

  const allRuns = (runsData ?? []) as StrategyRun[];
  const runIds = allRuns.map((r) => r.run_id);
  const runningRunIds = allRuns
    .filter((r) => r.status === "running")
    .map((r) => r.run_id);

  // Fetch last 24h of equity curve data (for chart)
  const equityData = await fetchRecentEquityData(supabase, runIds);

  // Fetch all equity and trades for running runs (for performance stats)
  const [runningEquityData, runningCombinedTrades] = await Promise.all([
    fetchAllEquityData(supabase, runningRunIds),
    fetchAllCombinedTrades(supabase, runningRunIds),
  ]);

  // Calculate summary stats
  const runToStrategyMap: Record<string, string> = {};
  for (const run of allRuns) {
    runToStrategyMap[run.run_id] = run.strategy_id;
  }

  const activeStrategiesCount = new Set(
    runningRunIds.map((rid) => runToStrategyMap[rid]).filter(Boolean)
  ).size;

  // Get latest total equity: per strategy, use the latest run's equity, then sum across strategies
  // Within a strategy, runs are sequential (not concurrent), so take the latest value
  const lastEquityPerStrategy = new Map<string, { equity: number; ts: number }>();
  for (const point of equityData) {
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

  // Build running runs info for Recent Activity
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

  // Group equity and trades by run_id for per-run stats
  const equityByRunId: Record<string, EquityCurve[]> = {};
  const tradesByRunId: Record<string, CombinedTrade[]> = {};
  for (const point of runningEquityData) {
    if (!equityByRunId[point.run_id]) equityByRunId[point.run_id] = [];
    equityByRunId[point.run_id].push(point);
  }
  for (const trade of runningCombinedTrades) {
    if (!tradesByRunId[trade.run_id]) tradesByRunId[trade.run_id] = [];
    tradesByRunId[trade.run_id].push(trade);
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Overview</h2>
        <p className="text-muted-foreground">
          Welcome to Mid-Low Frequency Trading System
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
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
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        <Card className="col-span-4">
          <CardHeader>
            <CardTitle>Performance Curve</CardTitle>
          </CardHeader>
          <CardContent className="pl-2">
            <OverviewPerformanceChart
              initialEquityData={equityData}
              runningRunIds={runningRunIds}
              runToStrategyMap={runToStrategyMap}
            />
          </CardContent>
        </Card>

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

      {/* Performance Stats for Each Running Run */}
      {runningRuns.length > 0 && (
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
      )}
    </div>
  );
}
