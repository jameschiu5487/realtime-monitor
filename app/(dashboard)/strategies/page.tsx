import Link from "next/link";
import { unstable_noStore as noStore } from "next/cache";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowRight, ChevronDown, Layers, TrendingUp } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { groupStrategies, parentIdOf } from "@/lib/strategy-hierarchy";
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

  const accessible = (data ?? []) as Strategy[];

  // A parent is listed when the user can access it or any of its children, so
  // pull in parents that aren't in the access list themselves. Before the
  // parent_strategy_id column exists no row carries a parent and this is a no-op.
  const accessibleIds = new Set(accessible.map((s) => s.strategy_id));
  const missingParentIds = Array.from(
    new Set(
      accessible
        .map(parentIdOf)
        .filter((id): id is string => id !== null && !accessibleIds.has(id))
    )
  );
  let parents: Strategy[] = [];
  if (missingParentIds.length > 0) {
    const { data: parentData, error: parentError } = await supabase
      .from("strategies")
      .select("*")
      .in("strategy_id", missingParentIds);
    if (parentError) {
      console.error("Error fetching parent strategies:", parentError);
    }
    parents = (parentData ?? []) as Strategy[];
  }

  const groups = groupStrategies([...accessible, ...parents]);

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

      {groups.length === 0 ? (
        <Card>
          <CardContent className="flex h-[120px] sm:h-[160px] items-center justify-center text-sm text-muted-foreground">
            No strategies found. Create your first strategy to get started.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:gap-4 sm:grid-cols-2">
          {groups.map(({ strategy, children }) =>
            children.length === 0 ? (
              <StrategyCard key={strategy.strategy_id} strategy={strategy} />
            ) : (
              <div key={strategy.strategy_id} className="sm:col-span-2 space-y-2">
                <StrategyCard strategy={strategy} childCount={children.length} />
                <details open className="group rounded-lg border border-dashed">
                  <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2 text-xs text-muted-foreground select-none hover:text-foreground [&::-webkit-details-marker]:hidden">
                    <ChevronDown className="h-3.5 w-3.5 -rotate-90 transition-transform group-open:rotate-0" />
                    {children.length} child {children.length === 1 ? "strategy" : "strategies"} of {strategy.name}
                  </summary>
                  <div className="grid gap-3 sm:gap-4 sm:grid-cols-2 px-3 pb-3">
                    {children.map((child) => (
                      <StrategyCard key={child.strategy_id} strategy={child} />
                    ))}
                  </div>
                </details>
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}

function StrategyCard({
  strategy,
  childCount,
}: {
  strategy: Strategy;
  /** Set for a parent: it aggregates this many visible children. */
  childCount?: number;
}) {
  const isParent = childCount !== undefined;
  const Icon = isParent ? Layers : TrendingUp;

  return (
    <Link href={`/strategies/${strategy.strategy_id}`} className="block h-full">
      <Card className="h-full transition-colors hover:bg-accent/50 active:bg-accent/50">
        <CardContent className="p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                <Icon className="h-4 w-4 text-primary" />
              </div>
              <div className="min-w-0">
                <h3 className="font-semibold text-sm sm:text-base truncate">
                  {strategy.name}
                </h3>
                <span className="text-xs font-mono text-muted-foreground">
                  v{strategy.version}
                  {isParent && ` · aggregate of ${childCount} ${childCount === 1 ? "book" : "books"}`}
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
  );
}
