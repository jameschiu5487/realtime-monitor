/**
 * Execution slippage analysis for the strategy page.
 *
 * Sign convention: positive is a cost — the fill came in worse than expected.
 * On live data 86% of trades are positive, averaging +0.75 bp, so treat
 * positive as adverse everywhere (colour, wording, "worst" meaning the
 * largest positive).
 */

export interface SlippageTrade {
  ts: string;
  exchange: string;
  exec_slippage_bps: number;
}

export interface SlippageStats {
  count: number;
  mean: number;
  median: number;
  /** 95th percentile — the tail cost, not the typical one. */
  p95: number;
  /** Largest cost seen. */
  worst: number;
  stdDev: number;
  /** Share of fills that cost money, 0..1. */
  adverseShare: number;
}

export interface ExchangeStats extends SlippageStats {
  exchange: string;
}

export interface HistogramBin {
  /** Axis label, e.g. "+0.5" or the overflow markers "≤ -2" / "≥ +3". */
  label: string;
  /** Count per exchange; keys match the exchange names passed in. */
  counts: Record<string, number>;
  total: number;
}

export interface Histogram {
  bins: HistogramBin[];
  binWidth: number;
  exchanges: string[];
  /**
   * Label of the bin that starts at zero, or null when zero is outside the
   * plotted range. The chart draws its break-even line by matching this exact
   * string — deriving it separately silently fails to match, and the line just
   * never appears.
   */
  zeroLabel: string | null;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const next = sorted[base + 1];
  return next === undefined ? sorted[base] : sorted[base] + rest * (next - sorted[base]);
}

export function summarize(values: number[]): SlippageStats | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = sorted.reduce((sum, v) => sum + v, 0) / n;
  const variance =
    n > 1 ? sorted.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (n - 1) : 0;

  return {
    count: n,
    mean,
    median: quantile(sorted, 0.5),
    p95: quantile(sorted, 0.95),
    worst: sorted[n - 1],
    stdDev: Math.sqrt(variance),
    adverseShare: sorted.filter((v) => v > 0).length / n,
  };
}

export function summarizeByExchange(trades: SlippageTrade[]): ExchangeStats[] {
  const byExchange = new Map<string, number[]>();
  for (const t of trades) {
    const bucket = byExchange.get(t.exchange);
    if (bucket) bucket.push(t.exec_slippage_bps);
    else byExchange.set(t.exchange, [t.exec_slippage_bps]);
  }
  return [...byExchange.entries()]
    .map(([exchange, values]) => {
      const stats = summarize(values);
      return stats ? { exchange, ...stats } : null;
    })
    .filter((s): s is ExchangeStats => s !== null)
    .sort((a, b) => b.count - a.count);
}

/** Bin widths that read well on an axis, in bps. */
const NICE_WIDTHS = [0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5, 10];
const TARGET_BINS = 18;

/**
 * Buckets slippage into a histogram, split by exchange for stacking.
 *
 * The range comes from the 2nd–98th percentile rather than min/max: live data
 * runs from -8.5 to +11.7 bp but a standard deviation of about 1, so equal-width
 * bins over the full range pile almost everything into two or three columns.
 * Values outside the trimmed range fall into overflow bins at either end, which
 * keeps the tails visible without flattening the middle.
 */
export function buildHistogram(trades: SlippageTrade[]): Histogram | null {
  if (trades.length === 0) return null;

  const exchanges = [...new Set(trades.map((t) => t.exchange))].sort();
  const sorted = trades.map((t) => t.exec_slippage_bps).sort((a, b) => a - b);

  let lo = quantile(sorted, 0.02);
  let hi = quantile(sorted, 0.98);
  if (hi - lo < 1e-9) {
    // Effectively one value; make a narrow window so a bar still renders.
    lo -= 0.5;
    hi += 0.5;
  }

  const rawWidth = (hi - lo) / TARGET_BINS;
  const binWidth = NICE_WIDTHS.find((w) => w >= rawWidth) ?? NICE_WIDTHS[NICE_WIDTHS.length - 1];

  // Snap the edges outward to whole multiples so labels land on round numbers.
  const start = Math.floor(lo / binWidth) * binWidth;
  const end = Math.ceil(hi / binWidth) * binWidth;
  const binCount = Math.max(1, Math.round((end - start) / binWidth));

  const emptyCounts = () => Object.fromEntries(exchanges.map((e) => [e, 0]));
  const decimals = binWidth < 1 ? (binWidth < 0.1 ? 2 : 1) : 0;
  const fmt = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(decimals)}`;

  const middle: HistogramBin[] = Array.from({ length: binCount }, (_, i) => ({
    label: fmt(start + i * binWidth),
    counts: emptyCounts(),
    total: 0,
  }));
  const low: HistogramBin = { label: `≤ ${fmt(start)}`, counts: emptyCounts(), total: 0 };
  const high: HistogramBin = { label: `≥ ${fmt(end)}`, counts: emptyCounts(), total: 0 };

  for (const t of trades) {
    const v = t.exec_slippage_bps;
    let bin: HistogramBin;
    if (v < start) bin = low;
    else if (v >= end) bin = high;
    else bin = middle[Math.min(binCount - 1, Math.floor((v - start) / binWidth))];
    bin.counts[t.exchange] += 1;
    bin.total += 1;
  }

  const bins = [
    ...(low.total > 0 ? [low] : []),
    ...middle,
    ...(high.total > 0 ? [high] : []),
  ];

  const zeroLabel = middle.some((b) => b.label === fmt(0)) ? fmt(0) : null;

  return { bins, binWidth, exchanges, zeroLabel };
}

/** Trades at or after `since`; pass the window start, not a duration. */
export function tradesSince(trades: SlippageTrade[], since: Date): SlippageTrade[] {
  const cutoff = since.getTime();
  return trades.filter((t) => new Date(t.ts).getTime() >= cutoff);
}
