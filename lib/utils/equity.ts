import type { EquityCurve } from "@/lib/types/database";
import { constantShare, isConstantShare, ratioAt, scaleCumulative, type ShareSchedule } from "@/lib/share";

export interface ChartDataPoint {
  time: number;
  equity: number;
}

export const GAP_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Merge equity data for a single strategy's runs with gap filling.
 * At each timestamp, dedup (latest run wins), then fill gaps with bridge points.
 */
export function mergeStrategyEquity(data: EquityCurve[]): EquityCurve[] {
  if (data.length === 0) return [];

  const sorted = [...data].sort(
    (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime()
  );

  // Dedup by timestamp (latest run wins)
  const timeMap = new Map<string, EquityCurve>();
  for (const point of sorted) {
    timeMap.set(point.ts, { ...point });
  }

  const deduped = Array.from(timeMap.values()).sort(
    (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime()
  );

  // Fill gaps with bridge points
  const merged: EquityCurve[] = [];
  for (let i = 0; i < deduped.length; i++) {
    if (i > 0) {
      const prevTime = new Date(deduped[i - 1].ts).getTime();
      const currentTime = new Date(deduped[i].ts).getTime();
      if (currentTime - prevTime > GAP_THRESHOLD_MS) {
        merged.push({
          ...deduped[i - 1],
          ts: new Date(currentTime - 1).toISOString(),
          run_id: "bridge",
        });
      }
    }
    merged.push(deduped[i]);
  }

  return merged;
}

/**
 * Aggregate merged equity curves across strategies with forward-fill. Equity is
 * a level, so each point takes the viewer's ratio at its own time (lib/share.ts);
 * the default share leaves it unscaled.
 */
export function aggregateTotalEquity(
  strategyData: Map<string, EquityCurve[]>,
  share: ShareSchedule = constantShare(1)
): ChartDataPoint[] {
  if (strategyData.size === 0) return [];

  // Collect all unique timestamps
  const allTimestamps = new Set<number>();
  for (const data of strategyData.values()) {
    for (const point of data) {
      allTimestamps.add(new Date(point.ts).getTime());
    }
  }

  const sortedTimestamps = Array.from(allTimestamps).sort((a, b) => a - b);

  // Find latest start time across all strategies
  let latestStartTime = 0;
  for (const [, data] of strategyData) {
    if (data.length > 0) {
      const startTime = new Date(data[0].ts).getTime();
      if (startTime > latestStartTime) latestStartTime = startTime;
    }
  }

  // Forward-fill per strategy and sum
  const strategyIndices = new Map<string, number>();
  const lastValues = new Map<string, number>();
  for (const strategyId of strategyData.keys()) {
    strategyIndices.set(strategyId, 0);
  }

  const result: ChartDataPoint[] = [];

  for (const ts of sortedTimestamps) {
    for (const [strategyId, data] of strategyData) {
      let idx = strategyIndices.get(strategyId) || 0;
      while (idx < data.length && new Date(data[idx].ts).getTime() <= ts) {
        lastValues.set(strategyId, data[idx].total_equity * ratioAt(share, data[idx].ts));
        idx++;
      }
      strategyIndices.set(strategyId, idx);
    }

    if (ts < latestStartTime) continue;

    let total = 0;
    for (const val of lastValues.values()) {
      total += val;
    }

    if (lastValues.size > 0) {
      result.push({ time: ts, equity: total });
    }
  }

  return result;
}

const LEVEL_FIELDS = [
  "total_equity",
  "total_position_value",
  "binance_equity",
  "binance_position_value",
  "bybit_equity",
  "bybit_position_value",
] as const;
const CUMULATIVE_FIELDS = ["total_pnl", "binance_pnl", "bybit_pnl"] as const;

/**
 * One strategy's series with the viewer's share applied: levels at their own
 * time, cumulative PnL increment by increment (lib/share.ts).
 */
function scaleStrategySeries(data: EquityCurve[], share: ShareSchedule): EquityCurve[] {
  if (isConstantShare(share) && (share[0]?.ratio ?? 1) === 1) return data;
  const withPnl = scaleCumulative(data, (p) => p.ts, [...CUMULATIVE_FIELDS], share);
  return withPnl.map((p) => {
    const r = ratioAt(share, p.ts);
    const out = { ...p };
    for (const f of LEVEL_FIELDS) out[f] = Number(p[f] ?? 0) * r;
    return out;
  });
}

/**
 * Build a combined EquityCurve[] (summing across strategies with forward-fill).
 * PerformanceStats takes it unscaled (the default): its figures are
 * percentages, and a ratio change is a change of ownership, not performance.
 * With a share, amounts are scaled as in scaleStrategySeries; drawdown_pct is
 * always from the unscaled sum, for the same reason.
 */
export function buildCombinedEquityCurve(
  strategyDataRaw: Map<string, EquityCurve[]>,
  share: ShareSchedule = constantShare(1)
): EquityCurve[] {
  if (strategyDataRaw.size === 0) return [];
  const strategyData = new Map(
    Array.from(strategyDataRaw, ([id, data]) => [id, scaleStrategySeries(data, share)] as const)
  );

  const allTimestamps = new Set<number>();
  const tsToIso = new Map<number, string>();
  for (const data of strategyData.values()) {
    for (const point of data) {
      const t = new Date(point.ts).getTime();
      allTimestamps.add(t);
      tsToIso.set(t, point.ts);
    }
  }

  const sortedTimestamps = Array.from(allTimestamps).sort((a, b) => a - b);

  let latestStartTime = 0;
  for (const [, data] of strategyData) {
    if (data.length > 0) {
      const st = new Date(data[0].ts).getTime();
      if (st > latestStartTime) latestStartTime = st;
    }
  }

  const strategyIndices = new Map<string, number>();
  const lastRecords = new Map<string, EquityCurve>();
  const lastRaw = new Map<string, number>();
  for (const strategyId of strategyData.keys()) {
    strategyIndices.set(strategyId, 0);
  }

  const result: EquityCurve[] = [];
  let peakEquity = 0;

  for (const ts of sortedTimestamps) {
    for (const [strategyId, data] of strategyData) {
      let idx = strategyIndices.get(strategyId) || 0;
      while (idx < data.length && new Date(data[idx].ts).getTime() <= ts) {
        lastRecords.set(strategyId, data[idx]);
        lastRaw.set(strategyId, Number(strategyDataRaw.get(strategyId)?.[idx]?.total_equity ?? 0));
        idx++;
      }
      strategyIndices.set(strategyId, idx);
    }

    if (ts < latestStartTime) continue;
    if (lastRecords.size === 0) continue;

    let totalEquity = 0;
    let totalPnl = 0;
    let totalPositionValue = 0;
    let binanceEquity = 0;
    let binancePnl = 0;
    let binancePositionValue = 0;
    let bybitEquity = 0;
    let bybitPnl = 0;
    let bybitPositionValue = 0;

    for (const record of lastRecords.values()) {
      totalEquity += record.total_equity;
      totalPnl += record.total_pnl;
      totalPositionValue += record.total_position_value;
      binanceEquity += record.binance_equity;
      binancePnl += record.binance_pnl;
      binancePositionValue += record.binance_position_value;
      bybitEquity += record.bybit_equity;
      bybitPnl += record.bybit_pnl;
      bybitPositionValue += record.bybit_position_value;
    }

    let rawEquity = 0;
    for (const v of lastRaw.values()) rawEquity += v;
    peakEquity = Math.max(peakEquity, rawEquity);
    const drawdownPct = peakEquity > 0
      ? ((peakEquity - rawEquity) / peakEquity) * 100
      : 0;

    result.push({
      run_id: "combined",
      ts: tsToIso.get(ts) || new Date(ts).toISOString(),
      total_equity: totalEquity,
      total_pnl: totalPnl,
      total_position_value: totalPositionValue,
      binance_equity: binanceEquity,
      binance_pnl: binancePnl,
      binance_position_value: binancePositionValue,
      bybit_equity: bybitEquity,
      bybit_pnl: bybitPnl,
      bybit_position_value: bybitPositionValue,
      drawdown_pct: drawdownPct,
    });
  }

  return result;
}

/**
 * Downsample chart data if range > 3 days (to 5-minute intervals).
 * Always preserves transitions to/from 0 (boundary points).
 */
export function downsample(data: ChartDataPoint[]): ChartDataPoint[] {
  if (data.length < 2) return data;
  const rangeDays = (data[data.length - 1].time - data[0].time) / (1000 * 60 * 60 * 24);
  if (rangeDays <= 3) return data;
  const intervalMs = 5 * 60 * 1000;
  const result: ChartDataPoint[] = [];
  let lastKeptTs = 0;
  for (let i = 0; i < data.length; i++) {
    const point = data[i];
    const prevEquity = result.length > 0 ? result[result.length - 1].equity : 0;
    // Always keep points at zero-transitions (drop to 0 or rise from 0)
    const isZeroTransition =
      (point.equity === 0 && prevEquity !== 0) ||
      (point.equity !== 0 && prevEquity === 0);

    if (point.time - lastKeptTs >= intervalMs || result.length === 0 || isZeroTransition) {
      result.push(point);
      lastKeptTs = point.time;
    }
  }
  if (result[result.length - 1] !== data[data.length - 1]) {
    result.push(data[data.length - 1]);
  }
  return result;
}

/**
 * If equity data starts after rangeStart, prepend a zero-equity point.
 */
export function fillEquityGap(data: EquityCurve[], rangeStart: Date): EquityCurve[] {
  if (data.length === 0) return data;
  const earliest = new Date(data[0].ts);
  if (rangeStart >= earliest) return data;

  return [makeZeroEquity(rangeStart), ...data];
}

/**
 * Remove NAV spikes/drops caused by capital transfers.
 * When |diff| > threshold, treat as transfer and adjust all subsequent values.
 */
export function adjustNavTransfers(data: ChartDataPoint[], threshold: number): ChartDataPoint[] {
  if (data.length < 2 || threshold <= 0) return data;

  const result: ChartDataPoint[] = [data[0]];
  let cumulativeAdj = 0;

  for (let i = 1; i < data.length; i++) {
    const rawDiff = data[i].equity - data[i - 1].equity;
    if (Math.abs(rawDiff) > threshold) {
      cumulativeAdj += rawDiff;
    }
    result.push({
      time: data[i].time,
      equity: data[i].equity - cumulativeAdj,
    });
  }

  return result;
}

/**
 * Remove NAV spikes/drops from EquityCurve[] (for PerformanceStats).
 */
export function adjustEquityCurveTransfers(data: EquityCurve[], threshold: number): EquityCurve[] {
  if (data.length < 2 || threshold <= 0) return data;

  const result: EquityCurve[] = [data[0]];
  let cumulativeAdj = 0;

  for (let i = 1; i < data.length; i++) {
    const rawDiff = data[i].total_equity - data[i - 1].total_equity;
    if (Math.abs(rawDiff) > threshold) {
      cumulativeAdj += rawDiff;
    }
    result.push({
      ...data[i],
      total_equity: data[i].total_equity - cumulativeAdj,
      total_pnl: data[i].total_pnl - cumulativeAdj,
    });
  }

  // Recalculate drawdown
  let peak = 0;
  for (const point of result) {
    peak = Math.max(peak, point.total_equity);
    point.drawdown_pct = peak > 0 ? ((peak - point.total_equity) / peak) * 100 : 0;
  }

  return result;
}

function makeZeroEquity(ts: Date): EquityCurve {
  return {
    run_id: "gap",
    ts: ts.toISOString(),
    total_equity: 0,
    total_pnl: 0,
    total_position_value: 0,
    drawdown_pct: 0,
    binance_equity: 0,
    binance_pnl: 0,
    binance_position_value: 0,
    bybit_equity: 0,
    bybit_pnl: 0,
    bybit_position_value: 0,
  };
}

/**
 * Fill boundaries of the selected date range where no run is active.
 * - Before the earliest run's start_time: fill 0
 * - After the last run's end_time: forward-fill or fill 0 based on forwardFillEnd flag
 */
export function fillRangeBoundaries(
  data: EquityCurve[],
  runs: { start_time: string; end_time: string | null }[],
  rangeStart: Date,
  rangeEnd: Date,
  forwardFillEnd: boolean = false
): EquityCurve[] {
  if (data.length === 0 || runs.length === 0) return data;

  const sortedRuns = [...runs].sort(
    (a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
  );

  const result = [...data];

  // Before earliest run: fill 0
  const firstRunStart = new Date(sortedRuns[0].start_time);
  if (rangeStart.getTime() < firstRunStart.getTime()) {
    result.unshift(
      makeZeroEquity(rangeStart),
      makeZeroEquity(new Date(firstRunStart.getTime() - 1))
    );
  }

  // After last run ends
  const lastRun = sortedRuns[sortedRuns.length - 1];
  if (lastRun.end_time && result.length > 0) {
    const lastPoint = result[result.length - 1];
    const lastDataTime = new Date(lastPoint.ts).getTime();

    if (lastDataTime < rangeEnd.getTime()) {
      if (forwardFillEnd) {
        // Forward-fill: extend last equity flat to range end
        result.push({
          ...lastPoint,
          ts: rangeEnd.toISOString(),
          run_id: "bridge",
        });
      } else {
        // Sharp drop to 0 right after the last data point
        result.push(
          makeZeroEquity(new Date(lastDataTime + 1)),
          makeZeroEquity(rangeEnd)
        );
      }
    }
  }

  return result.sort(
    (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime()
  );
}
