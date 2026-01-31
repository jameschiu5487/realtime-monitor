import Link from "next/link";
import { unstable_noStore as noStore } from "next/cache";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowRight, TrendingUp } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import type { Strategy } from "@/lib/types/database";

// Disable caching to ensure fresh data on every page load
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function StrategiesPage() {
  noStore();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("strategies")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error fetching strategies:", error);
  }

  const strategies = (data ?? []) as Strategy[];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Strategies</h2>
          <p className="text-muted-foreground">
            Manage and monitor your trading strategies
          </p>
        </div>
      </div>

      {strategies.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No strategies found. Create your first strategy to get started.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          {strategies.map((strategy) => (
            <Card
              key={strategy.strategy_id}
              className="hover:shadow-lg transition-shadow flex flex-col h-full"
            >
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <CardTitle className="flex items-center gap-2">
                      <TrendingUp className="h-5 w-5" />
                      {strategy.name}
                    </CardTitle>
                    {strategy.description && (
                      <p className="text-sm text-muted-foreground">
                        {strategy.description}
                      </p>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    v{strategy.version}
                  </span>
                </div>
              </CardHeader>
              <CardContent className="flex flex-col flex-1">
                <div className="text-xs text-muted-foreground mb-4">
                  Created: {new Date(strategy.created_at).toLocaleDateString()}
                </div>

                <Link
                  href={`/strategies/${strategy.strategy_id}`}
                  className="mt-auto"
                >
                  <Button className="w-full" variant="outline">
                    View Details
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
