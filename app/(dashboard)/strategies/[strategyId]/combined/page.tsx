import { notFound } from "next/navigation";
import { unstable_noStore as noStore } from "next/cache";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import { CombinedStrategyContent } from "@/components/combined-strategy-content";
import type {
  Strategy,
  StrategyRun,
  EquityCurve,
  PnlSeries,
  CombinedTrade,
} from "@/lib/types/database";

// Disable caching to ensure fresh data on every page load
export const dynamic = "force-dynamic";
export const revalidate = 0;

interface CombinedPageProps {
  params: Promise<{
    strategyId: string;
  }>;
}

export default async function CombinedStrategyPage({ params }: CombinedPageProps) {
  noStore();

  const { strategyId } = await params;
  const supabase = await createClient();

  // Fetch strategy info
  const { data: strategy, error: strategyError } = await supabase
    .from("strategies")
    .select("*")
    .eq("strategy_id", strategyId)
    .single();

  if (strategyError || !strategy) {
    return notFound();
  }

  // Fetch all runs for this strategy
  const { data: runs } = await supabase
    .from("strategy_runs")
    .select("*")
    .eq("strategy_id", strategyId)
    .order("start_time", { ascending: true });

  const runIds = (runs ?? []).map((r: StrategyRun) => r.run_id);

  if (runIds.length === 0) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Link href={`/strategies/${strategyId}`}>
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h2 className="text-2xl font-bold">{(strategy as Strategy).name} - Combined View</h2>
            <p className="text-muted-foreground">No runs available</p>
          </div>
        </div>
      </div>
    );
  }

  // Fetch all data from all runs in parallel
  // Note: Fetch in descending order with limit to get LATEST data
  const [equityCurveResult, pnlSeriesResult, combinedTradesResult] = await Promise.all([
    supabase
      .from("equity_curve")
      .select("*")
      .in("run_id", runIds)
      .order("ts", { ascending: false })
      .limit(10000),
    supabase
      .from("pnl_series")
      .select("*")
      .in("run_id", runIds)
      .order("ts", { ascending: false })
      .limit(10000),
    supabase
      .from("combined_trades")
      .select("*")
      .in("run_id", runIds)
      .order("ts", { ascending: false })
      .limit(10000),
  ]);

  // Reverse to get ascending order
  const allEquityCurve = ((equityCurveResult.data ?? []) as EquityCurve[]).reverse();
  const allPnlSeries = ((pnlSeriesResult.data ?? []) as PnlSeries[]).reverse();
  const allCombinedTrades = ((combinedTradesResult.data ?? []) as CombinedTrade[]).reverse();

  // Calculate total initial capital from all runs
  const totalInitialCapital = (runs ?? []).reduce(
    (sum: number, run: StrategyRun) => sum + (run.initial_capital || 0),
    0
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href={`/strategies/${strategyId}`}>
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h2 className="text-2xl font-bold">{(strategy as Strategy).name} - Combined View</h2>
          <p className="text-muted-foreground">
            {runIds.length} runs combined • Initial Capital: ${totalInitialCapital.toLocaleString()}
          </p>
        </div>
      </div>

      <CombinedStrategyContent
        strategyId={strategyId}
        initialEquityCurve={allEquityCurve}
        initialPnlSeries={allPnlSeries}
        initialCombinedTrades={allCombinedTrades}
        initialCapital={totalInitialCapital}
        runIds={runIds}
      />
    </div>
  );
}
