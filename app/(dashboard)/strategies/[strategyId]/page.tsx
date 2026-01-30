import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, TrendingUp } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { StrategyRunsTable } from "@/components/strategies/strategy-runs-table";
import type { Strategy, StrategyRun } from "@/lib/types/database";

interface StrategyDetailPageProps {
  params: Promise<{
    strategyId: string;
  }>;
}

export default async function StrategyDetailPage({
  params,
}: StrategyDetailPageProps) {
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
