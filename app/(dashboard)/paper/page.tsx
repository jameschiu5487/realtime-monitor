export const dynamic = "force-dynamic";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { loadShareSchedule } from "@/lib/share";
import { PaperContent, type PaperEpisode } from "@/components/paper/paper-content";
import type { LiveJfmTrade } from "@/components/paper/paper-vs-live";

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

/** The live strategy the paper episodes are compared against (PTA mode). */
const LIVE_STRATEGY_NAME = "Jump Fade Maker";

/**
 * Jump Fade Maker's live positions (combined_trades of its live runs). Empty
 * when the viewer has no access to the strategy (RLS).
 */
async function loadLiveTrades(supabase: SupabaseClient) {
  const { data: runs, error: runsError } = await supabase
    .from("strategy_runs")
    .select("run_id, strategies!inner(name)")
    .eq("strategies.name", LIVE_STRATEGY_NAME)
    .eq("mode", "live");
  if (runsError) {
    console.error("[paper] live runs:", runsError);
    return { trades: [] as LiveJfmTrade[], error: runsError.message };
  }
  const runIds = (runs ?? []).map((r) => r.run_id);
  const trades: LiveJfmTrade[] = [];
  if (runIds.length === 0) return { trades, error: null };
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("combined_trades")
      .select("combined_trade_id, run_id, symbol, exchange, side, quantity, entry_price, exit_price, entry_time, exit_time, ts, exit_type, price_pnl, commission_fee, funding_fee_realized, total_pnl")
      .in("run_id", runIds)
      .order("ts", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) {
      console.error("[paper] live combined_trades:", error);
      return { trades, error: error.message };
    }
    const batch = (data ?? []) as unknown as LiveJfmTrade[];
    trades.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return { trades, error: null };
}

export default async function PaperPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const [{ rows, error }, live, share] = await Promise.all([
    loadEpisodes(supabase),
    loadLiveTrades(supabase),
    // Live amounts are the viewer's share (lib/share.ts); paper is not an account anyone owns.
    loadShareSchedule(supabase, user?.id),
  ]);
  return <PaperContent episodes={rows} error={error} live={live.trades} liveError={live.error} share={share} />;
}
