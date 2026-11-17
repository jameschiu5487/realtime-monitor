"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { currentRatio, scaleCumulative, type ShareSchedule } from "@/lib/share";
import { TZ_LABEL } from "@/lib/time";
import type { EquityCurve, FundAccountEquity } from "@/lib/types/database";

interface DailyStrategy {
  strategyId: string;
  strategyName: string;
  allRunIds: string[];
  mode: string;
}

interface DailyParent {
  strategyId: string;
  strategyName: string;
  accountIds: string[];
}

interface DailyRow {
  id: string;
  name: string;
  mode: string;
  /** Viewer's share, USDT. */
  pnl: number;
  /** Of the equity at the day's start, unscaled. */
  pct: number | null;
  /** Parents: account equity change, so transfers count too. */
  fromAccount: boolean;
}

const time = (ts: string) => new Date(ts).getTime();

/**
 * A strategy's PnL since Taipei midnight, from its runs' cumulative total_pnl:
 * per run, the last point minus the baseline — the last point before midnight,
 * or the run's first point if it started today. total_pnl is a cumulative flow,
 * so it is scaled increment by increment (lib/share.ts), and a deposit or a
 * restart at another capital is not read as profit. Engines that reset
 * total_pnl on restart and those that carry it over both work, because each
 * run is measured from its own baseline.
 */
function strategyDayPnl(series: EquityCurve[][], dayStart: number, share: ShareSchedule) {
  let pnl = 0;
  let raw = 0;
  let base = 0;
  let traded = false;
  for (const run of series) {
    const today = run.filter((p) => time(p.ts) >= dayStart);
    if (today.length === 0) continue;
    traded = true;
    const scaled = scaleCumulative(run, (p) => p.ts, ["total_pnl"], share);
    const before = run.findLastIndex((p) => time(p.ts) < dayStart);
    const b = before >= 0 ? before : run.indexOf(today[0]);
    const last = run.length - 1;
    pnl += scaled[last].total_pnl - scaled[b].total_pnl;
    raw += Number(run[last].total_pnl) - Number(run[b].total_pnl);
    base += Number(run[b].total_equity);
  }
  return traded ? { pnl, pct: base > 0 ? (raw / base) * 100 : null } : null;
}

/** A parent's account equity change since midnight (includes transfers), at today's ratio. */
function accountDayPnl(rows: FundAccountEquity[], accountIds: string[], dayStart: number, share: ShareSchedule) {
  let delta = 0;
  let base = 0;
  let seen = false;
  for (const id of accountIds) {
    const own = rows.filter((r) => r.account_id === id).sort((a, b) => time(a.ts) - time(b.ts));
    if (own.length === 0) continue;
    const before = own.findLast((r) => time(r.ts) < dayStart) ?? own[0];
    const last = own[own.length - 1];
    delta += Number(last.total_equity) - Number(before.total_equity);
    base += Number(before.total_equity);
    seen = true;
  }
  return seen ? { pnl: delta * currentRatio(share), pct: base > 0 ? (delta / base) * 100 : null } : null;
}

const money = (v: number) =>
  `${v > 0 ? "+" : v < 0 ? "−" : ""}$${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const tone = (v: number) => (v > 0 ? "text-emerald-500" : v < 0 ? "text-red-500" : "text-muted-foreground");

/** Today's PnL (since 00:00 Taipei) for every running strategy, plus parents' accounts. */
export function DailyStrategyPnl({
  strategies,
  parents,
  equityData,
  fundRows,
  share,
  dayStartMs,
}: {
  strategies: DailyStrategy[];
  parents: DailyParent[];
  equityData: EquityCurve[];
  fundRows: FundAccountEquity[] | null;
  share: ShareSchedule;
  dayStartMs: number;
}) {
  const rows = useMemo(() => {
    const byRun = new Map<string, EquityCurve[]>();
    for (const p of equityData) {
      const list = byRun.get(p.run_id) ?? [];
      list.push(p);
      byRun.set(p.run_id, list);
    }
    for (const list of byRun.values()) list.sort((a, b) => time(a.ts) - time(b.ts));

    const out: DailyRow[] = [];
    for (const s of strategies) {
      const series = s.allRunIds.map((id) => byRun.get(id) ?? []).filter((r) => r.length > 0);
      const day = strategyDayPnl(series, dayStartMs, share);
      out.push({ id: s.strategyId, name: s.strategyName, mode: s.mode, pnl: day?.pnl ?? 0, pct: day?.pct ?? null, fromAccount: false });
    }
    if (fundRows) {
      for (const p of parents) {
        const day = accountDayPnl(fundRows, p.accountIds, dayStartMs, share);
        if (day) out.push({ id: p.strategyId, name: p.strategyName, mode: "live", ...day, fromAccount: true });
      }
    }
    return out.sort((a, b) => b.pnl - a.pnl);
  }, [strategies, parents, equityData, fundRows, share, dayStartMs]);

  if (rows.length === 0) return null;
  const total = rows.reduce((sum, r) => sum + r.pnl, 0);

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-3 sm:p-4">
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Today&apos;s PnL <span className="normal-case tracking-normal">(since 00:00 {TZ_LABEL})</span>
          </p>
          <p className={cn("font-mono text-sm font-bold tabular-nums", tone(total))}>{money(total)}</p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {rows.map((r) => (
            <Link
              key={r.id}
              href={`/strategies/${r.id}`}
              className="rounded-md border px-2.5 py-2 transition-colors hover:bg-accent/50"
            >
              <div className="flex items-center gap-1.5">
                <span className="truncate text-xs font-medium">{r.name}</span>
                {r.mode === "test-realtime" && (
                  <span className="shrink-0 rounded bg-muted px-1 font-mono text-[10px] uppercase text-muted-foreground">test</span>
                )}
              </div>
              <div className={cn("font-mono text-base font-bold tabular-nums", tone(r.pnl))}>{money(r.pnl)}</div>
              <div className="font-mono text-[11px] text-muted-foreground tabular-nums">
                {r.pct == null ? "—" : `${r.pct > 0 ? "+" : ""}${r.pct.toFixed(2)}%`}
                {r.fromAccount && " · account Δ"}
              </div>
            </Link>
          ))}
        </div>
        {rows.some((r) => r.fromAccount) && (
          <p className="mt-2 text-[11px] text-muted-foreground">
            account Δ: a parent&apos;s real account equity change since midnight, so deposits and withdrawals show up in it.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
