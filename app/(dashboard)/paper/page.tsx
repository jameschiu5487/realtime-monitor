export const dynamic = "force-dynamic";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { PaperContent, type PaperEpisode } from "@/components/paper/paper-content";

const PAGE_SIZE = 1000;

/**
 * jfm_observe: jump-fade observe mode's finished episodes (simulated fills),
 * one row per episode, keyed (run_id, episode_id, t_flat). Written by
 * jfm-checkpoint; needs the authenticated read policy in
 * supabase/manual/2026-10-21-jfm-observe-read-policy.sql or reads come back empty.
 */
async function loadEpisodes(supabase: SupabaseClient) {
  const rows: PaperEpisode[] = [];
  let error: string | null = null;
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error: e } = await supabase
      .from("jfm_observe")
      .select(
        "run_id, strategy, episode_id, venue, symbol, side, t_sig, e, qty_filled, qty_kept, fill_minute, exit_reason, exit_vwap, t_flat, dup, roundtrip, straggler, flat_reason, price_pnl, commission_fee, total_pnl"
      )
      .order("t_flat", { ascending: true })
      .order("episode_id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (e) {
      console.error("[paper] jfm_observe:", e);
      error = e.message;
      break;
    }
    const batch = (data ?? []) as PaperEpisode[];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return { rows, error };
}

export default async function PaperPage() {
  const supabase = await createClient();
  const { rows, error } = await loadEpisodes(supabase);
  return <PaperContent episodes={rows} error={error} />;
}
