export const dynamic = "force-dynamic";

import { createClient } from "@/lib/supabase/server";
import { PolymarketContent } from "@/components/polymarket/polymarket-content";
import type { StrategyRun, PolymarketEquity, PolymarketPosition, PolymarketSymbolPnl } from "@/lib/types/database";

const POLYMARKET_STRATEGY_ID = "ec82f9eb-6b84-419f-b51c-f800c1e6ad85";

export default async function PolymarketPage() {
  const supabase = await createClient();

  // Get the latest running run for the polymarket strategy
  const { data: runsData } = await supabase
    .from("strategy_runs")
    .select("*")
    .eq("strategy_id", POLYMARKET_STRATEGY_ID)
    .order("start_time", { ascending: false })
    .limit(10);

  const runs = (runsData ?? []) as StrategyRun[];
  const activeRun = runs.find((r) => r.status === "running") ?? runs[0];

  if (!activeRun) {
    return (
      <div className="flex items-center justify-center h-[60vh] text-muted-foreground">
        No Polymarket strategy runs found.
      </div>
    );
  }

  const runId = activeRun.run_id;

  // Fetch initial data in parallel
  const [equityRes, positionsRes, symbolPnlRes] = await Promise.all([
    supabase
      .from("polymarket_equity")
      .select("*")
      .eq("run_id", runId)
      .order("ts", { ascending: true }),
    supabase
      .from("polymarket_positions")
      .select("*")
      .eq("run_id", runId)
      .order("ts", { ascending: false })
      .limit(500),
    supabase
      .from("polymarket_symbol_pnl")
      .select("*")
      .eq("run_id", runId)
      .order("ts", { ascending: true }),
  ]);

  return (
    <PolymarketContent
      run={activeRun}
      allRuns={runs ?? []}
      initialEquity={(equityRes.data ?? []) as PolymarketEquity[]}
      initialPositions={(positionsRes.data ?? []) as PolymarketPosition[]}
      initialSymbolPnl={(symbolPnlRes.data ?? []) as PolymarketSymbolPnl[]}
    />
  );
}
