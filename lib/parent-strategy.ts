import { constantShare, currentRatio, ratioAt, scaleCumulative, type ShareSchedule } from "@/lib/share";
import type {
  EquityCurve,
  Position,
  StrategyRun,
} from "@/lib/types/database";
import { GAP_THRESHOLD_MS } from "@/lib/utils/equity";

/**
 * Aggregation for the parent strategy page.
 *
 * A parent (e.g. Kepler) has no runs of its own. Each child is an independent
 * book on the same exchange account and writes its own runs. The parent page
 * sums the children's *current* books: one running run per (child, mode).
 *
 * Share: amounts carry the viewer's share over time (lib/share.ts, one ratio
 * for every child); percentages are computed unscaled.
 */

/** Modes that count as "live" on the parent page. `realtime` is the legacy name. */
const LIVE_MODES = new Set(["live", "realtime"]);

export function isParentBookMode(mode: string, includePaper: boolean): boolean {
  return LIVE_MODES.has(mode) || (includePaper && mode === "paper");
}

export interface ParentBook {
  runId: string;
  childId: string;
  childName: string;
  mode: string;
  /** Nullable in practice: the engine can register a run before stamping start_time. */
  startTime: string | null;
  shareRatio: number;
  /** Scaled by shareRatio. */
  initialCapital: number;
  /** The run's initial_capital, unscaled: compared with the real account equity (× account). */
  capitalRaw: number;
  /** PnL over the window across the book's restarts, scaled increment by increment. */
  windowPnl: number | null;
  /** The same PnL unscaled: compared with the real account equity. */
  windowPnlRaw: number | null;
  /** Latest equity in the window, scaled. null when the run has no equity rows yet. */
  equity: number | null;
  /** Latest cumulative total_pnl, scaled. */
  pnl: number | null;
  /** Chained return over the window, across the book's restarts (see chainedIndex), percent. Ratio-independent. */
  returnPct: number | null;
  /** Current drawdown of the chained return from its peak in the window, percent. */
  drawdownPct: number | null;
  /** Worst drawdown of the chained return inside the window, percent. */
  maxDrawdownPct: number | null;
  positionsCount: number;
  lastUpdate: string | null;
}

export interface ParentPosition {
  runId: string;
  childId: string;
  book: string;
  symbol: string;
  exchange: string;
  /** Signed quantity, scaled. */
  quantity: number;
  /** Absolute notional, scaled. */
  notional: number;
  unrealizedPnl: number;
  ts: string;
}

const num = (v: unknown) => Number(v) || 0;
const time = (ts: string) => new Date(ts).getTime();

/** Group equity rows per run, sorted by time, numeric fields coerced. */
export function equityByRun(rows: EquityCurve[]): Map<string, EquityCurve[]> {
  const map = new Map<string, EquityCurve[]>();
  for (const row of rows) {
    const list = map.get(row.run_id) ?? [];
    list.push({
      ...row,
      total_equity: num(row.total_equity),
      total_pnl: num(row.total_pnl),
      total_position_value: num(row.total_position_value),
      binance_equity: num(row.binance_equity),
      binance_pnl: num(row.binance_pnl),
      binance_position_value: num(row.binance_position_value),
      bybit_equity: num(row.bybit_equity),
      bybit_pnl: num(row.bybit_pnl),
      bybit_position_value: num(row.bybit_position_value),
    });
    map.set(row.run_id, list);
  }
  for (const list of map.values()) list.sort((a, b) => time(a.ts) - time(b.ts));
  return map;
}

/**
 * The positions a run holds now.
 *
 * `positions` is a snapshot log, not a current-state table. Taking the latest
 * row per symbol alone would keep reporting a symbol the book closed if the
 * writer stopped emitting it instead of writing a zero row, so only rows from
 * the run's most recent snapshot (within GAP_THRESHOLD_MS of its newest row)
 * count, and flat rows are dropped.
 */
export function currentPositions(
  rows: Position[],
  book: Pick<ParentBook, "runId" | "childId" | "childName" | "mode" | "shareRatio">
): ParentPosition[] {
  if (rows.length === 0) return [];
  const newest = Math.max(...rows.map((r) => time(r.ts)));

  const latest = new Map<string, Position>();
  for (const row of [...rows].sort((a, b) => time(b.ts) - time(a.ts))) {
    if (newest - time(row.ts) > GAP_THRESHOLD_MS) continue;
    const key = `${row.symbol}|${row.exchange}`;
    if (!latest.has(key)) latest.set(key, row);
  }

  const label = book.mode === "paper" ? `${book.childName} (paper)` : book.childName;
  return Array.from(latest.values())
    .filter((p) => num(p.position) !== 0)
    .map((p) => ({
      runId: book.runId,
      childId: book.childId,
      book: label,
      symbol: p.symbol,
      exchange: p.exchange,
      quantity: num(p.position) * book.shareRatio,
      notional: Math.abs(num(p.notional_value)) * book.shareRatio,
      unrealizedPnl: num(p.unrealized_pnl) * book.shareRatio,
      ts: p.ts,
    }));
}

/**
 * Growth of 1 along a book's equity series: each step's PnL over the capital the
 * book ran at just before it (capital = total_equity − total_pnl), compounded. A
 * capital change (a restart at another size) is neither profit nor a new base for
 * the PnL earned before it, so a book that lost 150 at 4000 and now runs at 1000
 * reads about −4 %, not −15 %. Steps where the capital is not positive are skipped.
 */
export function chainedIndex(series: EquityCurve[]): number[] {
  const out: number[] = [];
  let idx = 1;
  for (let i = 0; i < series.length; i++) {
    if (i > 0) {
      const prev = series[i - 1];
      const capital = prev.total_equity - prev.total_pnl;
      if (capital > 0) idx *= 1 + (series[i].total_pnl - prev.total_pnl) / capital;
    }
    out.push(idx);
  }
  return out;
}

/**
 * Per-book summary from its own (unscaled) equity series. Amounts carry the
 * viewer's share (lib/share.ts): capital at the run's start, equity at its last
 * point, PnL increment by increment; the percentages stay unscaled and come from
 * `bookSeries` (the book across its restarts in the window, chainBookSeries),
 * chained (chainedIndex).
 */
export function summarizeBook(
  run: Pick<StrategyRun, "run_id" | "strategy_id" | "mode" | "start_time" | "initial_capital">,
  childName: string,
  share: ShareSchedule,
  series: EquityCurve[],
  positionsCount: number,
  bookSeries: EquityCurve[] = series
): ParentBook {
  const initial = num(run.initial_capital);
  const last = series.length > 0 ? series[series.length - 1] : null;

  const index = chainedIndex(bookSeries);
  let peak = 0;
  let maxDd = 0;
  for (const v of index) {
    peak = Math.max(peak, v);
    maxDd = Math.max(maxDd, ((peak - v) / peak) * 100);
  }
  const lastIndex = index.length > 0 ? index[index.length - 1] : null;
  let windowPnl: number | null = bookSeries.length > 0 ? 0 : null;
  let windowPnlRaw: number | null = windowPnl;
  for (let i = 1; i < bookSeries.length; i++) {
    const step = bookSeries[i].total_pnl - bookSeries[i - 1].total_pnl;
    windowPnl = (windowPnl ?? 0) + step * ratioAt(share, bookSeries[i].ts);
    windowPnlRaw = (windowPnlRaw ?? 0) + step;
  }

  const scaledPnl = scaleCumulative(series, (p) => p.ts, ["total_pnl"], share);
  return {
    runId: run.run_id,
    childId: run.strategy_id,
    childName,
    mode: run.mode as string,
    startTime: run.start_time,
    shareRatio: currentRatio(share),
    initialCapital: initial * ratioAt(share, run.start_time ?? series[0]?.ts ?? Date.now()),
    capitalRaw: initial,
    windowPnl,
    windowPnlRaw,
    equity: last ? last.total_equity * ratioAt(share, last.ts) : null,
    pnl: last ? scaledPnl[scaledPnl.length - 1].total_pnl : null,
    returnPct: last && lastIndex !== null ? (lastIndex - 1) * 100 : null,
    drawdownPct: last && lastIndex !== null && peak > 0 ? ((peak - lastIndex) / peak) * 100 : null,
    maxDrawdownPct: last && lastIndex !== null ? maxDd : null,
    positionsCount,
    lastUpdate: last?.ts ?? null,
  };
}

export interface PnlPoint {
  time: string;
  pnl: number;
}

/**
 * Summed cumulative PnL across books.
 *
 * Unlike equity, PnL is additive from zero, so a book that hasn't started yet
 * simply contributes nothing — the sum can start at the earliest book instead
 * of waiting for every book to exist. Each book's last value is carried forward
 * between its own points, so no timestamp double counts or drops a book.
 */
export function sumPnlSeries(
  seriesByRunRaw: Map<string, EquityCurve[]>,
  share: ShareSchedule
): PnlPoint[] {
  // Cumulative PnL: each book's increments at the viewer's ratio then (lib/share.ts).
  const seriesByRun = new Map(
    Array.from(seriesByRunRaw, ([id, s]) => [id, scaleCumulative(s, (p) => p.ts, ["total_pnl"], share)] as const)
  );
  const stamps = new Set<number>();
  for (const series of seriesByRun.values()) {
    for (const p of series) stamps.add(time(p.ts));
  }
  const sorted = Array.from(stamps).sort((a, b) => a - b);

  const idx = new Map<string, number>();
  const last = new Map<string, number>();
  const result: PnlPoint[] = [];

  for (const t of sorted) {
    for (const [runId, series] of seriesByRun) {
      let i = idx.get(runId) ?? 0;
      while (i < series.length && time(series[i].ts) <= t) {
        last.set(runId, series[i].total_pnl);
        i++;
      }
      idx.set(runId, i);
    }
    let total = 0;
    for (const v of last.values()) total += v;
    result.push({ time: new Date(t).toISOString(), pnl: total });
  }
  return result;
}

/**
 * Each book's equity series across its runs.
 *
 * A child restarted inside the window has several runs; its cumulative PnL
 * carries over from one run to the next (the engine persists the book's
 * totals), so the runs' rows concatenated in time order are one continuous PnL
 * series (equity is not: it jumps when the book's capital changes between
 * runs). `bookOfRun` maps every run (current and earlier) to the book key, the
 * current run's id.
 */
export function chainBookSeries(
  seriesByRun: Map<string, EquityCurve[]>,
  bookOfRun: Record<string, string>
): Map<string, EquityCurve[]> {
  const map = new Map<string, EquityCurve[]>();
  for (const [runId, series] of seriesByRun) {
    const book = bookOfRun[runId];
    if (!book) continue;
    map.set(book, [...(map.get(book) ?? []), ...series]);
  }
  for (const list of map.values()) list.sort((a, b) => time(a.ts) - time(b.ts));
  return map;
}

/**
 * Summed book equity from the earliest book, for the parent's stats and charts.
 *
 * Each book counts as its current capital plus its cumulative PnL, so a
 * capital change between runs (e.g. 2000 -> 6000) is not read as profit. A
 * book with no data yet counts at its first recorded PnL (flat, no position),
 * so a book coming online later neither shifts the start of the curve nor
 * adds a deposit-shaped jump; restarts don't reset it either (see
 * chainBookSeries). Each book's last value is carried forward between its
 * points. With a share (lib/share.ts) equity and position value are levels at
 * the ratio of their time and PnL is scaled increment by increment; leave it
 * out for PerformanceStats, whose figures are percentages. drawdown_pct is
 * always from the unscaled sum.
 */
export function buildBookStatsCurve(
  seriesByBook: Map<string, EquityCurve[]>,
  capitalByBook: Record<string, number>,
  share: ShareSchedule = constantShare(1)
): EquityCurve[] {
  const books = Array.from(seriesByBook.entries()).filter(([, s]) => s.length > 0);
  if (books.length === 0) return [];

  const stamps = new Map<number, string>();
  for (const [, series] of books) for (const p of series) stamps.set(time(p.ts), p.ts);
  const sorted = Array.from(stamps.keys()).sort((a, b) => a - b);

  const idx = new Map<string, number>();
  const last = new Map<string, EquityCurve>();
  const result: EquityCurve[] = [];
  let peak = 0;
  let prevRawPnl: number | null = null;
  let scaledPnl = 0;

  for (const t of sorted) {
    let equity = 0;
    let pnl = 0;
    let positionValue = 0;
    for (const [book, series] of books) {
      let i = idx.get(book) ?? 0;
      while (i < series.length && time(series[i].ts) <= t) {
        last.set(book, series[i]);
        i++;
      }
      idx.set(book, i);
      const rec = last.get(book);
      const bookPnl = num((rec ?? series[0]).total_pnl);
      equity += num(capitalByBook[book]) + bookPnl;
      pnl += bookPnl;
      if (rec) positionValue += num(rec.total_position_value);
    }
    // Drawdown from the unscaled sum; then the viewer's share.
    peak = Math.max(peak, equity);
    const drawdown = peak > 0 ? ((peak - equity) / peak) * 100 : 0;
    const ratio = ratioAt(share, t);
    scaledPnl = prevRawPnl === null ? pnl * ratio : scaledPnl + (pnl - prevRawPnl) * ratio;
    prevRawPnl = pnl;
    result.push({
      run_id: "combined",
      ts: stamps.get(t) ?? new Date(t).toISOString(),
      total_equity: equity * ratio,
      total_pnl: scaledPnl,
      total_position_value: positionValue * ratio,
      binance_equity: 0,
      binance_pnl: 0,
      binance_position_value: 0,
      bybit_equity: 0,
      bybit_pnl: 0,
      bybit_position_value: 0,
      drawdown_pct: drawdown,
    });
  }
  return result;
}
