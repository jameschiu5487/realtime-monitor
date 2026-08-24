import type { StrategyRun } from "@/lib/types/database";

export interface CapitalGroup {
  /** The initial_capital shared by every run in the group. */
  capital: number;
  runCount: number;
  /** MM-DD of the group's first start and last end, for telling groups apart. */
  span: string;
}

export interface CapitalSelection {
  groups: CapitalGroup[];
  /** null means "every run, across all capital levels". */
  selected: number | null;
  runs: StrategyRun[];
  /**
   * Denominator for return percentages. For one group this is that group's
   * capital, not capital x run count: the runs are sequential restarts of the
   * same account, so multiplying would inflate the base behind every figure.
   * Across groups there is no single meaningful base, so it falls back to the
   * sum of every run's capital.
   */
  capitalBase: number;
}

/**
 * PostgREST can return numeric columns as strings. Coerce before grouping,
 * or the keys split ("1000.0" vs 1000) and sums become string concatenation.
 */
export function capitalOf(run: StrategyRun): number {
  return Number(run.initial_capital) || 0;
}

function monthDay(value: string | null | undefined): string {
  return value ? value.slice(5, 10) : "?";
}

/**
 * Groups runs by initial_capital and resolves which group to show.
 *
 * `param` is the raw `capital` search param: "all" for every run, a number to
 * request that group, anything else (missing, junk, a group that no longer
 * exists) falls back to whatever the most recent run used — the account
 * actually running now, and the cheapest group to load.
 */
export function selectCapitalGroup(
  runs: StrategyRun[],
  param: string | undefined,
): CapitalSelection {
  const buckets = new Map<number, StrategyRun[]>();
  for (const run of runs) {
    const key = capitalOf(run);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(run);
    else buckets.set(key, [run]);
  }

  const groups: CapitalGroup[] = [...buckets.entries()]
    .map(([capital, groupRuns]) => {
      const sorted = [...groupRuns].sort(
        (a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime(),
      );
      const last = sorted[sorted.length - 1];
      return {
        capital,
        runCount: sorted.length,
        span: `${monthDay(sorted[0].start_time)} ~ ${monthDay(last.end_time ?? last.start_time)}`,
      };
    })
    .sort((a, b) => a.capital - b.capital);

  const latestRun = [...runs].sort(
    (a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime(),
  )[0] as StrategyRun | undefined;

  const requested = param !== undefined && param !== "all" ? Number(param) : NaN;
  const selected =
    param === "all"
      ? null
      : buckets.has(requested)
        ? requested
        : latestRun
          ? capitalOf(latestRun)
          : null;

  const selectedRuns = selected === null ? runs : (buckets.get(selected) ?? runs);

  return {
    groups,
    selected,
    runs: selectedRuns,
    capitalBase:
      selected !== null
        ? selected
        : selectedRuns.reduce((sum, run) => sum + capitalOf(run), 0),
  };
}
