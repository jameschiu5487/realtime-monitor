import { createClient } from "@/lib/supabase/server";
import { OverviewContent } from "@/components/overview/overview-content";
import type { SupabaseClient } from "@supabase/supabase-js";
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

  // Group by strategy for combined display
  const activeStrategyIds = new Set(
    allRuns.filter((r) => r.status === "running").map((r) => r.strategy_id)
  );
  const activeStrategies = Array.from(activeStrategyIds).map((strategyId) => {
    const strategyRuns = allRuns.filter((r) => r.strategy_id === strategyId);
    const runningRun = strategyRuns.find((r) => r.status === "running");
    return {
      strategyId,
      strategyName: strategyNameMap.get(strategyId) ?? "Unknown",
      runCount: strategyRuns.length,
      allRunIds: strategyRuns.map((r) => r.run_id),
      mode: runningRun?.mode ?? "live",
      latestStartTime: strategyRuns
        .sort((a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime())[0]
        ?.start_time ?? "",
    };
  });

  // Pre-fetch metrics data
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  // Pre-fetch chart data: get all run IDs for active strategies
  const strategyRunIds: Record<string, string[]> = {};
  const allActiveRunIds: string[] = [];
  for (const strategyId of activeStrategyIds) {
    const runIds = allRuns
      .filter((r) => r.strategy_id === strategyId)
      .map((r) => r.run_id);
    strategyRunIds[strategyId] = runIds;
    allActiveRunIds.push(...runIds);
  }

  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [latestEquitiesRaw, equities24hAgoRaw, tradesResult, equityData, combinedTradesData] =
    await Promise.all([
      // Latest equity per running run
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
      // Equity from ~24h ago per running run
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
      // Today's trades (fetch run_id for client-side filtering)
      runningRunIds.length > 0
        ? supabase
            .from("trades")
            .select("run_id")
            .in("run_id", runningRunIds)
            .gte("ts", todayStart.toISOString())
        : Promise.resolve({ data: [] as { run_id: string }[] }),
      // Chart equity data (7 days)
      fetchEquityDataWithLimit(supabase, allActiveRunIds, since7d),
      // Combined trades
      fetchCombinedTradesWithLimit(supabase, allActiveRunIds),
    ]);

  const latestEquities = latestEquitiesRaw.filter(Boolean) as EquityCurve[];
  const equities24hAgo = equities24hAgoRaw.filter(Boolean) as EquityCurve[];
  const todayTrades = (tradesResult.data ?? []) as { run_id: string }[];

  return (
    <OverviewContent
      allStrategies={allStrategies}
      allRuns={allRuns}
      activeStrategies={activeStrategies}
      runningRunIds={runningRunIds}
      shareRatioMap={shareRatioMap}
      runToStrategyMap={runToStrategyMap}
      strategyNameMap={Object.fromEntries(strategyNameMap)}
      metricsData={{
        latestEquities,
        equities24hAgo,
        todayTrades,
      }}
      equityData={equityData}
      combinedTradesData={combinedTradesData}
      strategyRunIds={strategyRunIds}
    />
  );
}
