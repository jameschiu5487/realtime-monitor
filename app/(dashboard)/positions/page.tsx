import { unstable_noStore as noStore } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { AllPositionsContent } from "@/components/positions/all-positions-content";
import type { Strategy, StrategyRun, Position } from "@/lib/types/database";

// Disable caching to ensure fresh data on every page load
export const dynamic = "force-dynamic";
export const revalidate = 0;

// Extended position type with strategy info
export interface PositionWithStrategy extends Position {
  strategy_name: string;
  strategy_id: string;
}

export default async function PositionsPage() {
  noStore();

  const supabase = await createClient();

  // Fetch all running strategy runs with their strategy info
  const { data: runningRuns, error: runsError } = await supabase
    .from("strategy_runs")
    .select("*, strategies(*)")
    .eq("status", "running");

  if (runsError) {
    console.error("Error fetching running runs:", runsError);
  }

  const runs = (runningRuns ?? []) as (StrategyRun & { strategies: Strategy })[];
  const runIds = runs.map((r) => r.run_id);

  // Create a map from run_id to strategy info
  const runToStrategyMap = new Map<string, { name: string; id: string }>();
  for (const run of runs) {
    runToStrategyMap.set(run.run_id, {
      name: run.strategies?.name ?? "Unknown",
      id: run.strategy_id,
    });
  }

  // Fetch latest positions for each running run
  // We need to get the most recent positions (grouped by run_id, symbol, exchange)
  let positions: PositionWithStrategy[] = [];

  if (runIds.length > 0) {
    // Fetch recent positions for all running runs
    const { data: positionsData, error: positionsError } = await supabase
      .from("positions")
      .select("*")
      .in("run_id", runIds)
      .order("ts", { ascending: false })
      .limit(500);

    if (positionsError) {
      console.error("Error fetching positions:", positionsError);
    }

    // Group by run_id + symbol + exchange and keep only the latest
    const latestPositionsMap = new Map<string, Position>();
    for (const pos of (positionsData ?? []) as Position[]) {
      const key = `${pos.run_id}-${pos.symbol}-${pos.exchange}`;
      if (!latestPositionsMap.has(key)) {
        latestPositionsMap.set(key, pos);
      }
    }

    // Add strategy info to each position
    positions = Array.from(latestPositionsMap.values()).map((pos) => {
      const strategyInfo = runToStrategyMap.get(pos.run_id);
      return {
        ...pos,
        strategy_name: strategyInfo?.name ?? "Unknown",
        strategy_id: strategyInfo?.id ?? "",
      };
    });
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
    />
  );
}
