import { unstable_cache } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CombinedTrade,
  EquityCurve,
  FundAccountEquity,
  Strategy,
  StrategyRun,
} from "@/lib/types/database";

/**
 * Overview data layer.
 *
 * The dashboard page is dynamically rendered (the Supabase server client reads
 * cookies), so `export const revalidate` on the page has no effect. These
 * wrappers put the actual DB work behind the Next data cache instead, so a
 * refresh serves cached rows rather than re-querying Supabase every time.
 *
 * The cached rows are identical for every signed-in user — RLS on these tables
 * grants `authenticated` unrestricted SELECT — so one shared cache entry is
 * correct. Per-user data (user_strategy_access.share_ratio) is deliberately
 * NOT cached here and stays on the request-scoped client.
 */

const REVALIDATE_SECONDS = 60;
const OVERVIEW_TAG = "overview";
const PAGE_SIZE = 1000;
const MAX_PARALLEL_PAGES = 4;

/**
 * Round a timestamp down to the hour.
 *
 * Time windows are part of the cache key, so deriving them straight from
 * `Date.now()` would mint a new key on every request and nothing would ever hit
 * the cache. Hour granularity keeps a 7d/30d boundary accurate enough for
 * charts while holding the key steady between revalidations.
 */
export function hourBucket(now: number = Date.now()): number {
  return Math.floor(now / 3_600_000) * 3_600_000;
}

/** ISO timestamp `days` before the current hour bucket. */
export function bucketedSince(days: number): string {
  return new Date(hourBucket() - days * 24 * 60 * 60 * 1000).toISOString();
}

type PageResult<T> = { data: T[] | null; error: { message: string } | null };

/**
 * Read every row of a paged PostgREST query.
 *
 * Pages after the first are fetched in parallel waves — the original
 * implementation awaited one page at a time, which dominated the request when a
 * table returned tens of thousands of rows.
 */
async function fetchAllPages<T>(
  label: string,
  fetchPage: (from: number, to: number) => PromiseLike<PageResult<T>>
): Promise<T[]> {
  const first = await fetchPage(0, PAGE_SIZE - 1);
  if (first.error) {
    console.error(`Error fetching ${label}:`, first.error);
    return [];
  }

  const rows = [...(first.data ?? [])];
  if (rows.length < PAGE_SIZE) return rows;

  let nextPage = 1;
  for (;;) {
    const wave = await Promise.all(
      Array.from({ length: MAX_PARALLEL_PAGES }, (_, i) => {
        const offset = (nextPage + i) * PAGE_SIZE;
        return fetchPage(offset, offset + PAGE_SIZE - 1);
      })
    );

    let exhausted = false;
    for (const page of wave) {
      if (page.error) {
        console.error(`Error fetching ${label}:`, page.error);
        return rows;
      }
      const data = page.data ?? [];
      rows.push(...data);
      if (data.length < PAGE_SIZE) exhausted = true;
    }

    if (exhausted) return rows;
    nextPage += MAX_PARALLEL_PAGES;
  }
}

/* -------------------------------------------------------------------------- */
/* Strategies + runs                                                          */
/* -------------------------------------------------------------------------- */

/** Only `params.api` is read downstream (see accountIdsFromRunParams). */
type RunApiRow = {
  run_id: string;
  strategy_id: string;
  status: string;
  mode: string;
  start_time: string;
  api: Record<string, unknown> | null;
};

export type OverviewStrategy = Pick<Strategy, "strategy_id" | "name"> & {
  market?: string;
};

/**
 * Strategies and runs.
 *
 * `strategy_runs` is selected column-by-column rather than `*`: the table holds
 * a few hundred rows whose `params` jsonb is a large engine config, and the
 * overview only ever reads `params.api`. Pulling the subtree keeps roughly a
 * megabyte of unused JSON off every render.
 */
export async function getStrategiesAndRuns(supabase: SupabaseClient): Promise<{
  strategies: OverviewStrategy[];
  runs: StrategyRun[];
}> {
  return unstable_cache(
    async () => {
      const [strategiesResult, runsResult] = await Promise.all([
        supabase.from("strategies").select("strategy_id, name, market"),
        supabase
          .from("strategy_runs")
          .select("run_id, strategy_id, status, mode, start_time, api:params->api"),
      ]);

      if (strategiesResult.error) {
        console.error("Error fetching strategies:", strategiesResult.error);
      }
      if (runsResult.error) {
        console.error("Error fetching strategy_runs:", runsResult.error);
      }

      const runs = ((runsResult.data ?? []) as unknown as RunApiRow[]).map(
        (row) =>
          ({
            run_id: row.run_id,
            strategy_id: row.strategy_id,
            status: row.status,
            mode: row.mode,
            start_time: row.start_time,
            // Re-nest so consumers keep reading `run.params.api` unchanged.
            params: { api: row.api },
          }) as unknown as StrategyRun
      );

      return {
        strategies: (strategiesResult.data ?? []) as unknown as OverviewStrategy[],
        runs,
      };
    },
    ["overview:strategies-and-runs"],
    { revalidate: REVALIDATE_SECONDS, tags: [OVERVIEW_TAG] }
  )();
}

/* -------------------------------------------------------------------------- */
/* Equity curve                                                               */
/* -------------------------------------------------------------------------- */

/**
 * `drawdown_pct` is intentionally absent: buildCombinedEquityCurve recomputes it
 * from the merged series and never reads the stored value.
 */
const EQUITY_COLUMNS =
  "run_id, ts, total_equity, total_pnl, total_position_value, " +
  "binance_equity, binance_pnl, binance_position_value, " +
  "bybit_equity, bybit_pnl, bybit_position_value";

export async function getEquityCurve(
  supabase: SupabaseClient,
  runIds: string[],
  since: string
): Promise<EquityCurve[]> {
  if (runIds.length === 0) return [];

  return unstable_cache(
    async (ids: string[], sinceIso: string) =>
      fetchAllPages<EquityCurve>("equity_curve", (from, to) =>
        supabase
          .from("equity_curve")
          .select(EQUITY_COLUMNS)
          .in("run_id", ids)
          .gte("ts", sinceIso)
          .order("ts", { ascending: true })
          .range(from, to) as unknown as PromiseLike<PageResult<EquityCurve>>
      ),
    ["overview:equity-curve"],
    { revalidate: REVALIDATE_SECONDS, tags: [OVERVIEW_TAG] }
  )(runIds, since);
}

/** Latest equity row per running run, plus the earliest row inside the window. */
export async function getEquityEndpoints(
  supabase: SupabaseClient,
  runIds: string[],
  since24h: string
): Promise<{ latest: EquityCurve[]; dayAgo: EquityCurve[] }> {
  if (runIds.length === 0) return { latest: [], dayAgo: [] };

  return unstable_cache(
    async (ids: string[], sinceIso: string) => {
      const [latestRaw, dayAgoRaw] = await Promise.all([
        Promise.all(
          ids.map(async (runId) => {
            const { data } = await supabase
              .from("equity_curve")
              .select("run_id, total_equity, ts")
              .eq("run_id", runId)
              .order("ts", { ascending: false })
              .limit(1);
            return data?.[0] as EquityCurve | undefined;
          })
        ),
        Promise.all(
          ids.map(async (runId) => {
            const { data } = await supabase
              .from("equity_curve")
              .select("run_id, total_equity, ts")
              .eq("run_id", runId)
              .gte("ts", sinceIso)
              .order("ts", { ascending: true })
              .limit(1);
            return data?.[0] as EquityCurve | undefined;
          })
        ),
      ]);

      return {
        latest: latestRaw.filter(Boolean) as EquityCurve[],
        dayAgo: dayAgoRaw.filter(Boolean) as EquityCurve[],
      };
    },
    ["overview:equity-endpoints"],
    { revalidate: REVALIDATE_SECONDS, tags: [OVERVIEW_TAG] }
  )(runIds, since24h);
}

/* -------------------------------------------------------------------------- */
/* Trades                                                                     */
/* -------------------------------------------------------------------------- */

export async function getTodayTradeRunIds(
  supabase: SupabaseClient,
  runIds: string[],
  todayStart: string
): Promise<{ run_id: string }[]> {
  if (runIds.length === 0) return [];

  return unstable_cache(
    async (ids: string[], since: string) => {
      const { data, error } = await supabase
        .from("trades")
        .select("run_id")
        .in("run_id", ids)
        .gte("ts", since);
      if (error) {
        console.error("Error fetching trades:", error);
        return [];
      }
      return (data ?? []) as { run_id: string }[];
    },
    ["overview:today-trades"],
    { revalidate: REVALIDATE_SECONDS, tags: [OVERVIEW_TAG] }
  )(runIds, todayStart);
}

/**
 * Combined trades for the charted window.
 *
 * Previously fetched all-time with `select(*)`, which grew without bound. Every
 * consumer clips the array to the chart's range, and that range can never start
 * before the equity window (7d) — deeper history is refetched client-side by
 * the time-range selector — so a 30d bound leaves margin without changing any
 * displayed figure.
 */
const COMBINED_TRADE_COLUMNS =
  "run_id, ts, quantity, entry_price, exit_price, total_pnl";

export async function getCombinedTrades(
  supabase: SupabaseClient,
  runIds: string[],
  since: string
): Promise<CombinedTrade[]> {
  if (runIds.length === 0) return [];

  return unstable_cache(
    async (ids: string[], sinceIso: string) =>
      fetchAllPages<CombinedTrade>("combined_trades", (from, to) =>
        supabase
          .from("combined_trades")
          .select(COMBINED_TRADE_COLUMNS)
          .in("run_id", ids)
          .gte("ts", sinceIso)
          .order("ts", { ascending: true })
          .range(from, to) as unknown as PromiseLike<PageResult<CombinedTrade>>
      ),
    ["overview:combined-trades"],
    { revalidate: REVALIDATE_SECONDS, tags: [OVERVIEW_TAG] }
  )(runIds, since);
}

/* -------------------------------------------------------------------------- */
/* Fund account equity                                                        */
/* -------------------------------------------------------------------------- */

/**
 * 30 days of per-account equity — the heaviest query on the page.
 *
 * The window cannot be narrowed: the dashboard's range selector offers 30d and
 * the client prunes anything older itself. The page streams this behind a
 * Suspense boundary so the rest of the overview renders without waiting on it.
 */
export async function getFundAccountEquity(
  supabase: SupabaseClient,
  since: string
): Promise<{ data: FundAccountEquity[]; error: string | null }> {
  return unstable_cache(
    async (sinceIso: string) => {
      let failure: string | null = null;

      const data = await fetchAllPages<FundAccountEquity>(
        "fund_account_equity",
        async (from, to) => {
          const result = await supabase
            .from("fund_account_equity")
            .select("account_id, exchange, ts, total_equity")
            .gte("ts", sinceIso)
            .order("ts", { ascending: true })
            .range(from, to);
          if (result.error) failure = result.error.message;
          return result as unknown as PageResult<FundAccountEquity>;
        }
      );

      return { data, error: failure };
    },
    ["overview:fund-account-equity"],
    { revalidate: REVALIDATE_SECONDS, tags: [OVERVIEW_TAG] }
  )(since);
}
