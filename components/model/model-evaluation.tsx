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
import type { ScoredRow } from "@/lib/model-metrics";
import {
  DEFAULT_BASIS_CAP,
  DEFAULT_FEE_BP,
  DEFAULT_MARGIN_BP,
  baselineTrades,
  concentration,
  curveStats,
  decileLens,
  feeSensitivity,
  marginSweep,
  modelTrades,
  periodDiff,
  prepare,
  thresholdCalibration,
  topnCompare,
  type CurveStats,
  type EvalConfig,
  type Period,
} from "@/lib/model-eval";
import { COLORS } from "./model-charts";

const POS = "#34d399";
const NEG = "#f87171";
const BASE = "#94a3b8";

const bp = (v: number | null | undefined, d = 2) =>
  v == null || !Number.isFinite(v) ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(d)}`;
const pct = (v: number | null | undefined) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);
const tone = (v: number | null | undefined) =>
  v == null ? "text-muted-foreground" : v > 0 ? "text-emerald-500" : v < 0 ? "text-red-500" : "";
const fmtTs = (ms: number) =>
  new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", hour12: false });

export function ModelEvaluation({ rows }: { rows: ScoredRow[] }) {
  const [feeBp, setFeeBp] = useState(DEFAULT_FEE_BP);
  const [marginBp, setMarginBp] = useState(DEFAULT_MARGIN_BP);
  const [period, setPeriod] = useState<Period>("day");
  const [capOn, setCapOn] = useState(true);

  const cfg: EvalConfig = useMemo(
    () => ({ feeBp, marginBp, period, basisCap: capOn ? DEFAULT_BASIS_CAP : null }),
    [feeBp, marginBp, period, capOn]
  );
  const evalRows = useMemo(() => prepare(rows, cfg.basisCap), [rows, cfg.basisCap]);
  const threshold = useMemo(() => thresholdCalibration(evalRows, cfg), [evalRows, cfg]);
  const model = useMemo(() => curveStats(modelTrades(evalRows, cfg), feeBp, period), [evalRows, cfg, feeBp, period]);
  const baseline = useMemo(() => curveStats(baselineTrades(evalRows, cfg), feeBp, period), [evalRows, cfg, feeBp, period]);
  const topn = useMemo(() => topnCompare(evalRows, cfg), [evalRows, cfg]);
  const sweep = useMemo(() => marginSweep(evalRows, cfg), [evalRows, cfg]);
  const diff = useMemo(() => periodDiff(model, baseline), [model, baseline]);
  const deciles = useMemo(() => decileLens(evalRows, feeBp), [evalRows, feeBp]);
  const conc = useMemo(() => concentration(modelTrades(evalRows, cfg), feeBp), [evalRows, cfg, feeBp]);
  const fees = useMemo(() => feeSensitivity(evalRows, cfg), [evalRows, cfg]);

  const hurdle = feeBp + marginBp;

  return (
    <div className="space-y-4 sm:space-y-6">
      <Card>
        <CardContent className="space-y-3 py-4">
          <div className="flex flex-wrap items-end gap-4">
            <NumberField label="Fee (bp)" value={feeBp} onChange={setFeeBp} />
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
            {(feeBp !== DEFAULT_FEE_BP || marginBp !== DEFAULT_MARGIN_BP) && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setFeeBp(DEFAULT_FEE_BP);
                  setMarginBp(DEFAULT_MARGIN_BP);
                }}
              >
                Reset to ADR 0003 ({DEFAULT_FEE_BP} / {DEFAULT_MARGIN_BP})
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Net per event = y + exp_funding − fee. Model trades when ypred + exp_funding &gt; {hurdle.toFixed(2)} bp;
            the funding-only baseline when exp_funding &gt; {hurdle.toFixed(2)} bp. Equal size per trade.{" "}
            <span className="text-amber-500">
              Liquidity gate (qv_240 &gt; 166,666 on both venues) not applied — the shadow tables have no qv_240.
            </span>{" "}
            {evalRows.length} events in scope.
          </p>
        </CardContent>
      </Card>

      {/* 1. Threshold calibration */}
      <Section
        n={1}
        title="Threshold calibration"
        desc={`Events bucketed by edge = ypred + exp_funding − (fee + margin). Edge ≥ 0 is what the model trades; mean net should rise with edge and turn positive at 0.`}
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
                <Cell key={b.label} fill={(b.meanNet ?? 0) >= 0 ? POS : NEG} opacity={b.lo >= 0 ? 1 : 0.5} />
              ))}
            </Bar>
          </BarChart>
        </ChartContainer>
        <Table
          head={["Edge (bp)", "n", "Mean net", "Sum net", "Win"]}
          rows={threshold.bins.map((b) => [
            <span key="l" className={cn(b.lo >= 0 && "font-semibold")}>{b.label}</span>,
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
        desc="Cumulative net bp of every trade the rule takes, in settlement order, against the funding-only rule at the same threshold."
      >
        <CurveChart model={model} baseline={baseline} />
        <Table
          head={["", "Trades", "Total bp", "Per trade", "Win", "Max DD", "Ret / DD", `+${period}s`]}
          rows={[
            statRow("Model", model),
            statRow("Funding-only", baseline),
          ]}
        />
      </Section>

      {/* 3. Baseline comparisons */}
      <Section
        n={3}
        title="vs funding-only (topn_compare, margin_sweep)"
        desc="Good = beating the funding-only baseline both at the same trade count and at the same threshold."
      >
        <div className="text-xs font-medium">Same trade count — top N by signal vs top N by exp_funding</div>
        {topn.length === 0 ? (
          <p className="text-xs text-muted-foreground">Fewer than 25 events in scope.</p>
        ) : (
          <Table
            head={["N", "Model total", "Base total", "Δ", "Model win", "Base win", `Model +${period}s`, `Base +${period}s`]}
            rows={topn.map((r) => [
              r.key,
              <span key="m" className={tone(r.model.totalBp)}>{bp(r.model.totalBp, 1)}</span>,
              <span key="b" className={tone(r.baseline.totalBp)}>{bp(r.baseline.totalBp, 1)}</span>,
              <span key="d" className={cn("font-semibold", tone(r.model.totalBp - r.baseline.totalBp))}>
                {bp(r.model.totalBp - r.baseline.totalBp, 1)}
              </span>,
              pct(r.model.winRate),
              pct(r.baseline.winRate),
              `${r.model.positivePeriods}/${r.model.periods}`,
              `${r.baseline.positivePeriods}/${r.baseline.periods}`,
            ])}
          />
        )}

        <div className="pt-2 text-xs font-medium">Same threshold — margin sweep (fee {feeBp} bp)</div>
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
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">Margin sweep table</summary>
          <Table
            head={["Margin", "Model n", "Model total", "Model / trade", "Base n", "Base total", "Base / trade"]}
            rows={sweep.map((r) => [
              r.key,
              r.model.n,
              <span key="m" className={tone(r.model.totalBp)}>{bp(r.model.totalBp, 1)}</span>,
              bp(r.model.perTradeBp),
              r.baseline.n,
              <span key="b" className={tone(r.baseline.totalBp)}>{bp(r.baseline.totalBp, 1)}</span>,
              bp(r.baseline.perTradeBp),
            ])}
          />
        </details>

        <div className="pt-2 text-xs font-medium">Per {period}: model − baseline (at margin {marginBp})</div>
        <Table
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

      {/* 4. Decile lens */}
      <Section
        n={4}
        title="Decile lens"
        desc="ypred deciles. Research cuts at the train set's predictions; the shadow has no train set, so these cut points come from the rows in scope."
      >
        <ChartContainer
          config={{ meanNet: { label: "Mean net (bp)", color: POS }, meanY: { label: "Mean y (bp)", color: COLORS.truth } }}
          className="aspect-auto h-[200px] w-full"
        >
          <BarChart data={deciles} margin={{ left: 4, right: 4, top: 8 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="decile" tickFormatter={(d) => `D${d}`} tickLine={false} axisLine={false} className="text-xs" />
            <YAxis tickLine={false} axisLine={false} width={36} className="text-xs" />
            <ReferenceLine y={0} stroke="currentColor" opacity={0.3} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <ChartLegend content={<ChartLegendContent />} />
            <Bar dataKey="meanY" fill="var(--color-meanY)" opacity={0.5} radius={2} />
            <Bar dataKey="meanNet" radius={2}>
              {deciles.map((d) => (
                <Cell key={d.decile} fill={d.meanNet >= 0 ? POS : NEG} />
              ))}
            </Bar>
          </BarChart>
        </ChartContainer>
        <Table
          head={["Decile", "n", "ypred range", "Mean ypred", "Mean y", "Mean net", "Win"]}
          rows={deciles.map((d) => [
            `D${d.decile}`,
            d.n,
            `${d.lo.toFixed(2)} ~ ${d.hi.toFixed(2)}`,
            bp(d.meanPred),
            <span key="y" className={tone(d.meanY)}>{bp(d.meanY)}</span>,
            <span key="n" className={tone(d.meanNet)}>{bp(d.meanNet)}</span>,
            pct(d.winRate),
          ])}
        />
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
        <div className="pt-2 text-xs font-medium">Fee sensitivity (margin {marginBp})</div>
        <Table
          head={["Fee", "Model n", "Model total", "Model / trade", "Base n", "Base total"]}
          rows={fees.map((f) => [
            <span key="f" className={cn(f.fee === feeBp && "font-semibold")}>{f.fee}</span>,
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

function CurveChart({ model, baseline }: { model: CurveStats; baseline: CurveStats }) {
  // One series per rule on a shared time axis; each keeps its own cumulative value.
  const data = useMemo(() => {
    const m = new Map<number, { ts: number; model?: number; baseline?: number }>();
    for (const p of model.curve) m.set(p.ts, { ...(m.get(p.ts) ?? { ts: p.ts }), model: p.cum });
    for (const p of baseline.curve) m.set(p.ts, { ...(m.get(p.ts) ?? { ts: p.ts }), baseline: p.cum });
    return [...m.values()].sort((a, b) => a.ts - b.ts);
  }, [model, baseline]);
  if (data.length === 0) return <p className="py-6 text-center text-sm text-muted-foreground">No trades pass the threshold.</p>;
  return (
    <ChartContainer
      config={{
        model: { label: "Model (cumulative bp)", color: COLORS.pred },
        baseline: { label: "Funding-only (cumulative bp)", color: BASE },
      }}
      className="aspect-auto h-[240px] w-full"
    >
      <LineChart data={data} margin={{ left: 4, right: 4, top: 8 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="ts" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={fmtTs} tickLine={false} axisLine={false} minTickGap={40} className="text-xs" />
        <YAxis tickLine={false} axisLine={false} width={40} className="text-xs" />
        <ReferenceLine y={0} stroke="currentColor" opacity={0.3} />
        <ChartTooltip content={<ChartTooltipContent labelFormatter={(_, p) => fmtTs(Number(p?.[0]?.payload?.ts))} />} />
        <ChartLegend content={<ChartLegendContent className="flex-wrap" />} />
        <Line dataKey="model" type="stepAfter" stroke="var(--color-model)" strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
        <Line dataKey="baseline" type="stepAfter" stroke="var(--color-baseline)" strokeDasharray="4 3" dot={false} connectNulls isAnimationActive={false} />
      </LineChart>
    </ChartContainer>
  );
}

function Section({ n, title, desc, children }: { n: number; title: string; desc: string; children: ReactNode }) {
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

function Table({ head, rows }: { head: ReactNode[]; rows: ReactNode[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs font-mono">
        <thead className="text-muted-foreground">
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
