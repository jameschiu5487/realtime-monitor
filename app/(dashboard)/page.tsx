import { createClient } from "@/lib/supabase/server";
import { OverviewContent } from "@/components/overview/overview-content";
import {
  bucketedSince,
  getCombinedTrades,
  getFillNotional,
  getEquityCurve,
  getEquityEndpoints,
  getFundAccountEquity,
  getStrategiesAndRuns,
  getTodayTradeRunIds,
  hourBucket,
} from "@/lib/overview-queries";
import type { Strategy, StrategyRun } from "@/lib/types/database";
import { taipeiDayStartMs } from "@/lib/time";
import { isParentBookMode } from "@/lib/parent-strategy";
import { accountIdsFromRunParams } from "@/lib/utils/fund-account-strategy";
import { hiddenAccountIds, hiddenFamilyIds } from "@/lib/strategy-visibility";
import type { ParentStrategyCard } from "@/components/overview/overview-content";

// NOTE: no `export const revalidate` here — reading cookies for auth makes this
// route dynamic, so a page-level revalidate would silently do nothing. Caching
// lives in lib/overview-queries.ts instead.

/** Overview treats these modes as live/active (excludes paper/backtest/etc.). */
function isOverviewLiveMode(mode: string): boolean {
  return mode === "realtime" || mode === "test-realtime";
}

export default async function DashboardPage() {
  const supabase = await createClient();

  const [
    { strategies: sharedStrategies, runs: sharedRuns },
    accessResult,
    {
      data: { user },
    },
  ] = await Promise.all([
    getStrategiesAndRuns(supabase),
    // Per-user, so deliberately outside the shared cache.
    supabase
      .from("user_strategy_access")
      .select("user_id, strategy_id, share_ratio") as unknown as Promise<{
      data: { user_id: string; strategy_id: string; share_ratio: number }[] | null;
    }>,
    supabase.auth.getUser(),
  ]);

  // Per-user visibility, applied to the shared cached rows here (request-scoped)
  // — see lib/strategy-visibility.ts. A parent family (e.g. Kepler DX) the user
  // has no access to, neither on the parent nor on any child, is removed with
  // all its children and runs; fund accounts linked only to such children are
  // removed from the fund dashboard. Everything else is untouched.
  const accessibleIds = new Set(
    (accessResult.data ?? [])
      .filter((row) => row.user_id === user?.id)
      .map((row) => row.strategy_id)
  );
  const hiddenStrategyIds = hiddenFamilyIds(sharedStrategies, accessibleIds);
  const hiddenAccounts = hiddenAccountIds(sharedRuns, hiddenStrategyIds);
  const allStrategiesRaw = sharedStrategies.filter(
    (s) => !hiddenStrategyIds.has(s.strategy_id)
  );
  const allRunsRaw = sharedRuns.filter(
    (r) => !hiddenStrategyIds.has(r.strategy_id)
  );

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

  // Children of a parent strategy (e.g. Kepler) keep virtual books on a shared
  // exchange account — their equity is simulated, not money. They are kept out
  // of every per-run figure here; the parent gets its own card below instead,
  // and its real money is the account row on the fund dashboard.
  const parentOf = new Map<string, string>();
  for (const s of allStrategiesRaw) {
    if (s.parent_strategy_id) parentOf.set(s.strategy_id, s.parent_strategy_id);
  }
  const isOverviewRun = (r: StrategyRun) =>
    isOverviewLiveMode(r.mode as string) && !parentOf.has(r.strategy_id);

  const runningRunIds = allRuns
    .filter((r) => r.status === "running" && isOverviewRun(r))
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
      .filter((r) => r.status === "running" && isOverviewRun(r))
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

  // One card per parent with at least one running live child book. Nothing
  // here feeds the metrics, the performance chart or the selection — only the
  // card itself and the account badge, both from real-account data.
  const parentIds = new Set(parentOf.values());
  const parentStrategies: ParentStrategyCard[] = allStrategies
    .filter((s) => parentIds.has(s.strategy_id))
    .map((parent) => {
      const liveChildRuns = allRuns.filter(
        (r) =>
          parentOf.get(r.strategy_id) === parent.strategy_id &&
          r.status === "running" &&
          // Same rule as the parent page: "live" plus the legacy "realtime", no paper.
          isParentBookMode(r.mode as string, false)
      );
      // Earliest live child run of any status: the account is the parent's money
      // from then on, so anything before it isn't the parent's to plot.
      const firstLiveStart = allRuns
        .filter(
          (r) =>
            parentOf.get(r.strategy_id) === parent.strategy_id &&
            isParentBookMode(r.mode as string, false)
        )
        .map((r) => r.start_time)
        .filter(Boolean)
        .sort()[0] ?? null;
      return {
        strategyId: parent.strategy_id,
        strategyName: parent.name,
        firstLiveStart,
        liveRunCount: liveChildRuns.length,
        childCount: new Set(liveChildRuns.map((r) => r.strategy_id)).size,
        accountIds: [
          ...new Set(liveChildRuns.flatMap((r) => accountIdsFromRunParams(r.params))),
        ].sort((a, b) => a.localeCompare(b)),
      };
    })
    .filter((p) => p.liveRunCount > 0);

  // Every live child run of a shown parent (any status — fills from books that
  // have since stopped still traded that account), run_id -> parent_id. Kepler
  // writes fills to trades but hardly any combined_trades, so its turnover
  // comes from here.
  const shownParents = new Set(parentStrategies.map((p) => p.strategyId));
  const parentLiveRunIds = new Map<string, string>();
  for (const r of allRuns) {
    const parentId = parentOf.get(r.strategy_id);
    if (parentId && shownParents.has(parentId) && isParentBookMode(r.mode as string, false)) {
      parentLiveRunIds.set(r.run_id, parentId);
    }
  }

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
  // Taipei midnight (lib/time); derived from the hour bucket so it stays stable too.
  const todayStart = new Date(taipeiDayStartMs(hourBucket()));

  // Deliberately not awaited — handed to the client and streamed in behind a
  // Suspense boundary so the heaviest query stops gating the whole page.
  // 30d window, but only the last 24h is kept at full per-minute resolution.
  // The cached payload is shared by every user; hidden accounts are dropped
  // after it, per request, so totals, exchange cards and the chart all agree.
  const fundEquityPromise = getFundAccountEquity(supabase, since30d, since24h).then(
    (result) =>
      hiddenAccounts.size === 0
        ? result
        : {
            ...result,
            data: result.data.filter((row) => !hiddenAccounts.has(row.account_id)),
          }
  );

  const [
    { latest: latestEquities, dayAgo: equities24hAgo },
    todayTrades,
    equityData,
    combinedTradesData,
    parentFillRows,
  ] = await Promise.all([
    getEquityEndpoints(supabase, runningRunIds, since24h),
    getTodayTradeRunIds(supabase, runningRunIds, todayStart.toISOString()),
    getEquityCurve(supabase, allActiveRunIds, since7d, since24h),
    getCombinedTrades(supabase, allActiveRunIds, since30d),
    getFillNotional(supabase, [...parentLiveRunIds.keys()], since30d),
  ]);

  const parentFills: Record<string, { ts: string; notional: number }[]> = {};
  for (const f of parentFillRows) {
    const parentId = parentLiveRunIds.get(f.run_id);
    if (!parentId) continue;
    (parentFills[parentId] ??= []).push({ ts: f.ts, notional: f.notional });
  }

  return (
    <OverviewContent
      allStrategies={allStrategies}
      allRuns={allRuns}
      activeStrategies={activeStrategies}
      parentStrategies={parentStrategies}
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
      parentFills={parentFills}
      hiddenAccountIds={[...hiddenAccounts].sort()}
    />
  );
}
