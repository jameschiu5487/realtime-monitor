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
import { ArrowLeft, BarChart3, ArrowRight, ChevronRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { StrategyRunsTable } from "@/components/strategies/strategy-runs-table";
import { SlippageAnalysis } from "@/components/strategies/slippage-analysis";
import { ParentStrategyView } from "@/components/strategies/parent-strategy-view";
import { fetchChildStrategies, fetchParentRef } from "@/lib/strategy-hierarchy";
import {
  SimulatedEquityBadge,
  SimulatedEquityNote,
} from "@/components/strategies/simulated-equity-note";
import type { SlippageTrade } from "@/lib/slippage";
import { formatVersion } from "@/lib/utils";
import type { Strategy, StrategyRun } from "@/lib/types/database";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface StrategyDetailPageProps {
  params: Promise<{ strategyId: string }>;
  searchParams: Promise<{ paper?: string }>;
}

export default async function StrategyDetailPage({
  params,
  searchParams,
}: StrategyDetailPageProps) {
  noStore();
  const { strategyId } = await params;
  const { paper } = await searchParams;
  const supabase = await createClient();

  const [strategyResult, runsResult, childStrategies] = await Promise.all([
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
    // Empty when this isn't a parent — or when parent_strategy_id doesn't exist yet.
    fetchChildStrategies(supabase, strategyId),
  ]);

  const strategy = strategyResult.data as Strategy | null;
  const runs = (runsResult.data ?? []) as StrategyRun[];

  if (strategyResult.error || !strategy) {
    return notFound();
  }

  // Parent strategy: aggregate view of the children the user can access.
  // The parent is visible with access to it or to any child; each child still
  // needs its own access to be included.
  if (childStrategies.length > 0) {
    const { data: { user } } = await supabase.auth.getUser();
    const { data: accessRows } = await supabase
      .from("user_strategy_access")
      .select("strategy_id, share_ratio")
      .eq("user_id", user?.id ?? "") as {
      data: { strategy_id: string; share_ratio: number }[] | null;
    };
    const ratioById = new Map(
      (accessRows ?? []).map((a) => [a.strategy_id, Number(a.share_ratio) || 1])
    );
    const visibleChildren = childStrategies.filter((c) => ratioById.has(c.strategy_id));
    if (!ratioById.has(strategyId) && visibleChildren.length === 0) {
      return notFound();
    }

    return (
      <ParentStrategyView
        supabase={supabase}
        parent={strategy}
        childStrategies={visibleChildren}
        parentShareRatio={ratioById.get(strategyId) ?? null}
        shareRatioByChild={Object.fromEntries(
          visibleChildren.map((c) => [c.strategy_id, ratioById.get(c.strategy_id) ?? 1])
        )}
        includePaper={paper === "1"}
      />
    );
  }

  // Child strategy: resolve the parent for the breadcrumb and the
  // "simulated equity" labelling.
  const parentStrategy = await fetchParentRef(supabase, strategy);

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
        <Link href={parentStrategy ? `/strategies/${parentStrategy.strategy_id}` : "/strategies"}>
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
              {parentStrategy && (
                <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
                  <Link href="/strategies" className="hover:text-foreground">
                    Strategies
                  </Link>
                  <ChevronRight className="h-3 w-3" />
                  <Link
                    href={`/strategies/${parentStrategy.strategy_id}`}
                    className="hover:text-foreground"
                  >
                    {parentStrategy.name}
                  </Link>
                </nav>
              )}
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
              {formatVersion(strategy.version)}
            </span>
          </div>
        </div>
      </div>

      {/* A child's figures come from its own virtual book, not the account */}
      {parentStrategy && <SimulatedEquityNote parent={parentStrategy} />}

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
                    <CardTitle className="flex flex-wrap items-center gap-2 text-sm sm:text-base">
                      Combined Performance
                      {parentStrategy && <SimulatedEquityBadge />}
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
