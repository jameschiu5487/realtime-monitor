import type {
  CombinedTrade,
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
 * Share ratio: every figure is scaled by the viewer's share_ratio for the child
 * it came from, before summing (children may carry different ratios).
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
  /** Latest equity in the window, scaled. null when the run has no equity rows yet. */
  equity: number | null;
  /** Latest cumulative total_pnl, scaled. */
  pnl: number | null;
  /** (equity − initial) / initial, percent. Ratio-independent. */
  returnPct: number | null;
  /** Current drawdown from the window's peak, percent. */
  drawdownPct: number | null;
  /** Worst drawdown inside the window, percent. */
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

/** Per-book summary from its own (unscaled) equity series. */
export function summarizeBook(
  run: Pick<StrategyRun, "run_id" | "strategy_id" | "mode" | "start_time" | "initial_capital">,
  childName: string,
  shareRatio: number,
  series: EquityCurve[],
  positionsCount: number
): ParentBook {
  const initial = num(run.initial_capital);
  const last = series.length > 0 ? series[series.length - 1] : null;

  let peak = 0;
  let maxDd = 0;
  for (const p of series) {
    peak = Math.max(peak, p.total_equity);
    if (peak > 0) maxDd = Math.max(maxDd, ((peak - p.total_equity) / peak) * 100);
  }

  const base = initial > 0 ? initial : series[0]?.total_equity ?? 0;
  return {
    runId: run.run_id,
    childId: run.strategy_id,
    childName,
    mode: run.mode as string,
    startTime: run.start_time,
    shareRatio,
    initialCapital: initial * shareRatio,
    equity: last ? last.total_equity * shareRatio : null,
    pnl: last ? last.total_pnl * shareRatio : null,
    returnPct: last && base > 0 ? ((last.total_equity - base) / base) * 100 : null,
    drawdownPct: last && peak > 0 ? ((peak - last.total_equity) / peak) * 100 : null,
    maxDrawdownPct: last ? maxDd : null,
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
  seriesByRun: Map<string, EquityCurve[]>,
  ratioByRun: Record<string, number>
): PnlPoint[] {
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
        last.set(runId, series[i].total_pnl * (ratioByRun[runId] ?? 1));
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
 * Combined trades with quantity and PnL scaled per book, for PerformanceStats
 * (whose own shareRatio prop assumes a single ratio, so it gets 1).
 */
export function scaleCombinedTrades(
  trades: CombinedTrade[],
  ratioByRun: Record<string, number>
): CombinedTrade[] {
  return trades.map((t) => {
    const ratio = ratioByRun[t.run_id] ?? 1;
    return {
      ...t,
      quantity: num(t.quantity) * ratio,
      entry_price: num(t.entry_price),
      exit_price: t.exit_price == null ? t.exit_price : num(t.exit_price),
      total_pnl: num(t.total_pnl) * ratio,
    };
  });
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
 * points. Fields are scaled by the book's share ratio.
 */
export function buildBookStatsCurve(
  seriesByBook: Map<string, EquityCurve[]>,
  ratioByBook: Record<string, number>,
  capitalByBook: Record<string, number>
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
      const ratio = ratioByBook[book] ?? 1;
      const rec = last.get(book);
      const bookPnl = num((rec ?? series[0]).total_pnl);
      equity += (num(capitalByBook[book]) + bookPnl) * ratio;
      pnl += bookPnl * ratio;
      if (rec) positionValue += num(rec.total_position_value) * ratio;
    }
    peak = Math.max(peak, equity);
    result.push({
      run_id: "combined",
      ts: stamps.get(t) ?? new Date(t).toISOString(),
      total_equity: equity,
      total_pnl: pnl,
      total_position_value: positionValue,
      binance_equity: 0,
      binance_pnl: 0,
      binance_position_value: 0,
      bybit_equity: 0,
      bybit_pnl: 0,
      bybit_position_value: 0,
      drawdown_pct: peak > 0 ? ((peak - equity) / peak) * 100 : 0,
    });
  }
  return result;
}
