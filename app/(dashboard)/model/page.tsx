export const dynamic = "force-dynamic";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { ModelMonitorContent } from "@/components/model/model-monitor-content";
import type { ModelRow } from "@/lib/model-metrics";

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

async function loadRows(supabase: SupabaseClient, sinceMs: number) {
  const { rows: raw, error } = await readAll<PredictionRow>("shadow_prediction_all", (from, to) =>
    supabase
      .from("shadow_prediction_all")
      .select(
        "funding_ts_ms, symbol, obs_ts_ms, model_version, source, ypred, exp_funding_bp, entry_basis, ledger_gap_obs, window_depth_min, substituted_inputs, direction, status, y_bp, funding_bp"
      )
      .not("ypred", "is", null)
      .gte("funding_ts_ms", sinceMs)
      // Unique key, so pages never overlap or skip.
      .order("funding_ts_ms", { ascending: true })
      .order("symbol", { ascending: true })
      .order("model_version", { ascending: true })
      .range(from, to)
  );

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

export default async function ModelPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const { days: daysParam } = await searchParams;
  const parsed = Number(daysParam);
  const days = (WINDOWS as readonly number[]).includes(parsed) ? parsed : DEFAULT_DAYS;

  const supabase = await createClient();
  const { rows, error } = await loadRows(supabase, Date.now() - days * 86_400_000);

  return (
    <ModelMonitorContent rows={rows} days={days} windows={[...WINDOWS]} error={error} />
  );
}
