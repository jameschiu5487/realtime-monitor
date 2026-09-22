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
  startTime: string;
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
