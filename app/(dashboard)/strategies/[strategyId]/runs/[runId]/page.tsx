import { notFound } from "next/navigation";
import { unstable_noStore as noStore } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { RunDetailsHeader } from "@/components/strategies/run-details-header";
import { RunDetailsContent } from "@/components/run-details-content";
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

  // Fetch all data in parallel
  // Note: Fetch in descending order with limit to get LATEST data (Supabase default limit is 1000)
  const [
    runResult,
    equityCurveResult,
    pnlSeriesResult,
    combinedTradesResult,
    positionsResult,
  ] = await Promise.all([
    supabase
      .from("strategy_runs")
      .select("*, strategies(*)")
      .eq("run_id", runId)
      .single(),
    supabase
      .from("equity_curve")
      .select("*")
      .eq("run_id", runId)
      .order("ts", { ascending: false })
      .limit(5000),
    supabase
      .from("pnl_series")
      .select("*")
      .eq("run_id", runId)
      .order("ts", { ascending: false })
      .limit(5000),
    supabase
      .from("combined_trades")
      .select("*")
      .eq("run_id", runId)
      .order("ts", { ascending: false })
      .limit(5000),
    supabase
      .from("positions")
      .select("*")
      .eq("run_id", runId)
      .order("ts", { ascending: false })
      .limit(100),
  ]);

  const run = runResult.data as RunWithStrategy | null;
  // Reverse to get ascending order (we fetched in descending order to get latest data)
  const equityCurve = ((equityCurveResult.data ?? []) as EquityCurve[]).reverse();
  const pnlSeries = ((pnlSeriesResult.data ?? []) as PnlSeries[]).reverse();
  const combinedTrades = ((combinedTradesResult.data ?? []) as CombinedTrade[]).reverse();
  const positions = (positionsResult.data ?? []) as Position[];

  if (runResult.error || !run) {
    return notFound();
  }

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
