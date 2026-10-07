import { unstable_noStore as noStore } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { AllPositionsContent } from "@/components/positions/all-positions-content";
import { fetchHiddenFamilyIds } from "@/lib/strategy-visibility";
import type { Strategy, StrategyRun, Position } from "@/lib/types/database";

// Disable caching to ensure fresh data on every page load
export const dynamic = "force-dynamic";
export const revalidate = 0;

// Extended position type with strategy info
/** Newest rows read per run; Kepler's ~32 rows/h keep 500 rows well over a day. */
const POSITIONS_PER_RUN = 500;
/** Floor of the closed-position window, for runs that write every couple of seconds. */
const MIN_STALE_MS = 5_000;
/** A position is closed after this many of its run's typical write gaps with no write. */
const STALE_FACTOR = 1.5;

export interface PositionWithStrategy extends Position {
  strategy_name: string;
  strategy_id: string;
}

export default async function PositionsPage() {
  noStore();

  const supabase = await createClient();

  // Fetch all running strategy runs with their strategy info, plus the parent
  // families this user may not see (lib/strategy-visibility.ts).
  const [{ data: runningRuns, error: runsError }, hiddenStrategyIds] = await Promise.all([
    supabase
      .from("strategy_runs")
      .select("*, strategies(*)")
      .eq("status", "running"),
    fetchHiddenFamilyIds(supabase),
  ]);

  if (runsError) {
    console.error("Error fetching running runs:", runsError);
  }

  const runs = ((runningRuns ?? []) as (StrategyRun & { strategies: Strategy })[]).filter(
    (r) => !hiddenStrategyIds.has(r.strategy_id)
  );
  const runIds = runs.map((r) => r.run_id);

  // Create a map from run_id to strategy info
  const runToStrategyMap = new Map<string, { name: string; id: string }>();
  for (const run of runs) {
    runToStrategyMap.set(run.run_id, {
      name: run.strategies?.name ?? "Unknown",
      id: run.strategy_id,
    });
  }

  // Engines never write a position = 0 row: a position is closed when its run
  // stops writing it. How long "stopped" means depends on the engine — Newtonz
  // writes every ~2 s, Kepler every ~15 min — so each run gets its own window,
  // learned from the gaps between its own rows. One shared 5 s window hid every
  // Kepler position a few seconds after each write.
  const positions: PositionWithStrategy[] = [];
  const staleMsByRun: Record<string, number> = {};

  // Per run, so a fast writer can't push a slow one out of a shared row limit.
  const perRun = await Promise.all(
    runIds.map(async (runId) => {
      const { data, error } = await supabase
        .from("positions")
        .select("*")
        .eq("run_id", runId)
        .order("ts", { ascending: false })
        .limit(POSITIONS_PER_RUN);
      if (error) console.error("Error fetching positions:", runId, error);
      return { runId, rows: (data ?? []) as Position[] };
    })
  );

  const now = Date.now();
  for (const { runId, rows } of perRun) {
    // Rows are newest first; group by key to get each position's write gaps.
    const byKey = new Map<string, Position[]>();
    for (const pos of rows) {
      const key = `${pos.run_id}-${pos.symbol}-${pos.exchange}`;
      const list = byKey.get(key);
      if (list) list.push(pos);
      else byKey.set(key, [pos]);
    }
    const gaps: number[] = [];
    for (const list of byKey.values()) {
      for (let i = 1; i < list.length; i++) gaps.push(Date.parse(list[i - 1].ts) - Date.parse(list[i].ts));
    }
    gaps.sort((x, y) => x - y);
    const typical = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 0;
    const staleMs = Math.max(MIN_STALE_MS, typical * STALE_FACTOR);
    staleMsByRun[runId] = staleMs;

    const strategyInfo = runToStrategyMap.get(runId);
    for (const list of byKey.values()) {
      const latest = list[0];
      // Already closed when the page loads.
      if (now - Date.parse(latest.ts) > staleMs) continue;
      positions.push({
        ...latest,
        strategy_name: strategyInfo?.name ?? "Unknown",
        strategy_id: strategyInfo?.id ?? "",
      });
    }
  }

  // Calculate summary stats
  const totalNotionalValue = positions.reduce((sum, p) => sum + Math.abs(p.notional_value), 0);
  const totalUnrealizedPnl = positions.reduce((sum, p) => sum + p.unrealized_pnl, 0);
  const positionCount = positions.length;

  return (
    <AllPositionsContent
      initialPositions={positions}
      initialTotalNotionalValue={totalNotionalValue}
      initialTotalUnrealizedPnl={totalUnrealizedPnl}
      initialPositionCount={positionCount}
      runIds={runIds}
      runToStrategyMap={Object.fromEntries(runToStrategyMap)}
      staleMsByRun={staleMsByRun}
      loadedAt={now}
    />
  );
}
