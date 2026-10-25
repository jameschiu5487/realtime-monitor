"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ReferenceLine, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { cn } from "@/lib/utils";
import { formatDateTime, taipeiDayKey, TZ_LABEL } from "@/lib/time";

/** One jfm_observe row: a finished jump-fade episode with simulated fills. PnL in USDT, combined_trades signs. */
export interface PaperEpisode {
  run_id: string;
  /** Strategy version (jump_fade_maker_v1, _v2, …); params differ between them. */
  strategy: string | null;
  episode_id: string;
  venue: string;
  symbol: string;
  side: string | null;
  /** Signal time, epoch ms. */
  t_sig: number;
  /** Entry price. */
  e: number | null;
  qty_filled: number;
  qty_kept: number;
  fill_minute: number | null;
  exit_reason: string | null;
  exit_vwap: number | null;
  /** Flat time, epoch ms. */
  t_flat: number;
  dup: boolean;
  roundtrip: boolean;
  straggler: boolean;
  flat_reason: string;
  price_pnl: number;
  commission_fee: number;
  total_pnl: number;
}

const AUTO_REFRESH_MS = 5 * 60 * 1000;
/** Observe mode's paper account size (user, 2026-10-21); returns are PnL over this. */
const INITIAL_CAPITAL = 10_000;
const POS = "#34d399";
const NEG = "#f87171";

const usd = (v: number | null | undefined, d = 2) =>
  v == null || !Number.isFinite(v) ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(d)}`;
const tone = (v: number | null | undefined) =>
  v == null ? "text-muted-foreground" : v > 0 ? "text-emerald-500" : v < 0 ? "text-red-500" : "";
const pctOf = (v: number, d = 2) => `${v > 0 ? "+" : ""}${((100 * v) / INITIAL_CAPITAL).toFixed(d)}%`;
const fmt = (ms: number) => formatDateTime(ms, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });

export function PaperContent({ episodes, error }: { episodes: PaperEpisode[]; error: string | null }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => router.refresh(), AUTO_REFRESH_MS);
    return () => clearInterval(id);
  }, [router]);

  // Numeric columns come back from PostgREST as strings.
  const rows = useMemo(
    () =>
      episodes.map((r) => ({
        ...r,
        t_sig: Number(r.t_sig),
        t_flat: Number(r.t_flat),
        fill_minute: r.fill_minute == null ? null : Number(r.fill_minute),
        e: r.e == null ? null : Number(r.e),
        exit_vwap: r.exit_vwap == null ? null : Number(r.exit_vwap),
        qty_kept: Number(r.qty_kept),
        // Entry notional of what was kept.
        notional: r.e == null ? null : Math.abs(Number(r.qty_kept) * Number(r.e)),
        price_pnl: Number(r.price_pnl),
        commission_fee: Number(r.commission_fee),
        total_pnl: Number(r.total_pnl),
      })),
    [episodes]
  );

  // Strategy versions run different params, so the page shows one at a time
  // (newest by default); runs are listed within the chosen strategy.
  const strategies = useMemo(() => {
    const last = new Map<string, number>();
    for (const r of rows) {
      const k = r.strategy ?? "unknown";
      last.set(k, Math.max(last.get(k) ?? 0, r.t_flat));
    }
    return [...last.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  }, [rows]);
  const [pickedStrategy, setPickedStrategy] = useState<string | null>(null);
  const strategy = pickedStrategy && (pickedStrategy === "all" || strategies.includes(pickedStrategy)) ? pickedStrategy : strategies[0] ?? "all";
  const inStrategy = useCallback(
    (r: { strategy: string | null }) => strategy === "all" || (r.strategy ?? "unknown") === strategy,
    [strategy]
  );
  const runs = useMemo(() => {
    const venueOf = new Map<string, string>();
    for (const r of rows) if (inStrategy(r)) venueOf.set(r.run_id, r.venue);
    return [...venueOf.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([id, venue]) => ({ id, venue }));
  }, [rows, inStrategy]);
  const [pickedRun, setPickedRun] = useState<string>("all");
  // A run from another strategy falls back to all runs of this one.
  const run = pickedRun !== "all" && runs.some((r) => r.id === pickedRun) ? pickedRun : "all";
  // Duplicates are the same episode recorded twice; counting them would double its P&L.
  const [hideDup, setHideDup] = useState(true);
  const shown = useMemo(
    () => rows.filter((r) => inStrategy(r) && (run === "all" || r.run_id === run) && (!hideDup || !r.dup)),
    [rows, inStrategy, run, hideDup]
  );

  const stats = useMemo(() => {
    const n = shown.length;
    const total = shown.reduce((a, r) => a + r.total_pnl, 0);
    const fees = shown.reduce((a, r) => a + r.commission_fee, 0);
    const wins = shown.filter((r) => r.total_pnl > 0).length;
    let cum = 0;
    let peak = 0;
    let maxDd = 0;
    const curve = [...shown]
      .sort((a, b) => a.t_flat - b.t_flat)
      .map((r) => {
        cum += r.total_pnl;
        peak = Math.max(peak, cum);
        maxDd = Math.max(maxDd, peak - cum);
        return { ts: r.t_flat, cum, pct: (100 * cum) / INITIAL_CAPITAL };
      });
    const byDay = new Map<string, number>();
    for (const r of shown) byDay.set(taipeiDayKey(r.t_flat), (byDay.get(taipeiDayKey(r.t_flat)) ?? 0) + r.total_pnl);
    const daily = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([day, pnl]) => ({ day, pnl }));
    const byReason = new Map<string, { n: number; pnl: number }>();
    for (const r of shown) {
      const k = r.exit_reason ?? r.flat_reason;
      const e = byReason.get(k) ?? { n: 0, pnl: 0 };
      e.n++;
      e.pnl += r.total_pnl;
      byReason.set(k, e);
    }
    const notional = shown.reduce((a, r) => a + (r.notional ?? 0), 0);
    return { n, total, fees, notional, winRate: n ? wins / n : null, perTrade: n ? total / n : null, maxDd, curve, daily, byReason: [...byReason.entries()] };
  }, [shown]);

  const [unit, setUnit] = useState<"usd" | "pct">("pct");
  const table = useMemo(() => [...shown].sort((a, b) => b.t_flat - a.t_flat), [shown]);

  return (
    <div className="space-y-4 sm:space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Paper</h1>
        <p className="text-sm text-muted-foreground">
          Jump-fade observe mode (jfm_observe): finished episodes with simulated fills. Times {TZ_LABEL}.
        </p>
      </div>

      {error && <p className="text-sm text-red-500">Failed to load jfm_observe: {error}</p>}

      <div className="flex flex-wrap items-center gap-1">
        <span className="w-14 text-xs text-muted-foreground">Strategy</span>
        {[...strategies, "all"].map((k) => (
          <Button key={k} size="sm" variant={k === strategy ? "default" : "outline"} className="h-7 px-2 text-xs" onClick={() => setPickedStrategy(k)}>
            {k === "all" ? "All strategies" : k}
          </Button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-1">
        <span className="w-14 text-xs text-muted-foreground">Run</span>
        {[{ id: "all", venue: "" }, ...runs].map((r) => (
          <Button key={r.id} size="sm" variant={r.id === run ? "default" : "outline"} className="h-7 px-2 text-xs" onClick={() => setPickedRun(r.id)}>
            {r.id === "all" ? "All runs" : `${r.id.replace(/^observe-/, "")} · ${r.venue}`}
          </Button>
        ))}
        <Button size="sm" variant={hideDup ? "default" : "outline"} className="ml-2 h-7 px-2 text-xs" onClick={() => setHideDup((v) => !v)}>
          {hideDup ? "Duplicates hidden" : "Duplicates shown"}
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
        <Stat label={`Return (on ${INITIAL_CAPITAL.toLocaleString("en-US")} U)`} value={pctOf(stats.total)} className={tone(stats.total)} />
        <Stat label="Total PnL (U)" value={usd(stats.total)} className={tone(stats.total)} />
        <Stat label="Trades" value={String(stats.n)} />
        <Stat label="Win rate" value={stats.winRate == null ? "—" : `${(stats.winRate * 100).toFixed(1)}%`} />
        <Stat label="Per trade (U)" value={usd(stats.perTrade, 3)} className={tone(stats.perTrade)} />
        <Stat label="Fees (U)" value={usd(stats.fees)} />
        <Stat label="Max DD" value={`${stats.maxDd.toFixed(2)} U · ${((100 * stats.maxDd) / INITIAL_CAPITAL).toFixed(2)}%`} />
        <Stat label="Volume (entry notional, U)" value={Math.round(stats.notional).toLocaleString("en-US")} />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Cumulative PnL</CardTitle>
          <CardDescription className="text-xs">
            After fees, in flat-time order; % is of the {INITIAL_CAPITAL.toLocaleString("en-US")} U initial capital.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 px-2 sm:px-6">
          <div className="flex gap-1">
            {(["pct", "usd"] as const).map((u) => (
              <Button key={u} size="sm" variant={u === unit ? "default" : "outline"} className="h-7 px-2 text-xs" onClick={() => setUnit(u)}>
                {u === "pct" ? "Return %" : "USDT"}
              </Button>
            ))}
          </div>
          {stats.curve.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No episodes.</p>
          ) : (
            <ChartContainer
              config={{
                cum: { label: "Cumulative PnL (U)", color: "#0ea5e9" },
                pct: { label: "Return (%)", color: "#0ea5e9" },
              }}
              className="aspect-auto h-[260px] w-full"
            >
              <LineChart data={stats.curve} margin={{ left: 4, right: 4, top: 8 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="ts" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={fmt} tickLine={false} axisLine={false} minTickGap={40} className="text-xs" />
                <YAxis tickLine={false} axisLine={false} width={48} className="text-xs" tickFormatter={(v: number) => (unit === "pct" ? `${v.toFixed(2)}%` : `${v}`)} />
                <ReferenceLine y={0} stroke="currentColor" opacity={0.3} />
                <ChartTooltip content={<ChartTooltipContent labelFormatter={(_, p) => fmt(Number(p?.[0]?.payload?.ts))} />} />
                <Line dataKey={unit === "pct" ? "pct" : "cum"} type="stepAfter" stroke="#0ea5e9" strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Daily PnL</CardTitle>
            <CardDescription className="text-xs">By flat time, {TZ_LABEL} days.</CardDescription>
          </CardHeader>
          <CardContent className="px-2 sm:px-6">
            <ChartContainer config={{ pnl: { label: "PnL (U)", color: POS } }} className="aspect-auto h-[200px] w-full">
              <BarChart data={stats.daily} margin={{ left: 4, right: 4, top: 8 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="day" tickFormatter={(d: string) => d.slice(5)} tickLine={false} axisLine={false} className="text-xs" />
                <YAxis tickLine={false} axisLine={false} width={40} className="text-xs" />
                <ReferenceLine y={0} stroke="currentColor" opacity={0.3} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="pnl" radius={2} isAnimationActive={false}>
                  {stats.daily.map((d) => (
                    <Cell key={d.day} fill={d.pnl >= 0 ? POS : NEG} />
                  ))}
                </Bar>
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">By exit reason</CardTitle>
          </CardHeader>
          <CardContent>
            <table className="w-full font-mono text-xs">
              <thead className="text-muted-foreground">
                <tr className="border-b">
                  <th className="px-2 py-1.5 text-left font-medium">Reason</th>
                  <th className="px-2 py-1.5 text-right font-medium">Trades</th>
                  <th className="px-2 py-1.5 text-right font-medium">PnL (U)</th>
                  <th className="px-2 py-1.5 text-right font-medium">Per trade</th>
                </tr>
              </thead>
              <tbody>
                {stats.byReason.map(([k, v]) => (
                  <tr key={k} className="border-b last:border-0">
                    <td className="px-2 py-1.5 font-sans">{k}</td>
                    <td className="px-2 py-1.5 text-right">{v.n}</td>
                    <td className={cn("px-2 py-1.5 text-right", tone(v.pnl))}>{usd(v.pnl)}</td>
                    <td className={cn("px-2 py-1.5 text-right", tone(v.pnl))}>{usd(v.pnl / v.n, 3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Trades</CardTitle>
          <CardDescription className="text-xs">{table.length} episodes, newest first.</CardDescription>
        </CardHeader>
        <CardContent className="px-2 sm:px-6">
          <div className="max-h-[480px] overflow-auto rounded-md border">
            <table className="w-full font-mono text-xs">
              <thead className="sticky top-0 z-10 bg-card text-muted-foreground">
                <tr className="border-b">
                  {["Signal", "Flat", "Symbol", "Side", "Entry", "Exit", "Qty", "Notional (U)", "Exit reason", "Price PnL", "Fee", "Total PnL", "Return on notional"].map((h, i) => (
                    <th key={h} className={cn("whitespace-nowrap px-2 py-1.5 font-medium", i < 4 || i === 8 ? "text-left" : "text-right")}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.map((r) => (
                  <tr key={`${r.run_id}|${r.episode_id}|${r.t_flat}`} className="border-b last:border-0">
                    <td className="whitespace-nowrap px-2 py-1.5">{fmt(r.t_sig)}</td>
                    <td className="whitespace-nowrap px-2 py-1.5">{fmt(r.t_flat)}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 font-sans">
                      {r.symbol}
                      {r.dup && <span className="text-amber-500"> · dup</span>}
                      {r.straggler && <span className="text-amber-500"> · straggler</span>}
                    </td>
                    <td className={cn("px-2 py-1.5 font-sans", r.side === "long" ? "text-emerald-500" : r.side === "short" ? "text-red-500" : "")}>{r.side ?? "—"}</td>
                    <td className="px-2 py-1.5 text-right">{r.e ?? "—"}</td>
                    <td className="px-2 py-1.5 text-right">{r.exit_vwap ?? "—"}</td>
                    <td className="px-2 py-1.5 text-right">{r.qty_kept}</td>
                    <td className="px-2 py-1.5 text-right">{r.notional == null ? "—" : r.notional.toFixed(2)}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 font-sans">{r.exit_reason ?? r.flat_reason}</td>
                    <td className={cn("px-2 py-1.5 text-right", tone(r.price_pnl))}>{usd(r.price_pnl, 3)}</td>
                    <td className="px-2 py-1.5 text-right">{usd(r.commission_fee, 3)}</td>
                    <td className={cn("px-2 py-1.5 text-right font-semibold", tone(r.total_pnl))}>{usd(r.total_pnl, 3)}</td>
                    <td className={cn("px-2 py-1.5 text-right", tone(r.total_pnl))}>
                      {r.notional ? `${usd((1e4 * r.total_pnl) / r.notional, 1)} bp` : "—"}
                    </td>
                  </tr>
                ))}
                {table.length === 0 && (
                  <tr>
                    <td colSpan={13} className="py-6 text-center text-muted-foreground">No episodes.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className={cn("font-mono text-lg font-bold", className)}>{value}</div>
        <div className="text-[11px] text-muted-foreground">{label}</div>
      </CardContent>
    </Card>
  );
}
