import type { Opportunity, Exchange } from "@/lib/types/opportunity";
import { volumeKey, type VolumeEntry } from "@/lib/services/volume-fetcher";

/**
 * Screening thresholds. A null field means "don't test this", so a row is only
 * judged against criteria the user actually set.
 *
 * Shared by the table's per-row marker and the tradeable block above it — both
 * must agree on what "tradeable" means, so the rule lives here rather than in
 * either component.
 */
export interface ScreenThresholds {
  /** Pass when |basis| is at or below this, in bps. Wide gaps cost you on entry. */
  maxAbsBasisBps: number | null;
  /** Pass when BOTH legs clear this estimated daily volume, in USD. */
  minDailyVolume: number | null;
  /** Pass when the raw funding rate spread is at or above this, in bps. */
  minSpreadBps: number | null;
}

export const EMPTY_THRESHOLDS: ScreenThresholds = {
  maxAbsBasisBps: null,
  minDailyVolume: null,
  minSpreadBps: null,
};

/** Outcome of screening one row. */
export type ScreenState = "pass" | "fail" | "pending" | "off";

export interface ScreenResult {
  state: ScreenState;
  /** Human-readable list of every criterion that failed; empty when passing. */
  reasons: string[];
}

export function isScreenActive(thresholds: ScreenThresholds): boolean {
  return (
    thresholds.maxAbsBasisBps !== null ||
    thresholds.minDailyVolume !== null ||
    thresholds.minSpreadBps !== null
  );
}

/** Compact money, e.g. $1.23B / $45.6M / $789K. */
export function formatCompactUsd(value: number): string {
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `$${(value / 1e3).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

export function legVolume(
  volumes: Record<string, VolumeEntry> | undefined,
  exchange: Exchange,
  symbol: string,
): VolumeEntry | undefined {
  return volumes?.[volumeKey(exchange, symbol)];
}

export function screenOpportunity(
  opp: Opportunity,
  volumes: Record<string, VolumeEntry> | undefined,
  thresholds: ScreenThresholds,
): ScreenResult {
  if (!isScreenActive(thresholds)) return { state: "off", reasons: [] };

  const { maxAbsBasisBps, minDailyVolume, minSpreadBps } = thresholds;
  const reasons: string[] = [];
  // Volume arrives after the row does. A row we cannot judge yet is not the
  // same as one that failed, so it gets its own state instead of a plain miss.
  let pending = false;

  if (maxAbsBasisBps !== null) {
    if (opp.basis_bps === null) {
      pending = true;
      reasons.push("basis unavailable");
    } else if (Math.abs(opp.basis_bps) > maxAbsBasisBps) {
      reasons.push(`|basis| ${Math.abs(opp.basis_bps).toFixed(1)} > ${maxAbsBasisBps}`);
    }
  }

  if (minDailyVolume !== null) {
    // Both legs must clear it — an arb is only as liquid as its thinner side.
    for (const [label, exchange] of [
      ["A", opp.exchange_a],
      ["B", opp.exchange_b],
    ] as const) {
      const entry = legVolume(volumes, exchange, opp.symbol);
      if (!entry) {
        pending = true;
        reasons.push(`vol ${label} not loaded yet`);
      } else if (entry.estimatedDailyVolume < minDailyVolume) {
        reasons.push(
          `vol ${label} ${formatCompactUsd(entry.estimatedDailyVolume)} < ${formatCompactUsd(minDailyVolume)}`,
        );
      }
    }
  }

  if (minSpreadBps !== null && opp.rate_spread_bps < minSpreadBps) {
    reasons.push(`spread ${opp.rate_spread_bps.toFixed(1)} < ${minSpreadBps}`);
  }

  if (reasons.length === 0) return { state: "pass", reasons };
  return { state: pending ? "pending" : "fail", reasons };
}
