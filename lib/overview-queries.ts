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

/**
 * Next refuses data cache entries over 2MB. Stay under it with a margin — the
 * cache accounts for some overhead beyond the raw payload.
 */
const MAX_CACHEABLE_BYTES = 1_900_000;

/** Stand-in cached when a payload is too large to store. */
type OversizedMarker = { __overviewOversized: true };

function isOversized(value: unknown): value is OversizedMarker {
  return (
    typeof value === "object" &&
    value !== null &&
    "__overviewOversized" in value
  );
}

/**
 * Run a query through the data cache, degrading to a direct read when the
 * payload is too big to store.
 *
 * Handing an oversized value to unstable_cache makes it throw — and the throw
 * escapes as an unhandledRejection from its internal write, which a try/catch
 * around the call cannot reliably contain. So measure first and cache a small
 * marker instead. Subsequent requests see the marker (no re-measuring for the
 * revalidate window) and read straight through, which is exactly the behaviour
 * an uncacheable payload should have — minus the crash.
 */
async function cachedQuery<A extends unknown[], T>(
  label: string,
  keyParts: string[],
  fetcher: (...args: A) => Promise<T>,
  ...args: A
): Promise<T> {
  const measured = async (...inner: A): Promise<T | OversizedMarker> => {
    const result = await fetcher(...inner);
    const bytes = Buffer.byteLength(JSON.stringify(result) ?? "");

    if (bytes > MAX_CACHEABLE_BYTES) {
      console.warn(
        `[overview] ${label} is ${(bytes / 1024 / 1024).toFixed(2)} MB, ` +
          "above the 2MB data cache limit — serving it uncached."
      );
      return { __overviewOversized: true };
    }

    if (process.env.NODE_ENV !== "production") {
      console.log(
        `[overview] ${label}: ${(bytes / 1024 / 1024).toFixed(2)} MB`
      );
    }
    return result;
  };

  const cached = await unstable_cache(measured, keyParts, {
    revalidate: REVALIDATE_SECONDS,
    tags: [OVERVIEW_TAG],
  })(...args);

  return isOversized(cached) ? fetcher(...args) : cached;
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
  return cachedQuery(
    "strategies-and-runs",
    ["overview:strategies-and-runs"],
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
    }
  );
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

/** Unaggregated read — only used if the bucketing function is missing. */
async function fetchRawEquityCurve(
  supabase: SupabaseClient,
  ids: string[],
  sinceIso: string
): Promise<EquityCurve[]> {
  return fetchAllPages<EquityCurve>("equity_curve", (from, to) =>
    supabase
      .from("equity_curve")
      .select(EQUITY_COLUMNS)
      .in("run_id", ids)
      .gte("ts", sinceIso)
      .order("ts", { ascending: true })
      .range(from, to) as unknown as PromiseLike<PageResult<EquityCurve>>
  );
}

/**
 * Equity series for the performance chart, downsampled in Postgres.
 *
 * Per-minute rows across the 7d window came to ~10k rows / 3.2MB, over the
 * cache limit. Bucketing to 2 minutes for the last 24h and 15 minutes before
 * that gives ~1.3k rows / 0.44MB with no visible change to the chart.
 */
const EQUITY_FINE_BUCKET_MINUTES = 2;
const EQUITY_COARSE_BUCKET_MINUTES = 15;

export async function getEquityCurve(
  supabase: SupabaseClient,
  runIds: string[],
  since: string,
  fineSince: string
): Promise<EquityCurve[]> {
  if (runIds.length === 0) return [];

  return cachedQuery(
    "equity-curve",
    ["overview:equity-curve"],
    async (ids: string[], sinceIso: string, fineSinceIso: string) => {
      const { data, error } = await supabase.rpc("get_equity_curve_bucketed", {
        p_run_ids: ids,
        p_since: sinceIso,
        p_fine_since: fineSinceIso,
        p_fine_minutes: EQUITY_FINE_BUCKET_MINUTES,
        p_coarse_minutes: EQUITY_COARSE_BUCKET_MINUTES,
      });

      if (error) {
        const missing =
          error.code === "PGRST202" ||
          /function .* does not exist|could not find the function/i.test(
            error.message ?? ""
          );
        if (missing) {
          console.warn(
            "[overview] get_equity_curve_bucketed is missing — falling back " +
              "to the unaggregated read. Apply " +
              "supabase/manual/2026-08-06-equity-curve-bucketed-rpc.sql."
          );
          return fetchRawEquityCurve(supabase, ids, sinceIso);
        }
        console.error("Error fetching equity_curve:", error);
        return [];
      }

      if (!Array.isArray(data)) {
        console.error("[overview] unexpected equity payload:", typeof data);
        return [];
      }

      return data as EquityCurve[];
    },
    runIds,
    since,
    fineSince
  );
}

/** Latest equity row per running run, plus the earliest row inside the window. */
export async function getEquityEndpoints(
  supabase: SupabaseClient,
  runIds: string[],
  since24h: string
): Promise<{ latest: EquityCurve[]; dayAgo: EquityCurve[] }> {
  if (runIds.length === 0) return { latest: [], dayAgo: [] };

  return cachedQuery(
    "equity-endpoints",
    ["overview:equity-endpoints"],
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
    runIds,
    since24h
  );
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

  return cachedQuery(
    "today-trades",
    ["overview:today-trades"],
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
    runIds,
    todayStart
  );
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

  return cachedQuery(
    "combined-trades",
    ["overview:combined-trades"],
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
    runIds,
    since
  );
}

/* -------------------------------------------------------------------------- */
/* Fund account equity                                                        */
/* -------------------------------------------------------------------------- */

/** Unaggregated read — only used if the bucketing function is missing. */
async function fetchRawFundEquity(
  supabase: SupabaseClient,
  sinceIso: string
): Promise<{ data: FundAccountEquity[]; error: string | null }> {
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
}

/**
 * Per-account equity for the dashboard, downsampled in Postgres.
 *
 * The raw table holds a row per account per minute; over the 30d window the
 * dashboard needs that came to ~210k rows / 18.9MB, which blew past the 2MB
 * data cache limit and shipped whole to the browser to draw a chart a few
 * hundred pixels wide.
 *
 * get_fund_account_equity_bucketed keeps the last reading per time bucket, at
 * two resolutions: 5-minute detail for the last 24h, hourly before that. See
 * supabase/manual/2026-08-06-fund-equity-bucketed-rpc.sql.
 *
 * Bucket sizes were measured against production rather than guessed — with 15
 * accounts, per-minute buckets still came to 2.74MB and would not cache. These
 * produce ~0.76MB today, and roughly 1.0MB once the table holds a full 30 days
 * (it currently holds ~15).
 *
 * The function hands back one JSON array rather than a row set on purpose:
 * PostgREST truncates row responses at 1000, which silently clipped the result
 * to the first two or three account_ids. A single value has no such cap.
 */
const FINE_BUCKET_MINUTES = 5;
const COARSE_BUCKET_MINUTES = 60;

export async function getFundAccountEquity(
  supabase: SupabaseClient,
  since: string,
  fineSince: string
): Promise<{ data: FundAccountEquity[]; error: string | null }> {
  return cachedQuery(
    "fund-account-equity",
    ["overview:fund-account-equity"],
    async (sinceIso: string, fineSinceIso: string) => {
      const { data, error } = await supabase.rpc(
        "get_fund_account_equity_bucketed",
        {
          p_since: sinceIso,
          p_fine_since: fineSinceIso,
          p_fine_minutes: FINE_BUCKET_MINUTES,
          p_coarse_minutes: COARSE_BUCKET_MINUTES,
        }
      );

      if (error) {
        // PostgREST reports an absent function as PGRST202 / 404.
        const missing =
          error.code === "PGRST202" ||
          /function .* does not exist|could not find the function/i.test(
            error.message ?? ""
          );
        if (missing) {
          console.warn(
            "[overview] get_fund_account_equity_bucketed is missing — falling " +
              "back to the unaggregated read. Apply " +
              "supabase/manual/2026-08-06-fund-equity-bucketed-rpc.sql."
          );
          return fetchRawFundEquity(supabase, sinceIso);
        }
        console.error("Error fetching fund_account_equity:", error);
        return { data: [] as FundAccountEquity[], error: error.message };
      }

      if (!Array.isArray(data)) {
        console.error(
          "[overview] unexpected fund equity payload:",
          typeof data
        );
        return { data: [] as FundAccountEquity[], error: null };
      }

      const rows = (data as FundAccountEquity[]).map((row) => ({
        ...row,
        total_equity: Number(row.total_equity),
      }));

      return { data: rows, error: null };
    },
    since,
    fineSince
  );
}
