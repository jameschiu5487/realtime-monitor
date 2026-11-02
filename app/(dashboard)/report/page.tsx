import { createClient } from "@/lib/supabase/server";
import { loadShareSchedule } from "@/lib/share";
import { ReportContent } from "@/components/report/report-content";
import type { Strategy, StrategyRun } from "@/lib/types/database";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ReportPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const [{ data: strategiesData }, { data: runsData }, accessResult, share] = await Promise.all([
    supabase.from("strategies").select("*"),
    supabase.from("strategy_runs").select("*"),
    supabase.from("user_strategy_access").select("strategy_id").eq("user_id", user?.id ?? "") as unknown as Promise<{
      data: { strategy_id: string }[] | null;
    }>,
    // The viewer's share of every amount, over time (lib/share.ts).
    loadShareSchedule(supabase, user?.id),
  ]);

  const accessRows = accessResult.data ?? [];
  const accessibleIds = new Set(accessRows.map((r) => r.strategy_id));

  const allStrategies = ((strategiesData ?? []) as Strategy[]).filter(
    (s) => accessibleIds.has(s.strategy_id)
  );
  const allRuns = ((runsData ?? []) as StrategyRun[]).filter(
    (r) => accessibleIds.has(r.strategy_id)
  );

  return (
    <ReportContent
      allStrategies={allStrategies}
      allRuns={allRuns}
      share={share}
    />
  );
}
