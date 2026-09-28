export const dynamic = "force-dynamic";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { ModelMonitorContent } from "@/components/model/model-monitor-content";
import type { ModelRow } from "@/lib/model-metrics";

const WINDOWS = [1, 3, 7, 30] as const;
const DEFAULT_DAYS = 7;
const PAGE_SIZE = 1000;

type PredictionRow = {
  funding_ts_ms: number;
  symbol: string;
  obs_ts_ms: number | null;
  ypred: number;
  exp_funding_bp: number | null;
  ledger_gap_obs: number | null;
  window_depth_min: number | null;
  substituted_inputs: number | null;
  model_version: string | null;
};

type LedgerRow = {
  funding_ts_ms: number;
  symbol: string;
  y_bp: number | null;
  direction: string | null;
  status: string | null;
  entry_basis: number | null;
  exit_basis: number | null;
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
  const predictions = await readAll<PredictionRow>("shadow_prediction", (from, to) =>
    supabase
      .from("shadow_prediction")
      .select(
        "funding_ts_ms, symbol, obs_ts_ms, ypred, exp_funding_bp, ledger_gap_obs, window_depth_min, substituted_inputs, model_version"
      )
      .not("ypred", "is", null)
      .gte("funding_ts_ms", sinceMs)
      .order("funding_ts_ms", { ascending: true })
      .order("symbol", { ascending: true })
      .range(from, to)
  );
  if (predictions.rows.length === 0) return { rows: [] as ModelRow[], error: predictions.error };

  // The ledger covers every symbol, not just the predicted ones — narrow it to
  // those so the read stays proportional to the predictions.
  const symbols = [...new Set(predictions.rows.map((p) => p.symbol))];
  // shadow_event_net = the ledger plus funding_bp from the venues' settled
  // rates (md_funding_settled). It is security_invoker, so that table needs
  // its own read policy (supabase/manual/2026-09-28-md-funding-settled-read-policy.sql).
  const ledger = await readAll<LedgerRow>("shadow_event_net", (from, to) =>
    supabase
      .from("shadow_event_net")
      .select("funding_ts_ms, symbol, y_bp, direction, status, entry_basis, exit_basis, funding_bp")
      .eq("origin", "live")
      .in("symbol", symbols)
      .gte("funding_ts_ms", sinceMs)
      .order("funding_ts_ms", { ascending: true })
      .order("symbol", { ascending: true })
      .range(from, to)
  );

  const byKey = new Map(ledger.rows.map((l) => [`${l.funding_ts_ms}|${l.symbol}`, l]));
  const rows: ModelRow[] = [];
  for (const p of predictions.rows) {
    // Only live ledger rows are real-time outcomes; a prediction whose ledger
    // row is missing is still pending (or backfill-only) and shows as open.
    const l = byKey.get(`${p.funding_ts_ms}|${p.symbol}`);
    rows.push({
      fundingTs: Number(p.funding_ts_ms),
      symbol: p.symbol,
      obsTs: p.obs_ts_ms == null ? null : Number(p.obs_ts_ms),
      ypred: p.ypred,
      yTrue: l?.status === "closed" ? l.y_bp : null,
      expFundingBp: p.exp_funding_bp,
      direction: l?.direction ?? null,
      status: l?.status ?? null,
      entryBasis: l?.entry_basis ?? null,
      exitBasis: l?.exit_basis ?? null,
      settledFundingBp: l?.funding_bp ?? null,
      ledgerGapObs: p.ledger_gap_obs,
      windowDepthMin: p.window_depth_min,
      substitutedInputs: p.substituted_inputs,
      modelVersion: p.model_version,
    });
  }
  return { rows, error: predictions.error ?? ledger.error };
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
