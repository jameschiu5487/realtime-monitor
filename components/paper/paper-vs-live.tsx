"use client";

import { useCallback, useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { cn } from "@/lib/utils";
import { ratioAt, type ShareSchedule } from "@/lib/share";
import { formatDateTime, TZ_LABEL } from "@/lib/time";

/** One live Jump Fade Maker position (combined_trades). PnL in USDT, unscaled. */
export interface LiveJfmTrade {
  combined_trade_id: number;
  run_id: string;
  symbol: string;
  exchange: string;
  side: string;
  quantity: number | string;
  entry_price: number | string | null;
  exit_price: number | string | null;
  entry_time: string | null;
  exit_time: string | null;
  ts: string;
  exit_type: string | null;
  price_pnl: number | string | null;
  commission_fee: number | string | null;
  funding_fee_realized: number | string | null;
  total_pnl: number | string | null;
}

/** A live run's initial capital, from its start. */
export interface LiveCapital {
  fromMs: number;
  capital: number;
}

/** Live capital at `t`: the latest run started by then (before the first run, its capital). */
function capitalAt(runs: LiveCapital[], t: number): number | null {
  let c = runs[0]?.capital ?? null;
  for (const r of runs) {
    if (r.fromMs > t) break;
    c = r.capital;
  }
  return c;
}

/** The paper fields PTA needs (a parsed jfm_observe row). */
export interface PtaPaperRow {
  run_id: string;
  strategy: string | null;
  episode_id: string;
  venue: string;
  symbol: string;
  side: string | null;
  t_sig: number;
  t_flat: number;
  e: number | null;
  qty_filled: number;
  exit_vwap: number | null;
  exit_reason: string | null;
  flat_reason: string;
  notional: number | null;
  total_pnl: number;
}

/**
 * A live position and a paper episode are the same trade when symbol and side
 * agree and the paper signal is at most 10 min before / 2 min after the live
 * entry. Live entries land ~20–40 s after the signal minute (checked on
 * 2026-11-05: 171 of 220 live positions matched v2, entry prices equal).
 */
const MATCH_BEFORE_MS = 10 * 60_000;
const MATCH_AFTER_MS = 2 * 60_000;

const LIVE = "#3b82f6";
const PAPER = "#eab308";
const DIFF = "#a78bfa";

const num = (v: unknown) => (v == null || v === "" ? null : Number(v));
const signed = (v: number | null | undefined, d = 2) =>
  v == null || !Number.isFinite(v) ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(d)}`;
const tone = (v: number | null | undefined) =>
  v == null ? "text-muted-foreground" : v > 0 ? "text-emerald-500" : v < 0 ? "text-red-500" : "";
const fmt = (ms: number) => formatDateTime(ms, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });

interface LiveRow {
  id: number;
  symbol: string;
  venue: string;
  side: "long" | "short";
  entryMs: number;
  exitMs: number;
  entry: number | null;
  exit: number | null;
  exitType: string | null;
  notional: number;
  /** Viewer's share of total_pnl, at the exit time. */
  pnl: number;
  bp: number | null;
}

export function parseLive(trades: LiveJfmTrade[], share: ShareSchedule): LiveRow[] {
  return trades.map((t) => {
    const exitMs = Date.parse(t.exit_time ?? t.ts);
    const entry = num(t.entry_price);
    const raw = num(t.total_pnl) ?? 0;
    const notional = Math.abs((num(t.quantity) ?? 0) * (entry ?? 0));
    return {
      id: t.combined_trade_id,
      symbol: t.symbol,
      venue: t.exchange.toLowerCase(),
      side: t.side.toLowerCase() === "short" ? "short" : "long",
      entryMs: t.entry_time ? Date.parse(t.entry_time) : exitMs,
      exitMs,
      entry,
      exit: num(t.exit_price),
      exitType: t.exit_type,
      notional,
      pnl: raw * ratioAt(share, exitMs),
      bp: notional > 0 ? (1e4 * raw) / notional : null,
    };
  });
}

const paperBp = (p: PtaPaperRow) => (p.notional ? (1e4 * p.total_pnl) / p.notional : null);

interface Pair {
  key: string;
  live: LiveRow | null;
  paper: PtaPaperRow | null;
  /** Live entry, or the paper signal for paper-only trades. */
  t: number;
  /** Close time, for the curves. */
  closeMs: number;
}

/**
 * Pair live positions with paper episodes, each used once, nearest signal
 * first. Paper rows must already be on the live venues.
 */
function matchTrades(live: LiveRow[], paper: PtaPaperRow[]) {
  const bySym = new Map<string, PtaPaperRow[]>();
  for (const p of paper) {
    const k = `${p.venue}|${p.symbol}|${p.side}`;
    (bySym.get(k) ?? bySym.set(k, []).get(k)!).push(p);
  }
  const used = new Set<PtaPaperRow>();
  const pairs: Pair[] = [];
  for (const l of [...live].sort((a, b) => a.entryMs - b.entryMs)) {
    let best: PtaPaperRow | null = null;
    for (const p of bySym.get(`${l.venue}|${l.symbol}|${l.side}`) ?? []) {
      if (used.has(p) || p.t_sig < l.entryMs - MATCH_BEFORE_MS || p.t_sig > l.entryMs + MATCH_AFTER_MS) continue;
      if (!best || Math.abs(p.t_sig - l.entryMs) < Math.abs(best.t_sig - l.entryMs)) best = p;
    }
    if (best) used.add(best);
    pairs.push({ key: `l${l.id}`, live: l, paper: best, t: l.entryMs, closeMs: l.exitMs });
  }
  for (const p of paper) {
    if (!used.has(p)) pairs.push({ key: `p${p.run_id}|${p.episode_id}|${p.t_flat}`, live: null, paper: p, t: p.t_sig, closeMs: p.t_flat });
  }
  return pairs.sort((a, b) => b.t - a.t);
}

/** Paper strategy whose episodes match the most live positions — PTA's default. */
export function bestPaperStrategy(paper: PtaPaperRow[], live: LiveRow[]): string | null {
  const venues = new Set(live.map((l) => l.venue));
  const counts = new Map<string, number>();
  const byStrategy = new Map<string, PtaPaperRow[]>();
  for (const p of paper) {
    if (!venues.has(p.venue) || p.strategy == null) continue;
    (byStrategy.get(p.strategy) ?? byStrategy.set(p.strategy, []).get(p.strategy)!).push(p);
  }
  for (const [s, rows] of byStrategy) counts.set(s, matchTrades(live, rows).filter((x) => x.live && x.paper).length);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

/** Signed so positive = live did better than paper, in bp of the paper price. */
const gapBp = (side: "long" | "short", livePx: number | null, paperPx: number | null, isEntry: boolean) => {
  if (livePx == null || paperPx == null || paperPx === 0) return null;
  const s = side === "long" ? 1 : -1;
  return (isEntry ? -1 : 1) * s * 1e4 * ((livePx - paperPx) / paperPx);
};

function stats(items: { pnl: number; bp: number | null }[]) {
  const n = items.length;
  const total = items.reduce((a, x) => a + x.pnl, 0);
  const bpSum = items.reduce((a, x) => a + (x.bp ?? 0), 0);
  const wins = items.filter((x) => x.pnl > 0).length;
  return { n, total, bpSum, meanBp: n ? bpSum / n : null, winRate: n ? wins / n : null };
}

/**
 * PTA (paper-to-actual): the paper selection against Jump Fade Maker's live
 * positions over the hours both were running, trade by trade. Sizes differ
 * between paper and live, so the like-for-like figure is bp of entry notional;
 * paper's U is rescaled from its own account to the live run's capital at the
 * signal time (paper PnL × live capital ÷ the paper strategy's account size),
 * then the viewer's share.
 */
export function PaperVsLive({
  paper,
  live: liveRaw,
  liveCapital,
  paperCapitals,
  share,
  paperLabel,
}: {
  paper: PtaPaperRow[];
  live: LiveJfmTrade[];
  liveCapital: LiveCapital[];
  /** Paper account size per strategy (one venue). */
  paperCapitals: Map<string, number>;
  share: ShareSchedule;
  paperLabel: string;
}) {
  const liveAll = useMemo(() => parseLive(liveRaw, share), [liveRaw, share]);
  const [unit, setUnit] = useState<"bp" | "usd">("bp");
  // Paper PnL on the live account's capital at the signal, at the viewer's share.
  const paperUsd = useCallback(
    (p: PtaPaperRow) => {
      const own = paperCapitals.get(p.strategy ?? "unknown");
      const target = capitalAt(liveCapital, p.t_sig);
      return (own && target ? (p.total_pnl * target) / own : p.total_pnl) * ratioAt(share, p.t_flat);
    },
    [liveCapital, paperCapitals, share]
  );
  const paperAccounts = [...new Set(paper.map((p) => p.strategy ?? "unknown"))]
    .map((k) => `${k} ${(paperCapitals.get(k) ?? 0).toLocaleString("en-US")}`)
    .join(", ");

  const view = useMemo(() => {
    const venues = new Set(liveAll.map((l) => l.venue));
    const onVenue = paper.filter((p) => venues.has(p.venue));
    if (liveAll.length === 0 || onVenue.length === 0) return null;
    // Only the hours both ran.
    const start = Math.max(Math.min(...liveAll.map((l) => l.entryMs)), Math.min(...onVenue.map((p) => p.t_sig))) - MATCH_BEFORE_MS;
    const end = Math.min(Math.max(...liveAll.map((l) => l.entryMs)), Math.max(...onVenue.map((p) => p.t_sig))) + MATCH_AFTER_MS;
    const live = liveAll.filter((l) => l.entryMs >= start && l.entryMs <= end);
    const pap = onVenue.filter((p) => p.t_sig >= start && p.t_sig <= end);
    const pairs = matchTrades(live, pap);
    const both = pairs.filter((x) => x.live && x.paper);

    const paperItem = (p: PtaPaperRow) => ({ pnl: paperUsd(p), bp: paperBp(p) });
    const summary = [
      { label: "Live", color: LIVE, ...stats(live) },
      { label: "Paper", color: PAPER, ...stats(pap.map(paperItem)) },
      { label: "Live (matched)", color: LIVE, ...stats(both.map((x) => x.live!)) },
      { label: "Paper (matched)", color: PAPER, ...stats(both.map((x) => paperItem(x.paper!))) },
    ];
    const mean = (vals: (number | null)[]) => {
      const v = vals.filter((x): x is number => x != null && Number.isFinite(x));
      return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
    };
    const gaps = {
      entry: mean(both.map((x) => gapBp(x.live!.side, x.live!.entry, x.paper!.e, true))),
      exit: mean(both.map((x) => gapBp(x.live!.side, x.live!.exit, x.paper!.exit_vwap, false))),
      net: mean(both.map((x) => (x.live!.bp ?? 0) - (paperBp(x.paper!) ?? 0))),
    };

    // Cumulative lines, by close time. Live and paper over all their trades;
    // the diff over matched trades only.
    const events = [
      ...live.map((l) => ({ ts: l.exitMs, live: { usd: l.pnl, bp: l.bp ?? 0 }, paper: null, diff: null })),
      ...pap.map((p) => ({ ts: p.t_flat, live: null, paper: { usd: paperUsd(p), bp: paperBp(p) ?? 0 }, diff: null })),
      ...both.map((x) => ({
        ts: Math.max(x.live!.exitMs, x.paper!.t_flat),
        live: null,
        paper: null,
        diff: { usd: x.live!.pnl - paperUsd(x.paper!), bp: (x.live!.bp ?? 0) - (paperBp(x.paper!) ?? 0) },
      })),
    ].sort((a, b) => a.ts - b.ts);
    const acc = { liveUsd: 0, liveBp: 0, paperUsd: 0, paperBp: 0, diffUsd: 0, diffBp: 0 };
    const curve: ({ ts: number } & typeof acc)[] = events.length ? [{ ts: events[0].ts - 60_000, ...acc }] : [];
    for (const e of events) {
      if (e.live) {
        acc.liveUsd += e.live.usd;
        acc.liveBp += e.live.bp;
      }
      if (e.paper) {
        acc.paperUsd += e.paper.usd;
        acc.paperBp += e.paper.bp;
      }
      if (e.diff) {
        acc.diffUsd += e.diff.usd;
        acc.diffBp += e.diff.bp;
      }
      curve.push({ ts: e.ts, ...acc });
    }
    return {
      start,
      end,
      pairs,
      summary,
      gaps,
      curve,
      counts: { both: both.length, liveOnly: live.length - both.length, paperOnly: pap.length - both.length },
      venues: [...venues].join(", "),
    };
  }, [liveAll, paper, paperUsd]);

  if (liveAll.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">No live Jump Fade Maker trades (or no access to the strategy).</p>;
  }
  if (!view) {
    return <p className="py-6 text-center text-sm text-muted-foreground">The paper selection has no episodes on the live venue(s).</p>;
  }

  const k = unit === "bp" ? "Bp" : "Usd";
  return (
    <div className="space-y-4 sm:space-y-6">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Paper vs live</CardTitle>
          <CardDescription className="text-xs">
            Paper: {paperLabel}, only on the live venue ({view.venues}). Live: Jump Fade Maker, all live runs. Window {fmt(view.start)} –{" "}
            {fmt(view.end)} {TZ_LABEL}, the hours both ran. Matched = same symbol and side, paper signal within 10 min before / 2 min after
            the live entry. bp = PnL after fees ÷ entry notional. Paper U is rescaled from its account ({paperAccounts} U) to the live
            run&apos;s capital at the time (now {(capitalAt(liveCapital, Date.now()) ?? 0).toLocaleString("en-US")} U); all U are your share.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 overflow-x-auto">
          <div className="flex flex-wrap gap-4 text-xs">
            <span>Matched <b className="font-mono">{view.counts.both}</b></span>
            <span>Live only <b className="font-mono">{view.counts.liveOnly}</b></span>
            <span>Paper only <b className="font-mono">{view.counts.paperOnly}</b></span>
          </div>
          <table className="w-full font-mono text-xs">
            <thead className="text-muted-foreground">
              <tr className="border-b">
                {["", "Trades", "Total PnL (U)", "Σ bp", "Mean bp", "Win rate"].map((h, i) => (
                  <th key={h} className={cn("whitespace-nowrap px-2 py-1.5 font-medium", i === 0 ? "text-left" : "text-right")}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {view.summary.map((s) => (
                <tr key={s.label} className="border-b last:border-0">
                  <td className="whitespace-nowrap px-2 py-1.5 font-sans font-semibold" style={{ color: s.color }}>{s.label}</td>
                  <td className="px-2 py-1.5 text-right">{s.n}</td>
                  <td className={cn("px-2 py-1.5 text-right", tone(s.total))}>{signed(s.total)}</td>
                  <td className={cn("px-2 py-1.5 text-right", tone(s.bpSum))}>{signed(s.bpSum, 1)}</td>
                  <td className={cn("px-2 py-1.5 text-right", tone(s.meanBp))}>{signed(s.meanBp, 2)}</td>
                  <td className="px-2 py-1.5 text-right">{s.winRate == null ? "—" : `${(s.winRate * 100).toFixed(1)}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
            <span>Matched, mean live − paper (+ = live better):</span>
            <span>entry <b className={cn("font-mono", tone(view.gaps.entry))}>{signed(view.gaps.entry)} bp</b></span>
            <span>exit <b className={cn("font-mono", tone(view.gaps.exit))}>{signed(view.gaps.exit)} bp</b></span>
            <span>net <b className={cn("font-mono", tone(view.gaps.net))}>{signed(view.gaps.net)} bp</b></span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Cumulative PnL</CardTitle>
          <CardDescription className="text-xs">
            Live and paper over all their trades in the window, by close time. Below: live − paper over matched trades only.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 px-2 sm:px-6">
          <div className="flex gap-1">
            {(["bp", "usd"] as const).map((u) => (
              <Button key={u} size="sm" variant={u === unit ? "default" : "outline"} className="h-7 px-2 text-xs" onClick={() => setUnit(u)}>
                {u === "bp" ? "Σ bp" : "USDT"}
              </Button>
            ))}
          </div>
          <ChartContainer
            config={{ [`live${k}`]: { label: "Live", color: LIVE }, [`paper${k}`]: { label: "Paper", color: PAPER } }}
            className="aspect-auto h-[260px] w-full"
          >
            <LineChart data={view.curve} margin={{ left: 4, right: 4, top: 8 }} syncId="pta">
              <CartesianGrid vertical={false} />
              <XAxis dataKey="ts" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={fmt} tickLine={false} axisLine={false} minTickGap={40} className="text-xs" />
              <YAxis tickLine={false} axisLine={false} width={48} className="text-xs" />
              <ReferenceLine y={0} stroke="currentColor" opacity={0.3} />
              <ChartTooltip content={<ChartTooltipContent labelFormatter={(_, p) => fmt(Number(p?.[0]?.payload?.ts))} />} />
              <ChartLegend content={<ChartLegendContent />} />
              <Line dataKey={`live${k}`} type="stepAfter" stroke={LIVE} strokeWidth={1.5} dot={false} isAnimationActive={false} />
              <Line dataKey={`paper${k}`} type="stepAfter" stroke={PAPER} strokeWidth={1.5} dot={false} isAnimationActive={false} />
            </LineChart>
          </ChartContainer>
          <ChartContainer config={{ [`diff${k}`]: { label: "Live − paper (matched)", color: DIFF } }} className="aspect-auto h-[140px] w-full">
            <LineChart data={view.curve} margin={{ left: 4, right: 4, top: 8 }} syncId="pta">
              <CartesianGrid vertical={false} />
              <XAxis dataKey="ts" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={fmt} tickLine={false} axisLine={false} minTickGap={40} className="text-xs" />
              <YAxis tickLine={false} axisLine={false} width={48} className="text-xs" />
              <ReferenceLine y={0} stroke="currentColor" opacity={0.3} />
              <ChartTooltip content={<ChartTooltipContent labelFormatter={(_, p) => fmt(Number(p?.[0]?.payload?.ts))} />} />
              <ChartLegend content={<ChartLegendContent />} />
              <Line dataKey={`diff${k}`} type="stepAfter" stroke={DIFF} strokeWidth={1.5} dot={false} isAnimationActive={false} />
            </LineChart>
          </ChartContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Trades</CardTitle>
          <CardDescription className="text-xs">{view.pairs.length} rows, newest entry first. Gaps signed so + = live better.</CardDescription>
        </CardHeader>
        <CardContent className="px-2 sm:px-6">
          <div className="max-h-[480px] overflow-auto rounded-md border">
            <table className="w-full font-mono text-xs">
              <thead className="sticky top-0 z-10 bg-card text-muted-foreground">
                <tr className="border-b">
                  {["", "Entry", "Symbol", "Side", "Entry L / P", "Exit L / P", "Exit reason L / P", "Entry gap", "Exit gap", "Live bp", "Paper bp", "Diff bp", "Live U", "Paper U"].map((h, i) => (
                    <th key={i} className={cn("whitespace-nowrap px-2 py-1.5 font-medium", i < 4 || i === 6 ? "text-left" : "text-right")}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {view.pairs.map((x) => {
                  const l = x.live;
                  const p = x.paper;
                  const side = l?.side ?? (p?.side === "short" ? "short" : "long");
                  const lb = l?.bp ?? null;
                  const pb = p ? paperBp(p) : null;
                  const status = l && p ? "Both" : l ? "Live only" : "Paper only";
                  return (
                    <tr key={x.key} className="border-b last:border-0">
                      <td className={cn("whitespace-nowrap px-2 py-1.5 font-sans", l && p ? "" : "text-amber-500")}>{status}</td>
                      <td className="whitespace-nowrap px-2 py-1.5">{fmt(x.t)}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 font-sans">{l?.symbol ?? p?.symbol}</td>
                      <td className={cn("px-2 py-1.5 font-sans", side === "long" ? "text-emerald-500" : "text-red-500")}>{side}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right">{l?.entry ?? "—"} / {p?.e ?? "—"}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right">{l?.exit == null ? "—" : Number(l.exit.toPrecision(6))} / {p?.exit_vwap ?? "—"}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 font-sans">{l?.exitType ?? "—"} / {p ? p.exit_reason ?? p.flat_reason : "—"}</td>
                      <td className={cn("px-2 py-1.5 text-right", tone(l && p ? gapBp(side, l.entry, p.e, true) : null))}>{l && p ? signed(gapBp(side, l.entry, p.e, true), 1) : ""}</td>
                      <td className={cn("px-2 py-1.5 text-right", tone(l && p ? gapBp(side, l.exit, p.exit_vwap, false) : null))}>{l && p ? signed(gapBp(side, l.exit, p.exit_vwap, false), 1) : ""}</td>
                      <td className={cn("px-2 py-1.5 text-right", tone(lb))}>{signed(lb, 1)}</td>
                      <td className={cn("px-2 py-1.5 text-right", tone(pb))}>{signed(pb, 1)}</td>
                      <td className={cn("px-2 py-1.5 text-right font-semibold", tone(lb != null && pb != null ? lb - pb : null))}>{lb != null && pb != null ? signed(lb - pb, 1) : ""}</td>
                      <td className={cn("px-2 py-1.5 text-right", tone(l?.pnl))}>{signed(l?.pnl, 3)}</td>
                      <td className={cn("px-2 py-1.5 text-right", tone(p?.total_pnl))}>{p ? signed(paperUsd(p), 3) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
