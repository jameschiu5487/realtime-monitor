import { createClient } from "@/lib/supabase/server";
import { BasisMonitorContent } from "@/components/basis-monitor/basis-monitor-content";
import type { BasisPair } from "@/lib/types/database";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function BasisMonitorPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("basis_pairs")
    .select("*")
    .order("created_at", { ascending: true });

  return <BasisMonitorContent initialPairs={(data ?? []) as BasisPair[]} />;
}
