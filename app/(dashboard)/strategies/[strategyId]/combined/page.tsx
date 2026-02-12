import { notFound } from "next/navigation";
import { unstable_noStore as noStore } from "next/cache";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import { CombinedStrategyContent } from "@/components/combined-strategy-content";
import type { SupabaseClient } from "@supabase/supabase-js";
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

// Fetch data with pagination and optional time filter
async function fetchDataWithLimit<T>(
  supabase: SupabaseClient,
  table: string,
  runIds: string[],
  since?: string,
  orderBy: string = "ts"
): Promise<T[]> {
  const PAGE_SIZE = 1000;
  const allData: T[] = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    let query = supabase
      .from(table)
      .select("*")
      .in("run_id", runIds)
      .order(orderBy, { ascending: true });

    if (since) {
      query = query.gte("ts", since);
    }

    const { data, error } = await query.range(offset, offset + PAGE_SIZE - 1);

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

// Downsample time series data: if range > 3 days, keep only every 5 minutes
function downsampleTimeSeries<T extends { ts: string }>(data: T[]): T[] {
  if (data.length < 2) return data;

  const sorted = [...data].sort(
    (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime()
  );

  const firstTs = new Date(sorted[0].ts).getTime();
  const lastTs = new Date(sorted[sorted.length - 1].ts).getTime();
  const rangeDays = (lastTs - firstTs) / (1000 * 60 * 60 * 24);

  // If range <= 3 days, return all data
  if (rangeDays <= 3) return data;

  // Downsample to every 5 minutes
  const intervalMs = 5 * 60 * 1000; // 5 minutes in milliseconds
  const result: T[] = [];
  let lastKeptTs = 0;

  for (const point of sorted) {
    const ts = new Date(point.ts).getTime();
    if (ts - lastKeptTs >= intervalMs || result.length === 0) {
      result.push(point);
      lastKeptTs = ts;
    }
  }

  // Always include the last point
  if (result[result.length - 1] !== sorted[sorted.length - 1]) {
    result.push(sorted[sorted.length - 1]);
  }

  return result;
}

interface CombinedPageProps {
  params: Promise<{
    strategyId: string;
  }>;
  searchParams: Promise<{
    range?: string;
  }>;
}

export default async function CombinedStrategyPage({ params, searchParams }: CombinedPageProps) {
  noStore();

  const { strategyId } = await params;
  const { range } = await searchParams;

  // Determine time filter: default 7 days, or all if range=all
  const isAllRange = range === "all";
  const since7d = isAllRange ? undefined : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
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

  // Fetch data in parallel with pagination
  // Default: last 7 days only for faster loading
  // range=all: fetch all data
  const [allEquityCurveRaw, allPnlSeriesRaw, allCombinedTrades] = await Promise.all([
    fetchDataWithLimit<EquityCurve>(supabase, "equity_curve", runIds, since7d),
    fetchDataWithLimit<PnlSeries>(supabase, "pnl_series", runIds, since7d),
    fetchDataWithLimit<CombinedTrade>(supabase, "combined_trades", runIds), // trades don't need time filter
  ]);

  // Downsample time series data if range > 3 days (every 5 minutes instead of every 1 minute)
  const allEquityCurve = downsampleTimeSeries(allEquityCurveRaw);
  const allPnlSeries = downsampleTimeSeries(allPnlSeriesRaw);

  // Debug logging
  console.log(`[Combined] Strategy: ${strategyId}`);
  console.log(`[Combined] Run IDs: ${runIds.join(", ")}`);
  console.log(`[Combined] Total equity_curve records: ${allEquityCurveRaw.length} -> ${allEquityCurve.length} (downsampled)`);
  console.log(`[Combined] Total pnl_series records: ${allPnlSeriesRaw.length} -> ${allPnlSeries.length} (downsampled)`);
  console.log(`[Combined] Total combined_trades records: ${allCombinedTrades.length}`);
  if (allEquityCurve.length > 0) {
    const sorted = [...allEquityCurve].sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
    console.log(`[Combined] Equity curve date range: ${sorted[0].ts} to ${sorted[sorted.length - 1].ts}`);
  }

  // Calculate total initial capital from all runs
  const totalInitialCapital = (runs ?? []).reduce(
    (sum: number, run: StrategyRun) => sum + (run.initial_capital || 0),
    0
  );

  // Check if any run has hedge mode enabled
  const enableHedge = (runs ?? []).some((run: StrategyRun) => {
    const runParams = run.params as { strategy?: { enable_hedge?: boolean } } | null;
    return runParams?.strategy?.enable_hedge === true;
  });

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
        enableHedge={enableHedge}
      />
    </div>
  );
}
