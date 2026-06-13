import { createClient } from "@/lib/supabase/server";
import { ReportContent } from "@/components/report/report-content";
import type { Strategy, StrategyRun } from "@/lib/types/database";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ReportPage() {
  const supabase = await createClient();

  const [{ data: strategiesData }, { data: runsData }, accessResult] = await Promise.all([
    supabase.from("strategies").select("*"),
    supabase.from("strategy_runs").select("*"),
    supabase.from("user_strategy_access").select("strategy_id, share_ratio") as unknown as Promise<{
      data: { strategy_id: string; share_ratio: number }[] | null;
    }>,
  ]);

  const accessRows = accessResult.data ?? [];
  const accessibleIds = new Set(accessRows.map((r) => r.strategy_id));

  const allStrategies = ((strategiesData ?? []) as Strategy[]).filter(
    (s) => accessibleIds.has(s.strategy_id)
  );
  const allRuns = ((runsData ?? []) as StrategyRun[]).filter(
    (r) => accessibleIds.has(r.strategy_id)
  );

  const shareRatioMap: Record<string, number> = {};
  for (const row of accessResult.data ?? []) {
    shareRatioMap[row.strategy_id] = row.share_ratio;
  }

  return (
    <ReportContent
      allStrategies={allStrategies}
      allRuns={allRuns}
      shareRatioMap={shareRatioMap}
    />
  );
}
