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

// Fetch data with pagination and optional time filter
async function fetchDataWithLimit<T>(
  supabase: SupabaseClient,
  table: string,
  runId: string,
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
      .eq("run_id", runId)
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

  const firstTs = new Date(data[0].ts).getTime();
  const lastTs = new Date(data[data.length - 1].ts).getTime();
  const rangeDays = (lastTs - firstTs) / (1000 * 60 * 60 * 24);

  // If range <= 3 days, return all data
  if (rangeDays <= 3) return data;

  // Downsample to every 5 minutes
  const intervalMs = 5 * 60 * 1000; // 5 minutes in milliseconds
  const result: T[] = [];
  let lastKeptTs = 0;

  for (const point of data) {
    const ts = new Date(point.ts).getTime();
    if (ts - lastKeptTs >= intervalMs || result.length === 0) {
      result.push(point);
      lastKeptTs = ts;
    }
  }

  // Always include the last point
  if (result[result.length - 1] !== data[data.length - 1]) {
    result.push(data[data.length - 1]);
  }

  return result;
}

interface RunDetailsPageProps {
  params: Promise<{
    strategyId: string;
    runId: string;
  }>;
  searchParams: Promise<{
    range?: string;
  }>;
}

type RunWithStrategy = StrategyRun & { strategies: Strategy | null };

export default async function RunDetailsPage({ params, searchParams }: RunDetailsPageProps) {
  // Opt out of caching for this page
  noStore();

  const { strategyId, runId } = await params;
  const { range } = await searchParams;
  const supabase = await createClient();

  // Determine time filter: default 7 days, or all if range=all
  const isAllRange = range === "all";
  const since7d = isAllRange ? undefined : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

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

  // Fetch data in parallel with pagination
  // Default: last 7 days only for faster loading
  // range=all: fetch all data
  const [equityCurveRaw, pnlSeriesRaw, combinedTrades, positionsResult] = await Promise.all([
    fetchDataWithLimit<EquityCurve>(supabase, "equity_curve", runId, since7d),
    fetchDataWithLimit<PnlSeries>(supabase, "pnl_series", runId, since7d),
    fetchDataWithLimit<CombinedTrade>(supabase, "combined_trades", runId), // trades don't need time filter
    // Positions only need latest 100 for realtime display
    supabase
      .from("positions")
      .select("*")
      .eq("run_id", runId)
      .order("ts", { ascending: false })
      .limit(100),
  ]);

  // Downsample time series data if range > 3 days (every 5 minutes instead of every 1 minute)
  const equityCurve = downsampleTimeSeries(equityCurveRaw);
  const pnlSeries = downsampleTimeSeries(pnlSeriesRaw);

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
