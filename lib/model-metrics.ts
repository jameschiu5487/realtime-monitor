/**
 * Shadow model monitoring: predictions (shadow_prediction.ypred) scored against
 * the realised y (shadow_event_ledger.y_bp), both in bp, joined on
 * (funding_ts_ms, symbol). Only ledger rows with origin = 'live' count — a
 * 'backfill' row came from the startup backfill, not a real-time prediction.
 */

export interface ModelRow {
  fundingTs: number;
  symbol: string;
  obsTs: number | null;
  ypred: number;
  /** null until the ledger closes, 8m05s after settlement. */
  yTrue: number | null;
  expFundingBp: number | null;
  direction: string | null;
  status: string | null;
  entryBasis: number | null;
  exitBasis: number | null;
  /** Realised funding from settled rates (shadow_event_net.funding_bp); null until settled. */
  settledFundingBp: number | null;
  ledgerGapObs: number | null;
  windowDepthMin: number | null;
  substitutedInputs: number | null;
  modelVersion: string | null;
}

/** Full 240-minute window and no history gap — the rows the model was built for. */
export const FULL_WINDOW_MIN = 240;
export function isClean(r: ModelRow): boolean {
  return r.ledgerGapObs === 0 && r.windowDepthMin === FULL_WINDOW_MIN;
}

export type ScoredRow = ModelRow & { yTrue: number };
export function scored(rows: ModelRow[]): ScoredRow[] {
  return rows.filter((r): r is ScoredRow => r.yTrue !== null && Number.isFinite(r.yTrue));
}

function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((s, x) => s + x, 0) / xs.length;
}

export function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 3) return null;
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}

/** Average ranks (ties share the mean rank), 1-based. */
function ranks(xs: number[]): number[] {
  const order = xs.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
  const out = new Array<number>(xs.length);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[order[k][1]] = r;
    i = j + 1;
  }
  return out;
}

export function spearman(xs: number[], ys: number[]): number | null {
  if (xs.length < 3) return null;
  return pearson(ranks(xs), ranks(ys));
}

export interface ModelSummary {
  n: number;
  ic: number | null;
  rankIc: number | null;
  /** Share of rows where sign(ypred) = sign(y); zeros excluded. */
  hitRate: number | null;
  mae: number;
  rmse: number;
  meanPred: number;
  meanTrue: number;
  /** meanPred − meanTrue: positive = the model over-predicts. */
  bias: number;
  /** Mean y of rows the model predicted positive — what trading its sign would earn. */
  meanTrueWhenPredPositive: number | null;
  /** 1 − SS_res / SS_tot. Research reports it but does not trust it. */
  r2: number | null;
}

export function summarize(rows: ScoredRow[]): ModelSummary | null {
  if (rows.length === 0) return null;
  const p = rows.map((r) => r.ypred);
  const y = rows.map((r) => r.yTrue);
  let hits = 0;
  let signed = 0;
  let absErr = 0;
  let sqErr = 0;
  for (let i = 0; i < rows.length; i++) {
    const e = y[i] - p[i];
    absErr += Math.abs(e);
    sqErr += e * e;
    if (p[i] !== 0 && y[i] !== 0) {
      signed++;
      if (Math.sign(p[i]) === Math.sign(y[i])) hits++;
    }
  }
  const positive = rows.filter((r) => r.ypred > 0).map((r) => r.yTrue);
  const meanPred = mean(p);
  const meanTrue = mean(y);
  const ssTot = y.reduce((s, v) => s + (v - meanTrue) ** 2, 0);
  return {
    n: rows.length,
    ic: pearson(p, y),
    rankIc: spearman(p, y),
    hitRate: signed > 0 ? hits / signed : null,
    mae: absErr / rows.length,
    rmse: Math.sqrt(sqErr / rows.length),
    meanPred,
    meanTrue,
    bias: meanPred - meanTrue,
    meanTrueWhenPredPositive: positive.length > 0 ? mean(positive) : null,
    r2: ssTot > 0 ? 1 - sqErr / ssTot : null,
  };
}

/**
 * A settlement's cross-sectional IC is noise below this many symbols — most
 * hourly settlements carry only 2, and two points always correlate at ±1.
 */
export const MIN_EVENT_N = 10;

export interface EventPoint {
  fundingTs: number;
  n: number;
  ic: number | null;
  rankIc: number | null;
  hitRate: number | null;
  meanPred: number;
  meanTrue: number;
  /** Pooled IC of every scored row up to and including this settlement. */
  cumulativeIc: number | null;
}

export function perEvent(rows: ScoredRow[]): EventPoint[] {
  const byTs = new Map<number, ScoredRow[]>();
  for (const r of rows) {
    const arr = byTs.get(r.fundingTs);
    if (arr) arr.push(r);
    else byTs.set(r.fundingTs, [r]);
  }
  const out: EventPoint[] = [];
  const cumP: number[] = [];
  const cumY: number[] = [];
  for (const ts of [...byTs.keys()].sort((a, b) => a - b)) {
    const group = byTs.get(ts)!;
    const s = summarize(group)!;
    for (const r of group) {
      cumP.push(r.ypred);
      cumY.push(r.yTrue);
    }
    const enough = group.length >= MIN_EVENT_N;
    out.push({
      fundingTs: ts,
      n: group.length,
      ic: enough ? s.ic : null,
      rankIc: enough ? s.rankIc : null,
      hitRate: s.hitRate,
      meanPred: s.meanPred,
      meanTrue: s.meanTrue,
      cumulativeIc: pearson(cumP, cumY),
    });
  }
  return out;
}

export interface CalibrationBin {
  bin: number;
  n: number;
  meanPred: number;
  meanTrue: number;
}

/** Rows sorted by ypred and cut into equal-count bins (deciles by default). */
export function calibration(rows: ScoredRow[], bins = 10): CalibrationBin[] {
  if (rows.length === 0) return [];
  const sorted = [...rows].sort((a, b) => a.ypred - b.ypred);
  const k = Math.min(bins, sorted.length);
  const out: CalibrationBin[] = [];
  for (let b = 0; b < k; b++) {
    const slice = sorted.slice(
      Math.floor((b * sorted.length) / k),
      Math.floor(((b + 1) * sorted.length) / k)
    );
    if (slice.length === 0) continue;
    out.push({
      bin: b + 1,
      n: slice.length,
      meanPred: mean(slice.map((r) => r.ypred)),
      meanTrue: mean(slice.map((r) => r.yTrue)),
    });
  }
  return out;
}

export interface HistogramBin {
  /** Bin centre, bp. */
  x: number;
  pred: number;
  truth: number;
  error: number;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[i];
}

/**
 * ypred, y and error (y − ypred) counted on one shared grid. The range is the
 * 1st–99th percentile of all three so a few outliers don't squash everything
 * into one bar; values outside land in the edge bins.
 */
export function histograms(rows: ScoredRow[], binCount = 30): HistogramBin[] {
  if (rows.length === 0) return [];
  const pred = rows.map((r) => r.ypred);
  const truth = rows.map((r) => r.yTrue);
  const error = rows.map((r) => r.yTrue - r.ypred);
  const all = [...pred, ...truth, ...error].sort((a, b) => a - b);
  let lo = quantile(all, 0.01);
  let hi = quantile(all, 0.99);
  if (hi <= lo) {
    lo -= 1;
    hi += 1;
  }
  const width = (hi - lo) / binCount;
  const bins: HistogramBin[] = Array.from({ length: binCount }, (_, i) => ({
    x: lo + (i + 0.5) * width,
    pred: 0,
    truth: 0,
    error: 0,
  }));
  const place = (v: number) =>
    Math.min(binCount - 1, Math.max(0, Math.floor((v - lo) / width)));
  for (const v of pred) bins[place(v)].pred++;
  for (const v of truth) bins[place(v)].truth++;
  for (const v of error) bins[place(v)].error++;
  return bins;
}
