import type { SupabaseClient } from "@supabase/supabase-js";
import { taipeiMidnightMs } from "@/lib/time";

/**
 * A shareholder's share of every amount the app shows, over time
 * (table shareholder_shares, decided 2026-11-03). One ratio per user for every
 * strategy; it changes only when a row is added in the Supabase table editor,
 * effective from its effective_from instant (timestamptz; enter it as Taipei
 * time, e.g. 2026-11-03 02:32+08) until the user's next row.
 *
 * Visibility is separate: user_strategy_access still decides who sees which
 * strategy. This module only says how much of an amount they see.
 *
 * How a time-varying ratio applies depends on what the number is:
 * - a level (equity, position value, open position size, capital) takes the
 *   ratio in effect at its own time — `scaleLevel`;
 * - a cumulative flow stored as a level (pnl_series.total_*,
 *   equity_curve.total_pnl) is split into increments, each scaled at its own
 *   time and re-summed — `scaleCumulative` — so a ratio change is not read as
 *   profit or loss;
 * - a single flow (a trade's PnL, a fill's notional) takes the ratio at its time.
 * Percentages (return, drawdown, Sharpe) are computed from unscaled data: a
 * ratio change is a change of ownership, not performance.
 */

export interface SharePeriod {
  /** Epoch ms the ratio takes effect (effective_from). */
  fromMs: number;
  ratio: number;
}

/** Periods sorted by fromMs. Plain data, so it passes from server to client components. */
export type ShareSchedule = SharePeriod[];

/** A schedule with one ratio for all time — admins, and the "no scaling" case. */
export function constantShare(ratio = 1): ShareSchedule {
  return [{ fromMs: 0, ratio }];
}

const toMs = (t: number | string | Date) => (typeof t === "number" ? t : new Date(t).getTime());

/**
 * The ratio in effect at `t`. Before the first period the first ratio applies;
 * with no periods at all the user sees full amounts (1) — every user has a
 * backfilled row from 2000-01-01, so a new shareholder needs one added.
 */
export function ratioAt(schedule: ShareSchedule, t: number | string | Date): number {
  if (schedule.length === 0) return 1;
  const ms = toMs(t);
  let ratio = schedule[0].ratio;
  for (const p of schedule) {
    if (p.fromMs > ms) break;
    ratio = p.ratio;
  }
  return ratio;
}

/** The ratio in effect now. */
export const currentRatio = (schedule: ShareSchedule) => ratioAt(schedule, Date.now());

/** True when the ratio never changes, so callers can skip per-point work. */
export function isConstantShare(schedule: ShareSchedule): boolean {
  return schedule.every((p) => p.ratio === (schedule[0]?.ratio ?? 1));
}

/** A level at time `t`: multiply by the ratio then in effect. */
export function scaleLevel(value: number, t: number | string | Date, schedule: ShareSchedule): number {
  return value * ratioAt(schedule, t);
}

/**
 * Cumulative series (sorted by time): each increment is scaled by the ratio at
 * its own point and re-summed; the first point is scaled by the ratio at its
 * time. With a constant ratio this is exactly value × ratio.
 */
export function scaleCumulative<T>(
  points: T[],
  timeOf: (p: T) => number | string | Date,
  fields: (keyof T)[],
  schedule: ShareSchedule
): T[] {
  if (isConstantShare(schedule)) {
    const r = schedule[0]?.ratio ?? 1;
    return points.map((p) => {
      const out = { ...p };
      for (const f of fields) (out[f] as unknown as number) = Number(p[f] ?? 0) * r;
      return out;
    });
  }
  const prevRaw = new Map<keyof T, number>();
  const prevScaled = new Map<keyof T, number>();
  return points.map((p) => {
    const r = ratioAt(schedule, timeOf(p));
    const out = { ...p };
    for (const f of fields) {
      const raw = Number(p[f] ?? 0);
      const scaled = prevRaw.has(f) ? (prevScaled.get(f) as number) + (raw - (prevRaw.get(f) as number)) * r : raw * r;
      prevRaw.set(f, raw);
      prevScaled.set(f, scaled);
      (out[f] as unknown as number) = scaled;
    }
    return out;
  });
}

type ShareRow = { effective_from: string; share_ratio: number | string };

/**
 * effective_from is a timestamptz since 2026-11-03 (a ratio can change at the
 * minute money moved). A bare date — the column's earlier type — still reads
 * as Taipei midnight.
 */
function effectiveMs(value: string): number {
  const day = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (day) return taipeiMidnightMs(Number(day[1]), Number(day[2]), Number(day[3]));
  return Date.parse(value);
}

function toSchedule(rows: ShareRow[]): ShareSchedule {
  return rows
    .map((r) => ({ fromMs: effectiveMs(r.effective_from), ratio: Number(r.share_ratio) }))
    .filter((p) => Number.isFinite(p.fromMs) && Number.isFinite(p.ratio))
    .sort((a, b) => a.fromMs - b.fromMs);
}

/**
 * The signed-in user's schedule. RLS returns only their own rows. A read error
 * falls back to full amounts and is logged, like a user with no rows.
 */
export async function loadShareSchedule(supabase: SupabaseClient, userId: string | null | undefined): Promise<ShareSchedule> {
  if (!userId) return constantShare(1);
  const { data, error } = await supabase
    .from("shareholder_shares")
    .select("effective_from, share_ratio")
    .eq("user_id", userId)
    .order("effective_from", { ascending: true });
  if (error) {
    console.error("[share] shareholder_shares:", error);
    return constantShare(1);
  }
  const schedule = toSchedule((data ?? []) as ShareRow[]);
  return schedule.length ? schedule : constantShare(1);
}

/** Schedules for several users at once (push notifications; needs the service-role client). */
export async function loadShareSchedules(
  admin: SupabaseClient,
  userIds: string[]
): Promise<Map<string, ShareSchedule>> {
  const out = new Map<string, ShareSchedule>();
  if (userIds.length === 0) return out;
  const { data, error } = await admin
    .from("shareholder_shares")
    .select("user_id, effective_from, share_ratio")
    .in("user_id", userIds);
  if (error) console.error("[share] shareholder_shares:", error);
  const byUser = new Map<string, ShareRow[]>();
  for (const r of (data ?? []) as (ShareRow & { user_id: string })[]) {
    const list = byUser.get(r.user_id) ?? [];
    list.push(r);
    byUser.set(r.user_id, list);
  }
  for (const id of userIds) {
    const s = toSchedule(byUser.get(id) ?? []);
    out.set(id, s.length ? s : constantShare(1));
  }
  return out;
}
