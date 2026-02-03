import { notFound } from "next/navigation";
import { unstable_noStore as noStore } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { RunDetailsHeader } from "@/components/strategies/run-details-header";
import { RunDetailsContent } from "@/components/run-details-content";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Strategy,
  StrategyRun,
  EquityCurve,
  PnlSeries,
  CombinedTrade,
  Position,
} from "@/lib/types/database";

// Disable caching to ensure fresh data on every page load
export const dynamic = "force-dynamic";
export const revalidate = 0;

// Fetch all data with pagination (Supabase default limit is 1000)
async function fetchAllData<T>(
  supabase: SupabaseClient,
  table: string,
  runId: string,
  orderBy: string = "ts"
): Promise<T[]> {
  const PAGE_SIZE = 1000;
  const allData: T[] = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .eq("run_id", runId)
      .order(orderBy, { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) {
      console.error(`Error fetching ${table}:`, error);
      break;
    }

    if (data && data.length > 0) {
      allData.push(...(data as T[]));
      offset += PAGE_SIZE;
      hasMore = data.length === PAGE_SIZE;
    } else {
      hasMore = false;
    }
  }

  return allData;
}

interface RunDetailsPageProps {
  params: Promise<{
    strategyId: string;
    runId: string;
  }>;
}

type RunWithStrategy = StrategyRun & { strategies: Strategy | null };

export default async function RunDetailsPage({ params }: RunDetailsPageProps) {
  // Opt out of caching for this page
  noStore();

  const { strategyId, runId } = await params;
  const supabase = await createClient();

  // Fetch run info first
  const runResult = await supabase
    .from("strategy_runs")
    .select("*, strategies(*)")
    .eq("run_id", runId)
    .single();

  const run = runResult.data as RunWithStrategy | null;

  if (runResult.error || !run) {
    return notFound();
  }

  // Fetch all data in parallel with pagination to overcome 1000 row limit
  const [equityCurve, pnlSeries, combinedTrades, positionsResult] = await Promise.all([
    fetchAllData<EquityCurve>(supabase, "equity_curve", runId),
    fetchAllData<PnlSeries>(supabase, "pnl_series", runId),
    fetchAllData<CombinedTrade>(supabase, "combined_trades", runId),
    // Positions only need latest 100 for realtime display
    supabase
      .from("positions")
      .select("*")
      .eq("run_id", runId)
      .order("ts", { ascending: false })
      .limit(100),
  ]);

  const positions = (positionsResult.data ?? []) as Position[];

  const strategy = run.strategies;

  if (!strategy || strategy.strategy_id !== strategyId) {
    return notFound();
  }

  // Check if hedge is enabled from run params
  const runParams = run.params as { strategy?: { enable_hedge?: boolean } } | null;
  const enableHedge = runParams?.strategy?.enable_hedge ?? false;

  return (
    <div className="space-y-8">
      <RunDetailsHeader strategy={strategy} run={run} />

      <RunDetailsContent
        runId={runId}
        initialEquityCurve={equityCurve}
        initialPnlSeries={pnlSeries}
        initialCombinedTrades={combinedTrades}
        initialPositions={positions}
        initialCapital={run.initial_capital}
        enableHedge={enableHedge}
      />
    </div>
  );
}
