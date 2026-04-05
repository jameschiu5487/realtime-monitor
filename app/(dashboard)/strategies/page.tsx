import Link from "next/link";
import { unstable_noStore as noStore } from "next/cache";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowRight, TrendingUp } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import type { Strategy } from "@/lib/types/database";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function StrategiesPage() {
  noStore();
  const supabase = await createClient();

  // Get current user
  const { data: { user } } = await supabase.auth.getUser();

  // Get strategies the user has access to
  const { data: accessData } = await supabase
    .from("user_strategy_access")
    .select("strategy_id")
    .eq("user_id", user?.id ?? "");

  const accessibleStrategyIds = (accessData ?? []).map((a: { strategy_id: string }) => a.strategy_id);

  const { data, error } = await supabase
    .from("strategies")
    .select("*")
    .in("strategy_id", accessibleStrategyIds.length > 0 ? accessibleStrategyIds : ["none"])
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error fetching strategies:", error);
  }

  const strategies = (data ?? []) as Strategy[];

  return (
    <div className="space-y-4 sm:space-y-6">
      <div>
        <h2 className="text-xl sm:text-2xl font-bold tracking-tight">
          Strategies
        </h2>
        <p className="text-sm text-muted-foreground">
          Manage and monitor your trading strategies
        </p>
      </div>

      {strategies.length === 0 ? (
        <Card>
          <CardContent className="flex h-[120px] sm:h-[160px] items-center justify-center text-sm text-muted-foreground">
            No strategies found. Create your first strategy to get started.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:gap-4 sm:grid-cols-2">
          {strategies.map((strategy) => (
            <Link
              key={strategy.strategy_id}
              href={`/strategies/${strategy.strategy_id}`}
            >
              <Card className="h-full transition-colors hover:bg-accent/50 active:bg-accent/50">
                <CardContent className="p-4 sm:p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                        <TrendingUp className="h-4 w-4 text-primary" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="font-semibold text-sm sm:text-base truncate">
                          {strategy.name}
                        </h3>
                        <span className="text-xs font-mono text-muted-foreground">
                          v{strategy.version}
                        </span>
                      </div>
                    </div>
                    <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground mt-2" />
                  </div>

                  {strategy.description && (
                    <p className="text-xs sm:text-sm text-muted-foreground mt-3 line-clamp-2">
                      {strategy.description}
                    </p>
                  )}

                  <p className="text-xs text-muted-foreground/70 font-mono mt-3">
                    Created{" "}
                    {new Date(strategy.created_at).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
