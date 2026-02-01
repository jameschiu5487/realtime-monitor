import Link from "next/link";
import { notFound } from "next/navigation";
import { unstable_noStore as noStore } from "next/cache";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, TrendingUp, BarChart3, ArrowRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { StrategyRunsTable } from "@/components/strategies/strategy-runs-table";
import type { Strategy, StrategyRun } from "@/lib/types/database";

// Disable caching to ensure fresh data on every page load
export const dynamic = "force-dynamic";
export const revalidate = 0;

interface StrategyDetailPageProps {
  params: Promise<{
    strategyId: string;
  }>;
}

export default async function StrategyDetailPage({
  params,
}: StrategyDetailPageProps) {
  noStore();
  const { strategyId } = await params;
  const supabase = await createClient();

  // Fetch strategy and runs in parallel
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

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start gap-6 pb-6 border-b">
        <Link href="/strategies">
          <Button variant="ghost" size="icon" className="mt-1">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>
        <div className="flex-1">
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <h1 className="text-4xl font-bold tracking-tight flex items-center gap-3">
                <TrendingUp className="h-8 w-8" />
                {strategy.name}
              </h1>
              {strategy.description && (
                <p className="text-lg text-muted-foreground">
                  {strategy.description}
                </p>
              )}
            </div>
            <span className="text-sm text-muted-foreground">
              Version {strategy.version}
            </span>
          </div>
        </div>
      </div>

      {/* Combined View Card */}
      {runs.length > 0 && (
        <Link href={`/strategies/${strategyId}/combined`}>
          <Card className="hover:bg-muted/50 transition-colors cursor-pointer">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-primary/10 rounded-lg">
                  <BarChart3 className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-lg">Combined Performance</CardTitle>
                  <CardDescription>
                    View all {runs.length} runs combined with gap filling
                  </CardDescription>
                </div>
              </div>
              <ArrowRight className="h-5 w-5 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="flex gap-6 text-sm">
                <div>
                  <span className="text-muted-foreground">Total Runs: </span>
                  <span className="font-medium">{runs.length}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Total Capital: </span>
                  <span className="font-medium">
                    ${runs.reduce((sum, r) => sum + (r.initial_capital || 0), 0).toLocaleString()}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">Active Runs: </span>
                  <span className="font-medium">
                    {runs.filter((r) => r.status === "running").length}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        </Link>
      )}

      {/* Runs Section */}
      <Card>
        <CardHeader>
          <CardTitle>Strategy Runs</CardTitle>
        </CardHeader>
        <CardContent>
          <StrategyRunsTable runs={runs} strategyId={strategyId} />
        </CardContent>
      </Card>
    </div>
  );
}
