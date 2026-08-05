import { createClient } from "@/lib/supabase/server";
import { OverviewContent } from "@/components/overview/overview-content";
import {
  bucketedSince,
  getCombinedTrades,
  getEquityCurve,
  getEquityEndpoints,
  getFundAccountEquity,
  getStrategiesAndRuns,
  getTodayTradeRunIds,
  hourBucket,
} from "@/lib/overview-queries";
import type { Strategy, StrategyRun } from "@/lib/types/database";

// NOTE: no `export const revalidate` here — reading cookies for auth makes this
// route dynamic, so a page-level revalidate would silently do nothing. Caching
// lives in lib/overview-queries.ts instead.

/** Overview treats these modes as live/active (excludes paper/backtest/etc.). */
function isOverviewLiveMode(mode: string): boolean {
  return mode === "realtime" || mode === "test-realtime";
}

export default async function DashboardPage() {
  const supabase = await createClient();

  const [{ strategies: allStrategiesRaw, runs: allRunsRaw }, accessResult] =
    await Promise.all([
      getStrategiesAndRuns(supabase),
      // Per-user, so deliberately outside the shared cache.
      supabase
        .from("user_strategy_access")
        .select("strategy_id, share_ratio") as unknown as Promise<{
        data: { strategy_id: string; share_ratio: number }[] | null;
      }>,
    ]);

  // Filter to crypto-futures strategies only for the overview
  const cryptoFuturesStrategyIds = new Set(
    allStrategiesRaw
      .filter((s) => s.market === "crypto-futures")
      .map((s) => s.strategy_id)
  );
  const allStrategies = allStrategiesRaw.filter((s) =>
    cryptoFuturesStrategyIds.has(s.strategy_id)
  ) as unknown as Strategy[];
  const allRuns = allRunsRaw.filter((r) =>
    cryptoFuturesStrategyIds.has(r.strategy_id)
  ) as StrategyRun[];

  // Build share ratio map: strategy_id -> share_ratio
  const shareRatioMap: Record<string, number> = {};
  for (const row of accessResult.data ?? []) {
    shareRatioMap[row.strategy_id] = row.share_ratio;
  }

  const runningRunIds = allRuns
    .filter((r) => r.status === "running" && isOverviewLiveMode(r.mode as string))
    .map((r) => r.run_id);

  const runToStrategyMap: Record<string, string> = {};
  for (const run of allRuns) {
    runToStrategyMap[run.run_id] = run.strategy_id;
  }

  const strategyNameMap = new Map<string, string>();
  for (const s of allStrategies) {
    strategyNameMap.set(s.strategy_id, s.name);
  }

  // Group by strategy for combined display — realtime + test-realtime
  const activeStrategyIds = new Set(
    allRuns
      .filter((r) => r.status === "running" && isOverviewLiveMode(r.mode as string))
      .map((r) => r.strategy_id)
  );
  const activeStrategies = Array.from(activeStrategyIds).map((strategyId) => {
    const strategyRuns = allRuns.filter(
      (r) => r.strategy_id === strategyId && isOverviewLiveMode(r.mode as string)
    );
    const runningRun = strategyRuns.find((r) => r.status === "running");
    return {
      strategyId,
      strategyName: strategyNameMap.get(strategyId) ?? "Unknown",
      runCount: strategyRuns.length,
      allRunIds: strategyRuns.map((r) => r.run_id),
      mode: runningRun?.mode ?? "live",
      latestStartTime:
        strategyRuns.sort(
          (a, b) =>
            new Date(b.start_time).getTime() - new Date(a.start_time).getTime()
        )[0]?.start_time ?? "",
    };
  });

  // Pre-fetch chart data: realtime + test-realtime runs for active strategies
  const strategyRunIds: Record<string, string[]> = {};
  const allActiveRunIds: string[] = [];
  for (const strategyId of activeStrategyIds) {
    const runIds = allRuns
      .filter(
        (r) => r.strategy_id === strategyId && isOverviewLiveMode(r.mode as string)
      )
      .map((r) => r.run_id);
    strategyRunIds[strategyId] = runIds;
    allActiveRunIds.push(...runIds);
  }

  // Windows are bucketed to the hour so they stay stable in the cache key.
  const since24h = bucketedSince(1);
  const since7d = bucketedSince(7);
  const since30d = bucketedSince(30);
  const todayStart = new Date(hourBucket());
  todayStart.setUTCHours(0, 0, 0, 0);

  // Deliberately not awaited — handed to the client and streamed in behind a
  // Suspense boundary so the heaviest query stops gating the whole page.
  // 30d window, but only the last 24h is kept at full per-minute resolution.
  const fundEquityPromise = getFundAccountEquity(supabase, since30d, since24h);

  const [
    { latest: latestEquities, dayAgo: equities24hAgo },
    todayTrades,
    equityData,
    combinedTradesData,
  ] = await Promise.all([
    getEquityEndpoints(supabase, runningRunIds, since24h),
    getTodayTradeRunIds(supabase, runningRunIds, todayStart.toISOString()),
    getEquityCurve(supabase, allActiveRunIds, since7d, since24h),
    getCombinedTrades(supabase, allActiveRunIds, since30d),
  ]);

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
      fundEquityPromise={fundEquityPromise}
    />
  );
}
