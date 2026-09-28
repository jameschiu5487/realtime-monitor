/**
 * Strategy-level evaluation of the shadow model, mirroring the research
 * pipeline's metrics in its stated priority order:
 *   1. threshold_calibration  2. curve_stats  3. topn_compare / margin_sweep
 *   4. decile_lens  (5. rank IC — deprecated, 6. R² — reported, not trusted)
 *   7. auxiliaries: symbols traded, concentration, fee sensitivity.
 *
 * Definitions (agreed 2026-09-28):
 *   net per event   = y_bp + exp_funding_bp − fee
 *   model trades    when ypred + exp_funding_bp > fee + margin
 *   funding-only    when exp_funding_bp > fee + margin (or top-N by exp_funding)
 * Every trade is equal-sized; capital crowding is ignored, as in research.
 * The research liquidity gate (qv_240 on both venues) is NOT applied: the
 * shadow tables carry no qv_240 (ledger open_volume_* is a different measure).
 */

import type { ScoredRow } from "./model-metrics";
import { taipeiDayKey, taipeiMonthKey, taipeiWeekKey } from "./time";

/** User's operating point (2026-09-28). Research ADR 0003 used 7.03 / 6. */
export const DEFAULT_FEE_BP = 4.4;
export const DEFAULT_MARGIN_BP = 3;
export const DEFAULT_BASIS_CAP = 200;

export type Period = "day" | "week" | "month";

export interface EvalConfig {
  feeBp: number;
  marginBp: number;
  period: Period;
  /** |entry_basis| cap; null = off. */
  basisCap: number | null;
}

export interface EvalRow {
  ts: number;
  symbol: string;
  ypred: number;
  y: number;
  expFunding: number;
  /** ypred + exp_funding: what the model rule compares to fee + margin. */
  signal: number;
}

export function prepare(rows: ScoredRow[], basisCap: number | null): EvalRow[] {
  const out: EvalRow[] = [];
  for (const r of rows) {
    if (r.expFundingBp == null || !Number.isFinite(r.expFundingBp)) continue;
    if (basisCap != null && r.entryBasis != null && Math.abs(r.entryBasis) > basisCap) continue;
    out.push({
      ts: r.fundingTs,
      symbol: r.symbol,
      ypred: r.ypred,
      y: r.yTrue,
      expFunding: r.expFundingBp,
      signal: r.ypred + r.expFundingBp,
    });
  }
  return out;
}

export const net = (r: EvalRow, feeBp: number) => r.y + r.expFunding - feeBp;

/* ------------------------------------------------------------------ */
/* Periods                                                              */
/* ------------------------------------------------------------------ */

/** Taipei period key: YYYY-MM-DD, the Monday of the ISO week, or YYYY-MM. */
export function periodKey(ts: number, period: Period): string {
  if (period === "month") return taipeiMonthKey(ts);
  if (period === "week") return taipeiWeekKey(ts);
  return taipeiDayKey(ts);
}

/* ------------------------------------------------------------------ */
/* Curve stats                                                          */
/* ------------------------------------------------------------------ */

export interface CurveStats {
  n: number;
  totalBp: number;
  perTradeBp: number | null;
  winRate: number | null;
  /** Largest peak-to-trough fall of cumulative bp. */
  maxDdBp: number;
  /** totalBp / maxDdBp; null when there was no drawdown. */
  retOverDd: number | null;
  positivePeriods: number;
  periods: number;
  curve: { ts: number; cum: number }[];
  byPeriod: Map<string, number>;
}

export function curveStats(trades: EvalRow[], feeBp: number, period: Period): CurveStats {
  const byTs = new Map<number, number>();
  const byPeriod = new Map<string, number>();
  let wins = 0;
  let total = 0;
  for (const t of trades) {
    const v = net(t, feeBp);
    total += v;
    if (v > 0) wins++;
    byTs.set(t.ts, (byTs.get(t.ts) ?? 0) + v);
    const k = periodKey(t.ts, period);
    byPeriod.set(k, (byPeriod.get(k) ?? 0) + v);
  }
  const curve: { ts: number; cum: number }[] = [];
  let cum = 0;
  let peak = 0;
  let maxDd = 0;
  for (const ts of [...byTs.keys()].sort((a, b) => a - b)) {
    cum += byTs.get(ts)!;
    peak = Math.max(peak, cum);
    maxDd = Math.max(maxDd, peak - cum);
    curve.push({ ts, cum });
  }
  const n = trades.length;
  return {
    n,
    totalBp: total,
    perTradeBp: n > 0 ? total / n : null,
    winRate: n > 0 ? wins / n : null,
    maxDdBp: maxDd,
    retOverDd: maxDd > 0 ? total / maxDd : null,
    positivePeriods: [...byPeriod.values()].filter((v) => v > 0).length,
    periods: byPeriod.size,
    curve,
    byPeriod,
  };
}

export function modelTrades(rows: EvalRow[], cfg: EvalConfig, marginBp = cfg.marginBp) {
  return rows.filter((r) => r.signal > cfg.feeBp + marginBp);
}
export function baselineTrades(rows: EvalRow[], cfg: EvalConfig, marginBp = cfg.marginBp) {
  return rows.filter((r) => r.expFunding > cfg.feeBp + marginBp);
}

/** newton_z: trade whenever exp_funding > 20 bp, independent of fee and margin. */
export const NEWTON_Z_MIN_EXP_FUNDING_BP = 20;
export function newtonZTrades(rows: EvalRow[]) {
  return rows.filter((r) => r.expFunding > NEWTON_Z_MIN_EXP_FUNDING_BP);
}

/* ------------------------------------------------------------------ */
/* 1. Threshold calibration                                             */
/* ------------------------------------------------------------------ */

/** Edges of edge = ypred + exp_funding − (fee + margin), bp. */
export const THRESHOLD_EDGES = [-10, -5, -2, 0, 2, 5, 10];

export interface ThresholdBin {
  label: string;
  lo: number;
  hi: number;
  n: number;
  meanNet: number | null;
  sumNet: number;
  winRate: number | null;
}

function binLabel(lo: number, hi: number): string {
  if (!Number.isFinite(lo)) return `< ${hi}`;
  if (!Number.isFinite(hi)) return `≥ ${lo}`;
  return `${lo} ~ ${hi}`;
}

function thresholdBinsOf(rows: EvalRow[], cfg: EvalConfig): ThresholdBin[] {
  const bounds = [-Infinity, ...THRESHOLD_EDGES, Infinity];
  const bins: ThresholdBin[] = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    bins.push({ label: binLabel(bounds[i], bounds[i + 1]), lo: bounds[i], hi: bounds[i + 1], n: 0, meanNet: null, sumNet: 0, winRate: null });
  }
  const wins = new Array<number>(bins.length).fill(0);
  const hurdle = cfg.feeBp + cfg.marginBp;
  for (const r of rows) {
    const edge = r.signal - hurdle;
    const i = bins.findIndex((b) => edge >= b.lo && edge < b.hi);
    const v = net(r, cfg.feeBp);
    bins[i].n++;
    bins[i].sumNet += v;
    if (v > 0) wins[i]++;
  }
  bins.forEach((b, i) => {
    b.meanNet = b.n > 0 ? b.sumNet / b.n : null;
    b.winRate = b.n > 0 ? wins[i] / b.n : null;
  });
  return bins;
}

export function thresholdCalibration(rows: EvalRow[], cfg: EvalConfig) {
  const byPeriodRows = new Map<string, EvalRow[]>();
  for (const r of rows) {
    const k = periodKey(r.ts, cfg.period);
    const arr = byPeriodRows.get(k);
    if (arr) arr.push(r);
    else byPeriodRows.set(k, [r]);
  }
  return {
    bins: thresholdBinsOf(rows, cfg),
    byPeriod: [...byPeriodRows.keys()]
      .sort()
      .map((k) => ({ period: k, bins: thresholdBinsOf(byPeriodRows.get(k)!, cfg) })),
  };
}

/* ------------------------------------------------------------------ */
/* 3. Baseline comparisons                                              */
/* ------------------------------------------------------------------ */

export const TOPN_SIZES = [25, 50, 100, 250, 500, 1000, 2000, 4000];

export interface CompareRow {
  key: number;
  model: CurveStats;
  baseline: CurveStats;
}

/** Same trade count: the N highest model signals vs the N highest exp_funding. */
export function topnCompare(rows: EvalRow[], cfg: EvalConfig): CompareRow[] {
  const byModel = [...rows].sort((a, b) => b.signal - a.signal);
  const byBase = [...rows].sort((a, b) => b.expFunding - a.expFunding);
  return TOPN_SIZES.filter((n) => n <= rows.length).map((n) => ({
    key: n,
    model: curveStats(byModel.slice(0, n), cfg.feeBp, cfg.period),
    baseline: curveStats(byBase.slice(0, n), cfg.feeBp, cfg.period),
  }));
}

export const MARGIN_SWEEP = Array.from({ length: 16 }, (_, i) => i);

/** Same threshold: both rules at fee + m for each margin m. */
export function marginSweep(rows: EvalRow[], cfg: EvalConfig): CompareRow[] {
  return MARGIN_SWEEP.map((m) => ({
    key: m,
    model: curveStats(modelTrades(rows, cfg, m), cfg.feeBp, cfg.period),
    baseline: curveStats(baselineTrades(rows, cfg, m), cfg.feeBp, cfg.period),
  }));
}

export interface PeriodDiff {
  periods: { period: string; model: number; baseline: number; diff: number }[];
  meanDiff: number | null;
  t: number | null;
  df: number;
  /** Two-sided p of the one-sample t-test on per-period (model − baseline). */
  p: number | null;
}

export function periodDiff(model: CurveStats, baseline: CurveStats): PeriodDiff {
  const keys = [...new Set([...model.byPeriod.keys(), ...baseline.byPeriod.keys()])].sort();
  const periods = keys.map((k) => {
    const m = model.byPeriod.get(k) ?? 0;
    const b = baseline.byPeriod.get(k) ?? 0;
    return { period: k, model: m, baseline: b, diff: m - b };
  });
  const k = periods.length;
  if (k < 2) return { periods, meanDiff: k === 1 ? periods[0].diff : null, t: null, df: 0, p: null };
  const mean = periods.reduce((s, p) => s + p.diff, 0) / k;
  const sd = Math.sqrt(periods.reduce((s, p) => s + (p.diff - mean) ** 2, 0) / (k - 1));
  if (sd === 0) return { periods, meanDiff: mean, t: null, df: k - 1, p: null };
  const t = mean / (sd / Math.sqrt(k));
  return { periods, meanDiff: mean, t, df: k - 1, p: studentTwoSidedP(t, k - 1) };
}

/* Student-t via the regularized incomplete beta (Numerical Recipes betacf). */
function logGamma(x: number): number {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x;
  const tmp = x + 5.5 - (x + 0.5) * Math.log(x + 5.5);
  let ser = 1.000000000190015;
  for (const ci of c) ser += ci / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

function betacf(a: number, b: number, x: number): number {
  const EPS = 3e-14;
  const FPMIN = 1e-300;
  let c = 1;
  let d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((a - 1 + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + 1 + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

function incompleteBeta(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (bt * betacf(a, b, x)) / a : 1 - (bt * betacf(b, a, 1 - x)) / b;
}

export function studentTwoSidedP(t: number, df: number): number {
  return incompleteBeta(df / 2, 0.5, df / (df + t * t));
}

/* ------------------------------------------------------------------ */
/* 4. Decile lens                                                       */
/* ------------------------------------------------------------------ */

export interface DecileRow {
  decile: number;
  n: number;
  lo: number;
  hi: number;
  meanPred: number;
  meanY: number;
  meanNet: number;
  winRate: number;
}

/**
 * Deciles of ypred. Research cuts at the train set's predictions; the shadow
 * has no train set, so the cut points come from these rows themselves.
 */
export function decileLens(rows: EvalRow[], feeBp: number): DecileRow[] {
  if (rows.length === 0) return [];
  const sorted = [...rows].sort((a, b) => a.ypred - b.ypred);
  const k = Math.min(10, sorted.length);
  const out: DecileRow[] = [];
  for (let d = 0; d < k; d++) {
    const s = sorted.slice(Math.floor((d * sorted.length) / k), Math.floor(((d + 1) * sorted.length) / k));
    if (s.length === 0) continue;
    const nets = s.map((r) => net(r, feeBp));
    out.push({
      decile: d + 1,
      n: s.length,
      lo: s[0].ypred,
      hi: s[s.length - 1].ypred,
      meanPred: s.reduce((a, r) => a + r.ypred, 0) / s.length,
      meanY: s.reduce((a, r) => a + r.y, 0) / s.length,
      meanNet: nets.reduce((a, v) => a + v, 0) / s.length,
      winRate: nets.filter((v) => v > 0).length / s.length,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 7. Auxiliaries                                                       */
/* ------------------------------------------------------------------ */

export interface Concentration {
  symbols: number;
  /** Symbol contributions to total net, largest |contribution| first. */
  bySymbol: { symbol: string; n: number; netBp: number }[];
  /** Share of Σ|contribution| held by the top 5 symbols. */
  top5Share: number | null;
  /** Herfindahl index of |contribution| shares; 1/HHI ≈ effective symbol count. */
  hhi: number | null;
}

export function concentration(trades: EvalRow[], feeBp: number): Concentration {
  const m = new Map<string, { n: number; netBp: number }>();
  for (const t of trades) {
    const e = m.get(t.symbol) ?? { n: 0, netBp: 0 };
    e.n++;
    e.netBp += net(t, feeBp);
    m.set(t.symbol, e);
  }
  const bySymbol = [...m.entries()]
    .map(([symbol, v]) => ({ symbol, ...v }))
    .sort((a, b) => Math.abs(b.netBp) - Math.abs(a.netBp));
  const absTotal = bySymbol.reduce((s, x) => s + Math.abs(x.netBp), 0);
  return {
    symbols: bySymbol.length,
    bySymbol,
    top5Share: absTotal > 0 ? bySymbol.slice(0, 5).reduce((s, x) => s + Math.abs(x.netBp), 0) / absTotal : null,
    hhi: absTotal > 0 ? bySymbol.reduce((s, x) => s + (Math.abs(x.netBp) / absTotal) ** 2, 0) : null,
  };
}

export const FEE_SENSITIVITY = [0, 3, 4.4, 5, 7.03, 8.8, 10, 12];

/** Re-run the rule at other fees: the threshold moves with the fee too. */
export function feeSensitivity(rows: EvalRow[], cfg: EvalConfig) {
  return FEE_SENSITIVITY.map((fee) => {
    const c = { ...cfg, feeBp: fee };
    return {
      fee,
      model: curveStats(modelTrades(rows, c), fee, cfg.period),
      baseline: curveStats(baselineTrades(rows, c), fee, cfg.period),
    };
  });
}
