export const dynamic = "force-dynamic";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { ModelMonitorContent } from "@/components/model/model-monitor-content";
import { packRows, type ModelRow } from "@/lib/model-metrics";
import { LIVE_STRATEGIES, pairLegs, type LiveLeg, type LiveTrade } from "@/lib/live-recon";

const WINDOWS = [1, 3, 7, 30] as const;
const DEFAULT_DAYS = 7;
const PAGE_SIZE = 1000;

/**
 * One row of shadow_prediction_all: one per (event, model_version), live first,
 * plus replay rows that reproduced and have no live counterpart. The view
 * already joins the outcome (y_bp, funding_bp, status…), so no second query.
 * It is security_invoker: every table under it needs an authenticated read
 * policy (supabase/manual/2026-09-28-*-read-policy.sql) or rows go missing
 * silently.
 */
type PredictionRow = {
  funding_ts_ms: number;
  symbol: string;
  obs_ts_ms: number | null;
  model_version: string | null;
  source: string | null;
  ypred: number;
  exp_funding_bp: number | null;
  entry_basis: number | null;
  ledger_gap_obs: number | null;
  window_depth_min: number | null;
  substituted_inputs: number | null;
  direction: string | null;
  status: string | null;
  y_bp: number | null;
  /** Realised funding from settled rates, bp; null until both legs have settled. */
  funding_bp: number | null;
};

/** PostgREST caps a response at 1000 rows, so read page by page. */
async function readAll<T>(
  label: string,
  page: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>
): Promise<{ rows: T[]; error: string | null }> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) {
      console.error(`[model] ${label}:`, error);
      return { rows, error: error.message };
    }
    const batch = (data ?? []) as T[];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) return { rows, error: null };
  }
}

/**
 * The view recomputes its whole join for every request, so OFFSET paging over
 * 30 days (~35k rows, mostly replay_historical) cost ~1.3 s per page, 35 pages
 * in a row. Bounded time slices each hit the indexes (~40 ms for 12 h) and run
 * in parallel; a slice past the 1000-row cap pages within itself.
 */
const SLICE_MS = 12 * 60 * 60 * 1000;
const PARALLEL_SLICES = 8;

async function loadSlice(supabase: SupabaseClient, fromMs: number, toMs: number) {
  return readAll<PredictionRow>(`shadow_prediction_all ${fromMs}`, (from, to) =>
    supabase
      .from("shadow_prediction_all")
      .select(
        "funding_ts_ms, symbol, obs_ts_ms, model_version, source, ypred, exp_funding_bp, entry_basis, ledger_gap_obs, window_depth_min, substituted_inputs, direction, status, y_bp, funding_bp"
      )
      .not("ypred", "is", null)
      .gte("funding_ts_ms", fromMs)
      .lt("funding_ts_ms", toMs)
      // Unique key, so pages never overlap or skip.
      .order("funding_ts_ms", { ascending: true })
      .order("symbol", { ascending: true })
      .order("model_version", { ascending: true })
      .range(from, to)
  );
}

async function loadRows(supabase: SupabaseClient, sinceMs: number) {
  // Up to an hour ahead: predictions are written before their settlement.
  const endMs = Date.now() + 60 * 60 * 1000;
  const slices: [number, number][] = [];
  for (let t = sinceMs; t < endMs; t += SLICE_MS) slices.push([t, Math.min(t + SLICE_MS, endMs)]);

  const raw: PredictionRow[] = [];
  let error: string | null = null;
  for (let i = 0; i < slices.length; i += PARALLEL_SLICES) {
    const wave = await Promise.all(
      slices.slice(i, i + PARALLEL_SLICES).map(([a, b]) => loadSlice(supabase, a, b))
    );
    for (const w of wave) {
      raw.push(...w.rows);
      error ??= w.error;
    }
  }

  const rows: ModelRow[] = raw.map((p) => ({
    fundingTs: Number(p.funding_ts_ms),
    symbol: p.symbol,
    obsTs: p.obs_ts_ms == null ? null : Number(p.obs_ts_ms),
    ypred: p.ypred,
    yTrue: p.status === "closed" ? p.y_bp : null,
    expFundingBp: p.exp_funding_bp,
    direction: p.direction,
    status: p.status,
    entryBasis: p.entry_basis,
    exitBasis: null,
    settledFundingBp: p.funding_bp,
    ledgerGapObs: p.ledger_gap_obs,
    windowDepthMin: p.window_depth_min,
    substitutedInputs: p.substituted_inputs,
    modelVersion: p.model_version,
    source: p.source,
  }));
  return { rows, error };
}

/** When each live strategy was running, so "shadow traded, live didn't" only counts its own hours. */
export type LiveWindows = Record<string, [number, number][]>;

/** The live strategies' realised trades in the window, legs paired into positions. */
async function loadLive(
  supabase: SupabaseClient,
  sinceMs: number
): Promise<{ trades: LiveTrade[]; windows: LiveWindows; error: string | null }> {
  const { data: runs, error: runsError } = await supabase
    .from("strategy_runs")
    .select("run_id, strategy_id, start_time, end_time")
    .in("strategy_id", LIVE_STRATEGIES.map((s) => s.id))
    .eq("mode", "realtime");
  if (runsError) {
    console.error("[model] live runs:", runsError);
    return { trades: [], windows: {}, error: runsError.message };
  }
  const nameOf = new Map<string, string>(LIVE_STRATEGIES.map((s) => [s.id, s.name]));
  const strategyOfRun = new Map<string, string>();
  const windows: LiveWindows = {};
  const now = Date.now();
  for (const r of runs ?? []) {
    const name = nameOf.get(r.strategy_id) ?? "Unknown";
    strategyOfRun.set(r.run_id, name);
    // start_time can be null while the engine is still creating the run.
    if (!r.start_time) continue;
    const end = r.end_time ? Date.parse(r.end_time) : now;
    if (end < sinceMs) continue;
    (windows[name] ??= []).push([Date.parse(r.start_time), end]);
  }
  const runIds = [...strategyOfRun.keys()];
  if (runIds.length === 0) return { trades: [], windows, error: null };

  const { rows, error } = await readAll<LiveLeg>("live combined_trades", (from, to) =>
    supabase
      .from("combined_trades")
      .select("run_id, symbol, ts, quantity, entry_price, holding_period_hours, price_pnl, funding_fee_realized, commission_fee")
      .in("run_id", runIds)
      .gte("ts", new Date(sinceMs).toISOString())
      .order("ts", { ascending: true })
      .order("combined_trade_id", { ascending: true })
      .range(from, to)
  );
  return { trades: pairLegs(rows, strategyOfRun), windows, error };
}

export default async function ModelPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const { days: daysParam } = await searchParams;
  const parsed = Number(daysParam);
  const days = (WINDOWS as readonly number[]).includes(parsed) ? parsed : DEFAULT_DAYS;

  const supabase = await createClient();
  const sinceMs = Date.now() - days * 86_400_000;
  const [{ rows, error }, live] = await Promise.all([loadRows(supabase, sinceMs), loadLive(supabase, sinceMs)]);

  return (
    <ModelMonitorContent
      packed={packRows(rows)}
      days={days}
      windows={[...WINDOWS]}
      error={error ?? live.error}
      liveTrades={live.trades}
      liveWindows={live.windows}
    />
  );
}
