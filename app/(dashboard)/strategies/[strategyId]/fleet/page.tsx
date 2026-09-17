import Link from "next/link";
import { notFound } from "next/navigation";
import { unstable_noStore as noStore } from "next/cache";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import {
  FleetContent,
  type FleetPod,
} from "@/components/strategies/fleet-content";
import type { Strategy, StrategyRun, PnlSeries } from "@/lib/types/database";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Recent window for the aggregate chart; the tiles only need each run's
// latest point, which this window always contains for a live pod.
const PNL_WINDOW_HOURS = 48;

interface FleetPageProps {
  params: Promise<{ strategyId: string }>;
}

export default async function FleetPage({ params }: FleetPageProps) {
  noStore();
  const { strategyId } = await params;
  const supabase = await createClient();

  const [strategyResult, runsResult] = await Promise.all([
    supabase
      .from("strategies")
      .select("*")
      .eq("strategy_id", strategyId)
      .single(),
    supabase
      .from("strategy_runs")
      .select("*")
      .eq("strategy_id", strategyId)
      .order("start_time", { ascending: false }),
  ]);

  const strategy = strategyResult.data as Strategy | null;
  if (strategyResult.error || !strategy) {
    return notFound();
  }
  const runs = (runsResult.data ?? []) as StrategyRun[];

  // Latest run per pod: runs come newest-first, so the first run seen for a
  // pod name is its representative. Runs without notes don't form pods.
  const podMap = new Map<string, StrategyRun>();
  for (const run of runs) {
    if (!run.notes) continue;
    if (!podMap.has(run.notes)) {
      podMap.set(run.notes, run);
    }
  }
  const pods: FleetPod[] = [...podMap.entries()]
    .map(([podName, run]) => ({ podName, run }))
    .sort((a, b) => a.podName.localeCompare(b.podName));

  const runIds = pods.map((p) => p.run.run_id);
  let pnlSeries: PnlSeries[] = [];
  if (runIds.length > 0) {
    const since = new Date(
      Date.now() - PNL_WINDOW_HOURS * 3600 * 1000
    ).toISOString();
    const { data, error } = await supabase
      .from("pnl_series")
      .select("*")
      .in("run_id", runIds)
      .gte("ts", since)
      .order("ts", { ascending: true })
      .limit(20000);
    if (error) {
      console.error("Error fetching fleet pnl_series:", error);
    }
    pnlSeries = (data ?? []) as PnlSeries[];
  }

  const { data: accessData } = (await supabase
    .from("user_strategy_access")
    .select("share_ratio")
    .eq("strategy_id", strategyId)
    .single()) as { data: { share_ratio: number } | null };
  const shareRatio = accessData?.share_ratio ?? 1;

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex items-start gap-3 sm:gap-4 pb-4 border-b">
        <Link href={`/strategies/${strategyId}`}>
          <Button variant="ghost" size="icon" className="mt-0.5 h-8 w-8 shrink-0">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight truncate">
            {strategy.name} — Fleet
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Latest run per pod, live PnL and health
          </p>
        </div>
      </div>

      <FleetContent
        strategyId={strategyId}
        pods={pods}
        initialPnlSeries={pnlSeries}
        shareRatio={shareRatio}
      />
    </div>
  );
}
