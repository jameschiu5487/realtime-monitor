import Link from "next/link";
import { notFound } from "next/navigation";
import { unstable_noStore as noStore } from "next/cache";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, BarChart3, ArrowRight, LayoutGrid } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { StrategyRunsTable } from "@/components/strategies/strategy-runs-table";
import { SlippageAnalysis } from "@/components/strategies/slippage-analysis";
import type { SlippageTrade } from "@/lib/slippage";
import type { Strategy, StrategyRun } from "@/lib/types/database";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface StrategyDetailPageProps {
  params: Promise<{ strategyId: string }>;
}

export default async function StrategyDetailPage({
  params,
}: StrategyDetailPageProps) {
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
  const runs = (runsResult.data ?? []) as StrategyRun[];

  if (strategyResult.error || !strategy) {
    return notFound();
  }

  // Fetch share ratio for current user
  const { data: accessData } = await supabase
    .from("user_strategy_access")
    .select("share_ratio")
    .eq("strategy_id", strategyId)
    .single() as { data: { share_ratio: number } | null };
  const shareRatio = accessData?.share_ratio ?? 1;

  // Slippage is reported per fill, so it is read straight from trades rather
  // than any rollup. exec_slippage_bps only exists from 2026-08-10, so older
  // strategies legitimately come back empty and the section hides itself.
  const runIds = runs.map((r) => r.run_id);
  let slippageTrades: SlippageTrade[] = [];
  if (runIds.length > 0) {
    const { data: slippageRows, error: slippageError } = await supabase
      .from("trades")
      .select("ts, exchange, exec_slippage_bps")
      .in("run_id", runIds)
      .not("exec_slippage_bps", "is", null)
      .order("ts", { ascending: false })
      .limit(5000);

    if (slippageError) {
      console.error("Error fetching slippage:", slippageError);
    }
    slippageTrades = (slippageRows ?? []) as SlippageTrade[];
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex items-start gap-3 sm:gap-4 pb-4 border-b">
        <Link href="/strategies">
          <Button
            variant="ghost"
            size="icon"
            className="mt-0.5 h-8 w-8 shrink-0"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-1">
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight truncate">
                {strategy.name}
              </h1>
              {strategy.description && (
                <p className="text-sm text-muted-foreground mt-1">
                  {strategy.description}
                </p>
              )}
            </div>
            <span className="text-xs font-mono text-muted-foreground shrink-0">
              v{strategy.version}
            </span>
          </div>
        </div>
      </div>

      {/* Combined View Card */}
      {runs.length > 0 && (
        <Link href={`/strategies/${strategyId}/combined`}>
          <Card className="transition-colors hover:bg-accent/50 active:bg-accent/50">
            <CardContent className="p-4 sm:p-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                    <BarChart3 className="h-4 w-4 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <CardTitle className="text-sm sm:text-base">
                      Combined Performance
                    </CardTitle>
                    <CardDescription className="text-xs sm:text-sm">
                      {runs.length} runs combined with gap filling
                    </CardDescription>
                  </div>
                </div>
                <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </div>

              <div className="flex flex-wrap gap-x-5 gap-y-1 mt-3 text-sm text-muted-foreground">
                <span>
                  <span className="text-foreground font-mono font-medium">
                    {runs.length}
                  </span>{" "}
                  runs
                </span>
                <span>
                  <span className="text-foreground font-mono font-medium">
                    $
                    {(runs
                      .reduce((sum, r) => sum + (r.initial_capital || 0), 0) * shareRatio)
                      .toLocaleString()}
                  </span>{" "}
                  capital
                </span>
                <span>
                  <span className="text-foreground font-mono font-medium">
                    {runs.filter((r) => r.status === "running").length}
                  </span>{" "}
                  active
                </span>
              </div>
            </CardContent>
          </Card>
        </Link>
      )}

      {/* Fleet View — only for strategies deployed as parallel pods, i.e.
          runs carrying distinct pod names in notes (e.g. kore smallcap16) */}
      {new Set(runs.map((r) => r.notes).filter(Boolean)).size >= 2 && (
        <Link href={`/strategies/${strategyId}/fleet`}>
          <Card className="transition-colors hover:bg-accent/50 active:bg-accent/50">
            <CardContent className="p-4 sm:p-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                    <LayoutGrid className="h-4 w-4 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <CardTitle className="text-sm sm:text-base">
                      Fleet View
                    </CardTitle>
                    <CardDescription className="text-xs sm:text-sm">
                      {new Set(runs.map((r) => r.notes).filter(Boolean)).size}{" "}
                      pods — live health and aggregated PnL
                    </CardDescription>
                  </div>
                </div>
                <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </div>
            </CardContent>
          </Card>
        </Link>
      )}

      {/* Execution Slippage — renders nothing when the strategy has no data */}
      <SlippageAnalysis trades={slippageTrades} />

      {/* Runs Section */}
      <Card>
        <CardHeader className="px-3 sm:px-6">
          <CardTitle className="text-sm sm:text-base font-medium">
            Strategy Runs
          </CardTitle>
        </CardHeader>
        <CardContent className="px-0 sm:px-6">
          <div className="overflow-x-auto">
            <StrategyRunsTable runs={runs} strategyId={strategyId} shareRatio={shareRatio} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
