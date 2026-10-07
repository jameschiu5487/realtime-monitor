"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { isLiveSource, shortModel, type ScoredRow } from "@/lib/model-metrics";
import {
  DEFAULT_BASIS_CAP,
  DEFAULT_FEE_BP,
  DEFAULT_MARGIN_BP,
  DEFAULT_SLIPPAGE_BP,
  baselineTrades,
  concentration,
  curveStats,
  eventKey,
  feeSensitivity,
  marginSweep,
  modelTrades,
  net,
  newtonZTrades,
  NEWTON_Z_MARGIN_BP,
  periodDiff,
  prepare,
  thresholdCalibration,
  tradeDiff,
  type CurveStats,
  type DiffStats,
  type EvalConfig,
  type EvalRow,
  type Period,
} from "@/lib/model-eval";
import { COLORS } from "./model-charts";
import { formatDateTime } from "@/lib/time";

const POS = "#34d399";
const NEG = "#f87171";
const BASE = "#94a3b8";
const NEWTON_Z = "#f59e0b";
/** Lines for the models the page isn't showing. */
const OTHER_MODEL_COLORS = ["#f472b6", "#a78bfa", "#22d3ee"];

/** Mean-net bars are coloured per bar by sign, which the chart legend can't express. */
const NET_SWATCHES = [
  { color: POS, label: "Mean net ≥ 0 (bp)" },
  { color: NEG, label: "Mean net < 0 (bp)" },
];

function SwatchLegend({ items }: { items: { color: string; label: string; opacity?: number }[] }) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-4 text-xs">
      {items.map((it) => (
        <span key={it.label} className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-[2px]" style={{ backgroundColor: it.color, opacity: it.opacity ?? 1 }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}

export const bp = (v: number | null | undefined, d = 2) =>
  v == null || !Number.isFinite(v) ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(d)}`;
export const pct = (v: number | null | undefined) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);
export const tone = (v: number | null | undefined) =>
  v == null ? "text-muted-foreground" : v > 0 ? "text-emerald-500" : v < 0 ? "text-red-500" : "";
export const fmtTs = (ms: number) =>
  formatDateTime(ms, { month: "short", day: "numeric", hour: "2-digit", hour12: false });

export interface EvalSettings {
  /** Exchange fee only; the evaluation adds slipBp to get the per-trade cost. */
  feeBp: number;
  slipBp: number;
  marginBp: number;
  period: Period;
  capOn: boolean;
}

export const DEFAULT_EVAL_SETTINGS: EvalSettings = {
  feeBp: DEFAULT_FEE_BP,
  slipBp: DEFAULT_SLIPPAGE_BP,
  marginBp: DEFAULT_MARGIN_BP,
  period: "day",
  capOn: true,
};

/**
 * Settings are owned by the page: the Predictions table uses the same fee, and
 * Radix Tabs unmounts hidden panels, so state kept here reset on every switch.
 */
export function ModelEvaluation({
  rows,
  modelVersion,
  otherModels = [],
  splitBySource = false,
  settings,
  onSettingsChange,
}: {
  rows: ScoredRow[];
  /** The model the page is showing; every section is about it. */
  modelVersion: string | null;
  /** Other models, already filtered like `rows`; each adds a line to the equity curve only. */
  otherModels?: { version: string; rows: ScoredRow[] }[];
  /** Source mode "all": draw each model line solid over replay settlements, dashed over live ones. */
  splitBySource?: boolean;
  settings: EvalSettings;
  onSettingsChange: (next: EvalSettings) => void;
}) {
  const { feeBp: exchangeFeeBp, slipBp, marginBp, period, capOn } = settings;
  // Thresholds use the exchange fee; every net below is charged fee + slippage.
  const feeBp = exchangeFeeBp + slipBp;
  const setFeeBp = (v: number) => onSettingsChange({ ...settings, feeBp: v });
  const setSlipBp = (v: number) => onSettingsChange({ ...settings, slipBp: v });
  const setMarginBp = (v: number) => onSettingsChange({ ...settings, marginBp: v });
  const setPeriod = (v: Period) => onSettingsChange({ ...settings, period: v });
  const setCapOn = (v: boolean) => onSettingsChange({ ...settings, capOn: v });

  const cfg: EvalConfig = useMemo(
    () => ({ feeBp: exchangeFeeBp, slipBp, marginBp, period, basisCap: capOn ? DEFAULT_BASIS_CAP : null }),
    [exchangeFeeBp, slipBp, marginBp, period, capOn]
  );
  const prepared = useMemo(() => prepare(rows, cfg.basisCap), [rows, cfg.basisCap]);
  const evalRows = prepared.rows;
  // Only the traded side (edge ≥ 0) is shown: below the hurdle nothing is
  // traded, and those buckets' large negative means swamped the scale.
  const threshold = useMemo(() => {
    const t = thresholdCalibration(evalRows, cfg);
    const traded = (b: { lo: number }) => b.lo >= 0;
    return {
      bins: t.bins.filter(traded),
      byPeriod: t.byPeriod
        .map((p) => ({ ...p, bins: p.bins.filter(traded) }))
        .filter((p) => p.bins.some((b) => b.n > 0)),
    };
  }, [evalRows, cfg]);
  const model = useMemo(() => curveStats(modelTrades(evalRows, cfg), feeBp, period), [evalRows, cfg, feeBp, period]);
  const baseline = useMemo(() => curveStats(baselineTrades(evalRows, cfg), feeBp, period), [evalRows, cfg, feeBp, period]);
  const newtonZ = useMemo(() => curveStats(newtonZTrades(evalRows, exchangeFeeBp), feeBp, period), [evalRows, exchangeFeeBp, feeBp, period]);
  const sweep = useMemo(() => marginSweep(evalRows, cfg), [evalRows, cfg]);
  const diff = useMemo(() => periodDiff(model, baseline), [model, baseline]);
  const conc = useMemo(() => concentration(modelTrades(evalRows, cfg), feeBp), [evalRows, cfg, feeBp]);
  const fees = useMemo(() => feeSensitivity(evalRows, cfg), [evalRows, cfg]);

  const hurdle = exchangeFeeBp + marginBp;
  // Every settlement in scope, traded or not, so both curves span the whole window.
  // Other models run the same rule on their own events.
  const others = useMemo(
    () =>
      otherModels.map((m) => {
        const r = prepare(m.rows, cfg.basisCap).rows;
        return { version: m.version, evalRows: r, stats: curveStats(modelTrades(r, cfg), feeBp, period) };
      }),
    [otherModels, cfg, feeBp, period]
  );
  const timeline = useMemo(
    () =>
      [...new Set([...evalRows, ...others.flatMap((o) => o.evalRows)].map((r) => r.ts))].sort((a, b) => a - b),
    [evalRows, others]
  );
  const activeLabel = modelVersion ? shortModel(modelVersion) : "Model";
  const liveTsActive = useMemo(() => (splitBySource ? liveSettlements(evalRows) : undefined), [splitBySource, evalRows]);
  const liveTsOthers = useMemo(
    () => others.map((o) => (splitBySource ? liveSettlements(o.evalRows) : undefined)),
    [splitBySource, others]
  );
  // Baselines run on the page model's events, like their curve lines.
  const compareCandidates: CompareCandidate[] = useMemo(
    () => [
      { id: "model", label: activeLabel, trades: modelTrades(evalRows, cfg), ypredBy: ypredMap(evalRows) },
      ...others.map((o) => ({
        id: `model:${o.version}`,
        label: shortModel(o.version),
        trades: modelTrades(o.evalRows, cfg),
        ypredBy: ypredMap(o.evalRows),
      })),
      { id: "baseline", label: "Funding-only", trades: baselineTrades(evalRows, cfg) },
      { id: "newtonZ", label: "newton_z", trades: newtonZTrades(evalRows, exchangeFeeBp) },
    ],
    [activeLabel, evalRows, others, cfg, exchangeFeeBp]
  );
  const curveSeries: CurveSeries[] = [
    { key: "model", label: `${activeLabel} (cumulative bp)`, color: COLORS.pred, stats: model, width: 2, liveTs: liveTsActive },
    ...others.map((o, i) => ({
      key: `other${i}`,
      label: shortModel(o.version),
      color: OTHER_MODEL_COLORS[i % OTHER_MODEL_COLORS.length],
      stats: o.stats,
      width: 2,
      liveTs: liveTsOthers[i],
    })),
    { key: "baseline", label: "Funding-only (cumulative bp)", color: BASE, stats: baseline, dash: "4 3" },
    { key: "newtonZ", label: `newton_z (exp_funding > fee + ${NEWTON_Z_MARGIN_BP})`, color: NEWTON_Z, stats: newtonZ },
  ];

  return (
    <div className="space-y-4 sm:space-y-6">
      <Card>
        <CardContent className="space-y-3 py-4">
          <div className="flex flex-wrap items-end gap-4">
            <NumberField label="Fee (bp)" value={exchangeFeeBp} onChange={setFeeBp} />
            <NumberField label="Slippage (bp)" value={slipBp} onChange={setSlipBp} />
            <NumberField label="Margin (bp)" value={marginBp} onChange={setMarginBp} />
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Period</Label>
              <div className="flex gap-1">
                {(["day", "week", "month"] as const).map((p) => (
                  <Button key={p} size="sm" variant={p === period ? "default" : "outline"} onClick={() => setPeriod(p)}>
                    {p}
                  </Button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2 pb-1.5">
              <Switch id="basis-cap" checked={capOn} onCheckedChange={setCapOn} />
              <Label htmlFor="basis-cap" className="text-sm">|entry_basis| ≤ {DEFAULT_BASIS_CAP}</Label>
            </div>
            {(exchangeFeeBp !== DEFAULT_FEE_BP || slipBp !== DEFAULT_SLIPPAGE_BP || marginBp !== DEFAULT_MARGIN_BP) && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  onSettingsChange({ ...settings, feeBp: DEFAULT_FEE_BP, slipBp: DEFAULT_SLIPPAGE_BP, marginBp: DEFAULT_MARGIN_BP })
                }
              >
                Reset to default ({DEFAULT_FEE_BP} / {DEFAULT_SLIPPAGE_BP} / {DEFAULT_MARGIN_BP})
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Entry uses fee + margin; the P&amp;L also pays slippage: cost per trade = fee {exchangeFeeBp} + slippage {slipBp} = {feeBp.toFixed(2)} bp. Net per event = y + settled funding − cost (realised; exp_funding is used only to decide). Model trades when ypred + exp_funding &gt; fee + margin = {hurdle.toFixed(2)} bp;
            the funding-only baseline when exp_funding &gt; {hurdle.toFixed(2)} bp. Equal size per trade.{" "}
            <span className="text-amber-500">
              Liquidity gate (qv_240 &gt; 166,666 on both venues) not applied — the shadow tables have no qv_240.
            </span>{" "}
            {evalRows.length} events in scope
            {prepared.pendingFunding > 0 && `, ${prepared.pendingFunding} left out until their funding settles`}.
          </p>
        </CardContent>
      </Card>

      {/* 1. Threshold calibration */}
      <Section
        n={1}
        title="Threshold calibration"
        desc={`Events bucketed by edge = ypred + exp_funding − (fee + margin). Only edge ≥ 0 (what the model trades) is shown; mean net should be positive and rise with edge.`}
      >
        <ChartContainer config={{ meanNet: { label: "Mean net (bp)", color: POS } }} className="aspect-auto h-[220px] w-full">
          <BarChart data={threshold.bins} margin={{ left: 4, right: 4, top: 8 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} className="text-xs" interval={0} tick={{ fontSize: 10 }} />
            <YAxis tickLine={false} axisLine={false} width={36} className="text-xs" />
            <ReferenceLine y={0} stroke="currentColor" opacity={0.3} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Bar dataKey="meanNet" radius={2}>
              {threshold.bins.map((b) => (
                <Cell key={b.label} fill={(b.meanNet ?? 0) >= 0 ? POS : NEG} />
              ))}
            </Bar>
          </BarChart>
        </ChartContainer>
        <SwatchLegend items={NET_SWATCHES} />
        <Table
          head={["Edge (bp)", "n", "Mean net", "Sum net", "Win"]}
          rows={threshold.bins.map((b) => [
            b.label,
            b.n,
            <span key="m" className={tone(b.meanNet)}>{bp(b.meanNet)}</span>,
            <span key="s" className={tone(b.sumNet)}>{bp(b.sumNet, 1)}</span>,
            pct(b.winRate),
          ])}
        />
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">By {period} (mean net, n)</summary>
          <Table
            head={[period, ...threshold.bins.map((b) => b.label)]}
            rows={threshold.byPeriod.map((p) => [
              p.period,
              ...p.bins.map((b, i) => (
                <span key={i} className={tone(b.meanNet)}>
                  {b.n === 0 ? "·" : `${bp(b.meanNet, 1)} (${b.n})`}
                </span>
              )),
            ])}
          />
        </details>
      </Section>

      {/* 2. Curve stats */}
      <Section
        n={2}
        title="Equity curve (curve_stats)"
        desc={`Cumulative net bp of every trade the rule takes, in settlement order, against the funding-only rule at the same threshold, and newton_z (exp_funding > fee + ${NEWTON_Z_MARGIN_BP} = ${(exchangeFeeBp + NEWTON_Z_MARGIN_BP).toFixed(2)} bp, a fixed margin of its own).`}
      >
        <CurveChart series={curveSeries} timeline={timeline} />
        <Table
          head={["", "Trades", "Total bp", "Per trade", "Win", "Max DD", "Ret / DD", `+${period}s`]}
          rows={[
            statRow(activeLabel, model),
            ...others.map((o) => statRow(shortModel(o.version), o.stats)),
            statRow("Funding-only", baseline),
            statRow("newton_z", newtonZ),
          ]}
        />
      </Section>

      {/* 3. Baseline comparisons */}
      <Section
        n={3}
        title="vs funding-only (margin_sweep)"
        desc="Good = beating the funding-only baseline at the same threshold, across margins."
      >
        <div className="text-xs font-medium">Total bp across margins</div>
        <ChartContainer
          config={{
            model: { label: "Model total bp", color: COLORS.pred },
            baseline: { label: "Funding-only total bp", color: BASE },
          }}
          className="aspect-auto h-[220px] w-full"
        >
          <LineChart
            data={sweep.map((r) => ({ margin: r.key, model: r.model.totalBp, baseline: r.baseline.totalBp, mn: r.model.n, bn: r.baseline.n }))}
            margin={{ left: 4, right: 4, top: 8 }}
          >
            <CartesianGrid vertical={false} />
            <XAxis dataKey="margin" tickLine={false} axisLine={false} className="text-xs" tickFormatter={(m) => `${m}`} />
            <YAxis tickLine={false} axisLine={false} width={40} className="text-xs" />
            <ReferenceLine y={0} stroke="currentColor" opacity={0.3} />
            <ReferenceLine x={marginBp} stroke="currentColor" strokeDasharray="3 3" opacity={0.5} />
            <ChartTooltip content={<ChartTooltipContent labelFormatter={(_, p) => `margin ${p?.[0]?.payload?.margin} bp · trades ${p?.[0]?.payload?.mn} vs ${p?.[0]?.payload?.bn}`} />} />
            <ChartLegend content={<ChartLegendContent className="flex-wrap" />} />
            <Line dataKey="model" stroke="var(--color-model)" dot={{ r: 2 }} isAnimationActive={false} />
            <Line dataKey="baseline" stroke="var(--color-baseline)" strokeDasharray="4 3" dot={{ r: 2 }} isAnimationActive={false} />
          </LineChart>
        </ChartContainer>

        <div className="pt-2 text-xs font-medium">
          Same margin — both rules at fee {exchangeFeeBp} + margin, nets after slippage {slipBp} (current margin {marginBp} in bold)
        </div>
        <Table
          head={["Margin", "Model n", "Base n", "Model total", "Base total", "Δ", "Model win", "Base win", `Model +${period}s`, `Base +${period}s`]}
          rows={sweep.map((r) => {
            const current = r.key === marginBp;
            return [
              <span key="k" className={cn(current && "font-bold")}>{r.key}</span>,
              r.model.n,
              r.baseline.n,
              <span key="m" className={tone(r.model.totalBp)}>{bp(r.model.totalBp, 1)}</span>,
              <span key="b" className={tone(r.baseline.totalBp)}>{bp(r.baseline.totalBp, 1)}</span>,
              <span key="d" className={cn("font-semibold", tone(r.model.totalBp - r.baseline.totalBp))}>
                {bp(r.model.totalBp - r.baseline.totalBp, 1)}
              </span>,
              pct(r.model.winRate),
              pct(r.baseline.winRate),
              `${r.model.positivePeriods}/${r.model.periods}`,
              `${r.baseline.positivePeriods}/${r.baseline.periods}`,
            ];
          })}
        />

        <div className="pt-2 text-xs font-medium">Per {period}: model − baseline (at margin {marginBp})</div>
        <Table
          // ~10 rows, then scroll.
          scroll="max-h-[322px]"
          head={[period, "Model", "Baseline", "Δ"]}
          rows={diff.periods.map((p) => [
            p.period,
            bp(p.model, 1),
            bp(p.baseline, 1),
            <span key="d" className={tone(p.diff)}>{bp(p.diff, 1)}</span>,
          ])}
        />
        <p className="text-xs text-muted-foreground">
          t-test on per-{period} Δ:{" "}
          {diff.t == null
            ? `needs ≥ 2 ${period}s with varying Δ (have ${diff.periods.length}).`
            : `mean ${bp(diff.meanDiff, 2)} bp, t = ${diff.t.toFixed(2)}, df = ${diff.df}, p = ${diff.p?.toFixed(3)}`}
        </p>
      </Section>

      {/* 4. Compare two rules */}
      <Section
        n={4}
        title="Compare"
        desc="Pick any two of the models and baselines. The trades both take cancel out, so the whole P&L gap between them is in the trades only one of them takes."
      >
        <CompareBlock candidates={compareCandidates} feeBp={feeBp} period={period} timeline={timeline} />
      </Section>

      {/* 7. Auxiliaries */}
      <Section n={7} title="Auxiliaries" desc="Breadth and concentration of the model's trades, and the rule re-run at other fees (the threshold moves with the fee).">
        <div className="grid grid-cols-3 gap-3 text-center">
          <Mini label="Symbols traded" value={String(conc.symbols)} />
          <Mini label="Top-5 share of |net|" value={pct(conc.top5Share)} />
          <Mini label="Effective symbols (1/HHI)" value={conc.hhi ? (1 / conc.hhi).toFixed(1) : "—"} />
        </div>
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">Contribution by symbol</summary>
          <Table
            head={["Symbol", "Trades", "Net bp"]}
            rows={conc.bySymbol.slice(0, 30).map((s) => [
              s.symbol,
              s.n,
              <span key="n" className={tone(s.netBp)}>{bp(s.netBp, 1)}</span>,
            ])}
          />
        </details>
        <div className="pt-2 text-xs font-medium">Fee sensitivity (margin {marginBp}, slippage {slipBp} on top of each fee)</div>
        <Table
          head={["Fee", "Model n", "Model total", "Model / trade", "Base n", "Base total"]}
          rows={fees.map((f) => [
            <span key="f" className={cn(f.fee === exchangeFeeBp && "font-semibold")}>{f.fee}</span>,
            f.model.n,
            <span key="m" className={tone(f.model.totalBp)}>{bp(f.model.totalBp, 1)}</span>,
            bp(f.model.perTradeBp),
            f.baseline.n,
            <span key="b" className={tone(f.baseline.totalBp)}>{bp(f.baseline.totalBp, 1)}</span>,
          ])}
        />
      </Section>
    </div>
  );
}

function statRow(label: string, s: CurveStats): ReactNode[] {
  return [
    <span key="l" className="font-sans font-medium">{label}</span>,
    s.n,
    <span key="t" className={tone(s.totalBp)}>{bp(s.totalBp, 1)}</span>,
    <span key="p" className={tone(s.perTradeBp)}>{bp(s.perTradeBp)}</span>,
    pct(s.winRate),
    s.maxDdBp.toFixed(1),
    s.retOverDd == null ? "—" : s.retOverDd.toFixed(2),
    `${s.positivePeriods}/${s.periods}`,
  ];
}

export interface CurveSeries {
  key: string;
  label: string;
  color: string;
  stats: Pick<CurveStats, "n" | "curve">;
  dash?: string;
  width?: number;
  /**
   * Settlements whose predictions are live. When set, the line is drawn in two
   * keys — solid over replay settlements, dashed over live ones — sharing the
   * point where the source changes so the line stays continuous.
   */
  liveTs?: Set<number>;
}

/** Settlements where live rows are at least half of the rows in scope. */
function liveSettlements(rows: { ts: number; source: string | null }[]): Set<number> {
  const counts = new Map<number, number>();
  for (const r of rows) counts.set(r.ts, (counts.get(r.ts) ?? 0) + (isLiveSource(r.source) ? 1 : -1));
  return new Set([...counts].filter(([, c]) => c >= 0).map(([ts]) => ts));
}

const LIVE_DASH = "5 4";

export function CurveChart({
  series,
  timeline,
  height = 240,
}: {
  series: CurveSeries[];
  timeline: number[];
  height?: number;
}) {
  // A point at every settlement in scope. A settlement with no trade carries
  // the previous cumulative value forward (0 before the first trade), so a
  // quiet stretch reads as flat rather than as the line ending early.
  const data = useMemo(() => {
    const at = series.map((s) => new Map(s.stats.curve.map((p) => [p.ts, p.cum])));
    const last = series.map(() => 0);
    const lastSeg: (boolean | null)[] = series.map(() => null);
    const points: Record<string, number>[] = [];
    timeline.forEach((ts, t) => {
      const point: Record<string, number> = { ts };
      series.forEach((s, i) => {
        last[i] = at[i].get(ts) ?? last[i];
        if (!s.liveTs) {
          point[s.key] = last[i];
          return;
        }
        const live = s.liveTs.has(ts);
        point[live ? `${s.key}_live` : s.key] = last[i];
        // Start the new segment at the previous point so the two halves join.
        if (t > 0 && lastSeg[i] !== null && lastSeg[i] !== live) {
          const prev = points[t - 1];
          prev[live ? `${s.key}_live` : s.key] = prev[live ? s.key : `${s.key}_live`];
        }
        lastSeg[i] = live;
      });
      points.push(point);
    });
    return points;
  }, [series, timeline]);
  // Split series become two lines but one legend entry: the live half only
  // shows in the legend when there is no replay half to stand for the model.
  const lines = useMemo(
    () =>
      series.flatMap((s) => {
        if (!s.liveTs) return [{ ...s, split: false, inLegend: true }];
        const hasReplay = data.some((p) => p[s.key] !== undefined);
        const hasLive = data.some((p) => p[`${s.key}_live`] !== undefined);
        return [
          ...(hasReplay ? [{ ...s, split: true, inLegend: true }] : []),
          ...(hasLive ? [{ ...s, key: `${s.key}_live`, dash: LIVE_DASH, split: true, inLegend: !hasReplay }] : []),
        ];
      }),
    [series, data]
  );
  const hasDashed = lines.some((s) => s.split && s.dash === LIVE_DASH);
  if (series.every((s) => s.stats.n === 0)) return <p className="py-6 text-center text-sm text-muted-foreground">No trades pass the threshold.</p>;
  return (
    <>
    <ChartContainer
      config={Object.fromEntries(lines.map((s) => [s.key, { label: s.label, color: s.color }]))}
      className="aspect-auto w-full"
      style={{ height }}
    >
      <LineChart data={data} margin={{ left: 4, right: 4, top: 8 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="ts" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={fmtTs} tickLine={false} axisLine={false} minTickGap={40} className="text-xs" />
        <YAxis tickLine={false} axisLine={false} width={40} className="text-xs" />
        <ReferenceLine y={0} stroke="currentColor" opacity={0.3} />
        <ChartTooltip content={<ChartTooltipContent labelFormatter={(_, p) => fmtTs(Number(p?.[0]?.payload?.ts))} />} />
        <ChartLegend content={<ChartLegendContent className="flex-wrap" />} />
        {lines.map((s) => (
          <Line
            key={s.key}
            dataKey={s.key}
            type="stepAfter"
            stroke={`var(--color-${s.key})`}
            strokeWidth={s.width ?? 1.5}
            strokeDasharray={s.dash}
            legendType={s.inLegend ? undefined : "none"}
            dot={false}
            // Split halves must not bridge across the other half's stretch.
            connectNulls={!s.split}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ChartContainer>
    {hasDashed && <p className="text-center text-xs text-muted-foreground">Solid = replay · dashed = live</p>}
    </>
  );
}

interface CompareCandidate {
  id: string;
  label: string;
  trades: EvalRow[];
  /** A model's ypred for every event it scored (traded or not); baselines have none. */
  ypredBy?: Map<string, number>;
}

const ypredMap = (rows: EvalRow[]) => new Map(rows.map((r) => [eventKey(r), r.ypred]));

const NO_B = "none";

/** Longest trade-diff list rendered; the P&L table always covers all of it. */
const DIFF_ROW_CAP = 1000;

function CompareBlock({
  candidates,
  feeBp,
  period,
  timeline,
}: {
  candidates: CompareCandidate[];
  feeBp: number;
  period: Period;
  timeline: number[];
}) {
  const [aId, setAId] = useState("model");
  const [bId, setBId] = useState("baseline");
  // A model that left scope (source switch, model switch) falls back to the defaults.
  const a = candidates.find((c) => c.id === aId) ?? candidates[0];
  // B = None: no comparison, the block just lists A's own trades.
  const b = bId === NO_B ? null : candidates.find((c) => c.id === bId) ?? candidates.find((c) => c.id === "baseline")!;
  const diff = useMemo(() => tradeDiff(a.trades, b?.trades ?? [], feeBp), [a, b, feeBp]);
  const rows = useMemo(
    () =>
      [
        ...diff.onlyA.map((r) => ({ r, side: "A" as const })),
        ...diff.onlyB.map((r) => ({ r, side: "B" as const })),
      ].sort((x, y) => y.r.ts - x.r.ts || x.r.symbol.localeCompare(y.r.symbol)),
    [diff]
  );
  const ypredCell = (c: CompareCandidate, key: string) => {
    if (!c.ypredBy) return <span className="text-muted-foreground">n/a</span>;
    const v = c.ypredBy.get(key);
    return v == null ? <span className="text-muted-foreground">no pred</span> : bp(v);
  };
  const pnlRow = (label: ReactNode, s: DiffStats): ReactNode[] => [
    label,
    s.n,
    <span key="t" className={tone(s.totalBp)}>{bp(s.totalBp, 1)}</span>,
    <span key="p" className={tone(s.perTradeBp)}>{bp(s.perTradeBp)}</span>,
    pct(s.winRate),
  ];
  const gap = diff.onlyAStats.totalBp - diff.onlyBStats.totalBp;
  // Cumulative P&L of each side's exclusive trades, and their gap — which is
  // the gap between the two rules' whole equity curves, shared trades cancelling.
  const series: CurveSeries[] = useMemo(() => {
    const onlyA = curveStats(diff.onlyA, feeBp, period);
    if (!b) return [{ key: "onlyA", label: `${a.label} (cumulative bp)`, color: COLORS.pred, stats: onlyA, width: 2 }];
    const onlyB = curveStats(diff.onlyB, feeBp, period);
    const aAt = new Map(onlyA.curve.map((p) => [p.ts, p.cum]));
    const bAt = new Map(onlyB.curve.map((p) => [p.ts, p.cum]));
    let ca = 0;
    let cb = 0;
    const gapCurve = [...new Set([...aAt.keys(), ...bAt.keys()])]
      .sort((x, y) => x - y)
      .map((ts) => {
        ca = aAt.get(ts) ?? ca;
        cb = bAt.get(ts) ?? cb;
        return { ts, cum: ca - cb };
      });
    return [
      { key: "gap", label: "A − B (cumulative bp)", color: COLORS.pred, stats: { n: gapCurve.length, curve: gapCurve }, width: 2 },
      { key: "onlyA", label: `Only A (${a.label})`, color: "#0ea5e9", stats: onlyA },
      { key: "onlyB", label: `Only B (${b.label})`, color: NEWTON_Z, stats: onlyB, dash: "4 3" },
    ];
  }, [diff, feeBp, period, a.label, b]);

  return (
    <div className="space-y-3">
      {(["A", "B"] as const).map((side) => {
        const current = side === "A" ? a.id : (b?.id ?? NO_B);
        const set = side === "A" ? setAId : setBId;
        return (
          <div key={side} className="flex flex-wrap items-center gap-1">
            <span className="w-5 text-xs font-semibold">{side}</span>
            {side === "B" && (
              <Button size="sm" variant={current === NO_B ? "default" : "outline"} className="h-7 px-2 text-xs" onClick={() => set(NO_B)}>
                None
              </Button>
            )}
            {candidates.map((c) => (
              <Button key={c.id} size="sm" variant={c.id === current ? "default" : "outline"} className="h-7 px-2 text-xs" onClick={() => set(c.id)}>
                {c.label}
              </Button>
            ))}
          </div>
        );
      })}
      {!b ? (
        <>
          <div className="text-xs font-medium">P&amp;L series — {a.label}</div>
          <CurveChart series={series} timeline={timeline} />
          <Table head={["", "Trades", "Total bp", "Per trade", "Win"]} rows={[pnlRow(a.label, diff.onlyAStats)]} />
          <div className="pt-2 text-xs font-medium">
            Trades of {a.label} ({rows.length}
            {rows.length > DIFF_ROW_CAP && `, newest ${DIFF_ROW_CAP} shown`})
          </div>
          <Table
            scroll
            head={["Settlement", "Symbol", "ypred", "Exp funding", "Settled funding", "y", `Net (cost ${feeBp.toFixed(2)})`]}
            rows={rows.slice(0, DIFF_ROW_CAP).map(({ r }) => {
              const v = net(r, feeBp);
              return [
                fmtTs(r.ts),
                <span key="s" className="font-sans">{r.symbol}</span>,
                ypredCell(a, eventKey(r)),
                bp(r.expFunding),
                bp(r.settledFunding),
                <span key="y" className={tone(r.y)}>{bp(r.y)}</span>,
                <span key="n" className={tone(v)}>{bp(v)}</span>,
              ];
            })}
          />
        </>
      ) : a.id === b.id ? (
        <p className="py-4 text-center text-sm text-muted-foreground">Pick two different rules.</p>
      ) : (
        <>
          <div className="text-xs font-medium">
            Diff P&amp;L series — A = {a.label}, B = {b.label}
          </div>
          <CurveChart series={series} timeline={timeline} />
          <div className="pt-2 text-xs font-medium">
            P&amp;L of the diff — A = {a.label}, B = {b.label}
          </div>
          <Table
            head={["", "Trades", "Total bp", "Per trade", "Win"]}
            rows={[
              pnlRow(`Only A (${a.label})`, diff.onlyAStats),
              pnlRow(`Only B (${b.label})`, diff.onlyBStats),
              pnlRow("Both", diff.both),
              [
                <span key="l" className="font-semibold">A − B</span>,
                diff.onlyAStats.n - diff.onlyBStats.n,
                <span key="t" className={cn("font-semibold", tone(gap))}>{bp(gap, 1)}</span>,
                "",
                "",
              ],
            ]}
          />
          <div className="pt-2 text-xs font-medium">
            Trades only one side takes ({rows.length}
            {rows.length > DIFF_ROW_CAP && `, newest ${DIFF_ROW_CAP} shown`})
          </div>
          <Table
            scroll
            head={["Settlement", "Symbol", "Taken by", "A ypred", "B ypred", "Exp funding", "Settled funding", "y", `Net (cost ${feeBp.toFixed(2)})`]}
            rows={rows.slice(0, DIFF_ROW_CAP).map(({ r, side }) => {
              const key = eventKey(r);
              const v = net(r, feeBp);
              return [
                fmtTs(r.ts),
                <span key="s" className="font-sans">{r.symbol}</span>,
                <span key="b" className={cn("font-sans", side === "A" ? "text-sky-500" : "text-amber-500")}>
                  {side} only
                </span>,
                ypredCell(a, key),
                ypredCell(b, key),
                bp(r.expFunding),
                bp(r.settledFunding),
                <span key="y" className={tone(r.y)}>{bp(r.y)}</span>,
                <span key="n" className={tone(v)}>{bp(v)}</span>,
              ];
            })}
          />
        </>
      )}
    </div>
  );
}

export function Section({ n, title, desc, children }: { n: number; title: string; desc: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">
          <span className="mr-2 text-muted-foreground">{n}.</span>
          {title}
        </CardTitle>
        <CardDescription className="text-xs">{desc}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 px-2 sm:px-6">{children}</CardContent>
    </Card>
  );
}

/** `scroll` caps the height (a max-h class, default ~14 rows) and keeps the header visible. */
export function Table({ head, rows, scroll }: { head: ReactNode[]; rows: ReactNode[][]; scroll?: boolean | string }) {
  return (
    <div
      className={cn(
        "overflow-x-auto",
        scroll && cn("overflow-y-auto rounded-md border", typeof scroll === "string" ? scroll : "max-h-[420px]")
      )}
    >
      <table className="w-full text-xs font-mono">
        <thead className={cn("text-muted-foreground", scroll && "sticky top-0 z-10 bg-card")}>
          <tr className="border-b">
            {head.map((h, i) => (
              <th key={i} className={cn("px-2 py-1.5 font-medium whitespace-nowrap", i === 0 ? "text-left" : "text-right")}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b last:border-0">
              {r.map((c, j) => (
                <td key={j} className={cn("px-2 py-1.5 whitespace-nowrap", j === 0 ? "text-left" : "text-right")}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={head.length} className="py-4 text-center text-muted-foreground">
                No data
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border p-2">
      <div className="text-lg font-bold font-mono">{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  const [text, setText] = useState(String(value));
  const [last, setLast] = useState(value);
  // Follow external resets without clobbering what the user is typing.
  if (value !== last) {
    setLast(value);
    setText(String(value));
  }
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input
        type="number"
        step="0.01"
        inputMode="decimal"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const v = Number(e.target.value);
          if (e.target.value !== "" && Number.isFinite(v)) {
            setLast(v);
            onChange(v);
          }
        }}
        className="h-8 w-24"
      />
    </div>
  );
}
