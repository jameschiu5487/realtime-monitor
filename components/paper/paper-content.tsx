"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ReferenceLine, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
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

/** A parsed jfm_observe row (numbers as numbers, plus entry notional). */
type PaperRow = Omit<PaperEpisode, "e" | "exit_vwap"> & { e: number | null; exit_vwap: number | null; notional: number | null };

/** One line on the page: a strategy, a venue and a run, each "all" or a value. */
interface Selection {
  strategy: string;
  venue: string;
  run: string;
}

const strategyOf = (r: { strategy: string | null }) => r.strategy ?? "unknown";

/** Strategies, the one that traded last first. */
function strategyOrder(rows: PaperRow[]): string[] {
  const last = new Map<string, number>();
  for (const r of rows) last.set(strategyOf(r), Math.max(last.get(strategyOf(r)) ?? 0, r.t_flat));
  return [...last.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
}

/**
 * A selection made valid against the data: a strategy, venue or run that no
 * longer fits (the strategy changed under it) falls back to "all", and the
 * venues and runs it can choose from are listed with it.
 */
function resolve(rows: PaperRow[], strategies: string[], sel: Selection) {
  const strategy = sel.strategy === "all" || strategies.includes(sel.strategy) ? sel.strategy : strategies[0] ?? "all";
  const inStrategy = rows.filter((r) => strategy === "all" || strategyOf(r) === strategy);
  // Each venue is its own paper account.
  const venues = [...new Set(inStrategy.map((r) => r.venue))].sort();
  const venue = sel.venue !== "all" && venues.includes(sel.venue) ? sel.venue : "all";
  const venueOf = new Map<string, string>();
  for (const r of inStrategy) if (venue === "all" || r.venue === venue) venueOf.set(r.run_id, r.venue);
  const runs = [...venueOf.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([id, v]) => ({ id, venue: v }));
  const run = sel.run !== "all" && venueOf.has(sel.run) ? sel.run : "all";
  return { sel: { strategy, venue, run }, venues, runs };
}

function select(rows: PaperRow[], sel: Selection, hideDup: boolean): PaperRow[] {
  return rows.filter(
    (r) =>
      (sel.strategy === "all" || strategyOf(r) === sel.strategy) &&
      (sel.venue === "all" || r.venue === sel.venue) &&
      (sel.run === "all" || r.run_id === sel.run) &&
      // Duplicates are the same episode recorded twice; counting them would double its P&L.
      (!hideDup || !r.dup)
  );
}

function selectionLabel(sel: Selection): string {
  return [
    sel.strategy === "all" ? "all strategies" : sel.strategy,
    sel.venue === "all" ? "all venues" : sel.venue,
    sel.run === "all" ? null : sel.run.replace(/^observe-/, ""),
  ]
    .filter(Boolean)
    .join(" · ");
}

function computeStats(shown: PaperRow[]) {
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
}
type PaperStats = ReturnType<typeof computeStats>;

const COMPARE_COLORS = { a: "#0ea5e9", b: "#f59e0b" } as const;

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

  // Strategy versions run different params and each venue is its own paper
  // account. Combine adds up one selection; compare puts two side by side.
  const strategies = useMemo(() => strategyOrder(rows), [rows]);
  const [mode, setMode] = useState<"combine" | "compare">("combine");
  const [hideDup, setHideDup] = useState(true);
  const [combineSel, setCombineSel] = useState<Selection | null>(null);
  const [selA, setSelA] = useState<Selection | null>(null);
  const [selB, setSelB] = useState<Selection | null>(null);
  // Defaults: the newest strategy; to compare, its first two venues if it has
  // two, else it against the previous strategy.
  const defaults = useMemo(() => {
    const newest = strategies[0] ?? "all";
    const venues = resolve(rows, strategies, { strategy: newest, venue: "all", run: "all" }).venues;
    const a: Selection = { strategy: newest, venue: venues[0] ?? "all", run: "all" };
    const b: Selection =
      venues.length > 1
        ? { strategy: newest, venue: venues[1], run: "all" }
        : { strategy: strategies[1] ?? newest, venue: "all", run: "all" };
    return { combine: { strategy: newest, venue: "all", run: "all" }, a, b };
  }, [rows, strategies]);
  const combine = useMemo(() => resolve(rows, strategies, combineSel ?? defaults.combine), [rows, strategies, combineSel, defaults]);
  const lineA = useMemo(() => resolve(rows, strategies, selA ?? defaults.a), [rows, strategies, selA, defaults]);
  const lineB = useMemo(() => resolve(rows, strategies, selB ?? defaults.b), [rows, strategies, selB, defaults]);

  const shown = useMemo(() => select(rows, combine.sel, hideDup), [rows, combine.sel, hideDup]);
  const stats = useMemo(() => computeStats(shown), [shown]);
  const statsA = useMemo(() => computeStats(select(rows, lineA.sel, hideDup)), [rows, lineA.sel, hideDup]);
  const statsB = useMemo(() => computeStats(select(rows, lineB.sel, hideDup)), [rows, lineB.sel, hideDup]);

  // Both curves on one timeline, each carried forward between its own trades.
  const compareCurve = useMemo(() => {
    const at = (st: PaperStats) => new Map(st.curve.map((p) => [p.ts, p]));
    const ma = at(statsA);
    const mb = at(statsB);
    let ca = 0;
    let cb = 0;
    return [...new Set([...ma.keys(), ...mb.keys()])]
      .sort((x, y) => x - y)
      .map((ts) => {
        ca = ma.get(ts)?.cum ?? ca;
        cb = mb.get(ts)?.cum ?? cb;
        return { ts, a: ca, b: cb, aPct: (100 * ca) / INITIAL_CAPITAL, bPct: (100 * cb) / INITIAL_CAPITAL };
      });
  }, [statsA, statsB]);
  const compareDaily = useMemo(() => {
    const days = new Map<string, { day: string; a: number; b: number }>();
    for (const d of statsA.daily) days.set(d.day, { day: d.day, a: d.pnl, b: 0 });
    for (const d of statsB.daily) days.set(d.day, { ...(days.get(d.day) ?? { day: d.day, a: 0, b: 0 }), b: d.pnl });
    return [...days.values()].sort((x, y) => x.day.localeCompare(y.day));
  }, [statsA, statsB]);

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
        {(["combine", "compare"] as const).map((m) => (
          <Button key={m} size="sm" variant={m === mode ? "default" : "outline"} className="h-7 px-3 text-xs" onClick={() => setMode(m)}>
            {m === "combine" ? "Combine" : "Compare"}
          </Button>
        ))}
        <Button size="sm" variant={hideDup ? "default" : "outline"} className="ml-2 h-7 px-2 text-xs" onClick={() => setHideDup((v) => !v)}>
          {hideDup ? "Duplicates hidden" : "Duplicates shown"}
        </Button>
      </div>

      {mode === "combine" ? (
        <SelectionPicker strategies={strategies} resolved={combine} onChange={setCombineSel} />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          <Card>
            <CardContent className="space-y-1 p-3">
              <div className="text-xs font-semibold" style={{ color: COMPARE_COLORS.a }}>A</div>
              <SelectionPicker strategies={strategies} resolved={lineA} onChange={setSelA} />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="space-y-1 p-3">
              <div className="text-xs font-semibold" style={{ color: COMPARE_COLORS.b }}>B</div>
              <SelectionPicker strategies={strategies} resolved={lineB} onChange={setSelB} />
            </CardContent>
          </Card>
        </div>
      )}

      {mode === "compare" && (
        <Card>
          <CardContent className="overflow-x-auto p-3">
            <table className="w-full font-mono text-xs">
              <thead className="text-muted-foreground">
                <tr className="border-b">
                  {["", "Return", "Total PnL (U)", "Trades", "Win rate", "Per trade (U)", "Fees (U)", "Max DD", "Volume (U)"].map((h, i) => (
                    <th key={h} className={cn("whitespace-nowrap px-2 py-1.5 font-medium", i === 0 ? "text-left" : "text-right")}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {([["A", lineA.sel, statsA], ["B", lineB.sel, statsB]] as const).map(([k, sel, st]) => (
                  <tr key={k} className="border-b last:border-0">
                    <td className="whitespace-nowrap px-2 py-1.5 font-sans">
                      <span className="font-semibold" style={{ color: COMPARE_COLORS[k === "A" ? "a" : "b"] }}>{k}</span> {selectionLabel(sel)}
                    </td>
                    <td className={cn("px-2 py-1.5 text-right", tone(st.total))}>{pctOf(st.total)}</td>
                    <td className={cn("px-2 py-1.5 text-right", tone(st.total))}>{usd(st.total)}</td>
                    <td className="px-2 py-1.5 text-right">{st.n}</td>
                    <td className="px-2 py-1.5 text-right">{st.winRate == null ? "—" : `${(st.winRate * 100).toFixed(1)}%`}</td>
                    <td className={cn("px-2 py-1.5 text-right", tone(st.perTrade))}>{usd(st.perTrade, 3)}</td>
                    <td className="px-2 py-1.5 text-right">{usd(st.fees)}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right">{st.maxDd.toFixed(2)} U · {((100 * st.maxDd) / INITIAL_CAPITAL).toFixed(2)}%</td>
                    <td className="px-2 py-1.5 text-right">{Math.round(st.notional).toLocaleString("en-US")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {mode === "combine" && (
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
      )}

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
          {mode === "compare" ? (
            compareCurve.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No episodes.</p>
            ) : (
              <ChartContainer
                config={{
                  [unit === "pct" ? "aPct" : "a"]: { label: `A ${selectionLabel(lineA.sel)}`, color: COMPARE_COLORS.a },
                  [unit === "pct" ? "bPct" : "b"]: { label: `B ${selectionLabel(lineB.sel)}`, color: COMPARE_COLORS.b },
                }}
                className="aspect-auto h-[260px] w-full"
              >
                <LineChart data={compareCurve} margin={{ left: 4, right: 4, top: 8 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="ts" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={fmt} tickLine={false} axisLine={false} minTickGap={40} className="text-xs" />
                  <YAxis tickLine={false} axisLine={false} width={48} className="text-xs" tickFormatter={(v: number) => (unit === "pct" ? `${v.toFixed(2)}%` : `${v}`)} />
                  <ReferenceLine y={0} stroke="currentColor" opacity={0.3} />
                  <ChartTooltip content={<ChartTooltipContent labelFormatter={(_, p) => fmt(Number(p?.[0]?.payload?.ts))} />} />
                  <ChartLegend content={<ChartLegendContent className="flex-wrap" />} />
                  {(["a", "b"] as const).map((k) => (
                    <Line
                      key={k}
                      dataKey={unit === "pct" ? `${k}Pct` : k}
                      type="stepAfter"
                      stroke={COMPARE_COLORS[k]}
                      strokeWidth={2}
                      dot={false}
                      isAnimationActive={false}
                    />
                  ))}
                </LineChart>
              </ChartContainer>
            )
          ) : stats.curve.length === 0 ? (
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
            {mode === "compare" ? (
              <ChartContainer
                config={{ a: { label: "A (U)", color: COMPARE_COLORS.a }, b: { label: "B (U)", color: COMPARE_COLORS.b } }}
                className="aspect-auto h-[200px] w-full"
              >
                <BarChart data={compareDaily} margin={{ left: 4, right: 4, top: 8 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="day" tickFormatter={(d: string) => d.slice(5)} tickLine={false} axisLine={false} className="text-xs" />
                  <YAxis tickLine={false} axisLine={false} width={40} className="text-xs" />
                  <ReferenceLine y={0} stroke="currentColor" opacity={0.3} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <ChartLegend content={<ChartLegendContent />} />
                  <Bar dataKey="a" fill={COMPARE_COLORS.a} radius={2} isAnimationActive={false} />
                  <Bar dataKey="b" fill={COMPARE_COLORS.b} radius={2} isAnimationActive={false} />
                </BarChart>
              </ChartContainer>
            ) : (
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
            )}
          </CardContent>
        </Card>
        {mode === "combine" && (
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
        )}
      </div>

      {mode === "combine" && (
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
      )}
    </div>
  );
}

/** Strategy / venue / run buttons for one selection. */
function SelectionPicker({
  strategies,
  resolved,
  onChange,
}: {
  strategies: string[];
  resolved: ReturnType<typeof resolve>;
  onChange: (sel: Selection) => void;
}) {
  const { sel, venues, runs } = resolved;
  const row = (label: string, items: { key: string; text: string }[], current: string, pick: (k: string) => void) => (
    <div className="flex flex-wrap items-center gap-1">
      <span className="w-14 text-xs text-muted-foreground">{label}</span>
      {items.map((it) => (
        <Button key={it.key} size="sm" variant={it.key === current ? "default" : "outline"} className="h-7 px-2 text-xs" onClick={() => pick(it.key)}>
          {it.text}
        </Button>
      ))}
    </div>
  );
  return (
    <div className="space-y-1">
      {row(
        "Strategy",
        [...strategies.map((k) => ({ key: k, text: k })), { key: "all", text: "All strategies" }],
        sel.strategy,
        (k) => onChange({ strategy: k, venue: "all", run: "all" })
      )}
      {row(
        "Venue",
        [{ key: "all", text: "All venues" }, ...venues.map((v) => ({ key: v, text: v }))],
        sel.venue,
        (v) => onChange({ ...sel, venue: v, run: "all" })
      )}
      {row(
        "Run",
        [{ key: "all", text: "All runs" }, ...runs.map((r) => ({ key: r.id, text: `${r.id.replace(/^observe-/, "")} · ${r.venue}` }))],
        sel.run,
        (r) => onChange({ ...sel, run: r })
      )}
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
