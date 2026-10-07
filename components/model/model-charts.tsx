"use client";

import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  Scatter,
  ScatterChart,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  MIN_EVENT_N,
  histograms,
  type CalibrationBin,
  type EventPoint,
  type HistogramBin,
  type ScoredRow,
} from "@/lib/model-metrics";
import { formatDateTime } from "@/lib/time";

export const COLORS = {
  pred: "#60a5fa",
  truth: "#34d399",
  error: "#f59e0b",
  cumulative: "#a78bfa",
};

const fmtTs = (ms: number) =>
  formatDateTime(ms, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

/* ------------------------------------------------------------------ */
/* IC per settlement                                                    */
/* ------------------------------------------------------------------ */

const icConfig = {
  ic: { label: "IC (this settlement)", color: COLORS.pred },
  rankIc: { label: "Rank IC (this settlement)", color: COLORS.truth },
  cumulativeIc: { label: "Cumulative IC (pooled, dashed)", color: COLORS.cumulative },
  n: { label: "Symbols scored (bars)", color: "#94a3b8" },
} satisfies ChartConfig;

const TOOLTIP_LABELS: Record<string, string> = {
  ic: "IC",
  rankIc: "Rank IC",
  cumulativeIc: "Cumulative IC",
  n: "Symbols",
};

export function IcTrendChart({ events }: { events: EventPoint[] }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">IC per settlement</CardTitle>
        <CardDescription className="text-xs">
          Cross-sectional IC of each settlement (only when it has ≥{MIN_EVENT_N} symbols — hourly
          settlements usually carry 2), plus the pooled IC of everything up to that point.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-2 sm:px-6">
        {events.length === 0 ? (
          <Empty />
        ) : (
          <ChartContainer config={icConfig} className="aspect-auto h-[240px] w-full">
            <ComposedChart data={events} margin={{ left: 4, right: 4, top: 8 }}>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="fundingTs"
                type="number"
                scale="time"
                domain={["dataMin", "dataMax"]}
                tickFormatter={fmtTs}
                tickLine={false}
                axisLine={false}
                minTickGap={40}
                className="text-xs"
              />
              <YAxis
                yAxisId="ic"
                domain={[-1, 1]}
                tickLine={false}
                axisLine={false}
                width={32}
                className="text-xs"
              />
              <YAxis yAxisId="n" orientation="right" hide />
              <ReferenceLine yAxisId="ic" y={0} stroke="currentColor" opacity={0.3} />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    labelFormatter={(_, p) => fmtTs(Number(p?.[0]?.payload?.fundingTs))}
                    formatter={(v, name) => (
                      <span className="font-mono">
                        {TOOLTIP_LABELS[name as string] ?? name}:{" "}
                        {typeof v === "number" ? (name === "n" ? v : v.toFixed(3)) : "—"}
                      </span>
                    )}
                  />
                }
              />
              <ChartLegend content={<ChartLegendContent className="flex-wrap" />} />
              <Bar yAxisId="n" dataKey="n" fill="var(--color-n)" opacity={0.25} />
              <Line
                yAxisId="ic"
                dataKey="ic"
                stroke="var(--color-ic)"
                dot={{ r: 2 }}
                connectNulls
                isAnimationActive={false}
              />
              <Line
                yAxisId="ic"
                dataKey="rankIc"
                stroke="var(--color-rankIc)"
                dot={{ r: 2 }}
                connectNulls
                isAnimationActive={false}
              />
              <Line
                yAxisId="ic"
                dataKey="cumulativeIc"
                stroke="var(--color-cumulativeIc)"
                strokeWidth={2}
                strokeDasharray="4 3"
                dot={false}
                connectNulls
                isAnimationActive={false}
              />
            </ComposedChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Scatter + calibration                                                */
/* ------------------------------------------------------------------ */

const scatterConfig = {
  points: { label: "Prediction", color: COLORS.pred },
} satisfies ChartConfig;

const calibrationConfig = {
  meanPred: { label: "Mean ypred", color: COLORS.pred },
  meanTrue: { label: "Mean y_true", color: COLORS.truth },
} satisfies ChartConfig;

export function ScatterCalibration({
  rows,
  bins,
}: {
  rows: ScoredRow[];
  bins: CalibrationBin[];
}) {
  const points = useMemo(
    () => rows.map((r) => ({ x: r.ypred, y: r.yTrue, symbol: r.symbol, ts: r.fundingTs })),
    [rows]
  );
  // Symmetric domain on both axes so the y = x diagonal is a true 45°.
  const lim = useMemo(() => {
    const vals = points.flatMap((p) => [Math.abs(p.x), Math.abs(p.y)]).sort((a, b) => a - b);
    const q = vals[Math.floor(vals.length * 0.99)] ?? 1;
    return Math.max(1, Math.ceil(q));
  }, [points]);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">ypred vs y_true</CardTitle>
          <CardDescription className="text-xs">
            bp. Dashed line is y = x; axes clip at the 99th percentile.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-2 sm:px-6">
          {points.length === 0 ? (
            <Empty />
          ) : (
            <ChartContainer config={scatterConfig} className="aspect-square max-h-[320px] w-full">
              <ScatterChart margin={{ left: 4, right: 8, top: 8, bottom: 4 }}>
                <CartesianGrid />
                <XAxis
                  type="number"
                  dataKey="x"
                  name="ypred"
                  domain={[-lim, lim]}
                  allowDataOverflow
                  tickLine={false}
                  className="text-xs"
                />
                <YAxis
                  type="number"
                  dataKey="y"
                  name="y_true"
                  domain={[-lim, lim]}
                  allowDataOverflow
                  tickLine={false}
                  width={32}
                  className="text-xs"
                />
                <ZAxis range={[14, 14]} />
                <ReferenceLine x={0} stroke="currentColor" opacity={0.3} />
                <ReferenceLine y={0} stroke="currentColor" opacity={0.3} />
                <ReferenceLine
                  segment={[
                    { x: -lim, y: -lim },
                    { x: lim, y: lim },
                  ]}
                  stroke="currentColor"
                  strokeDasharray="4 3"
                  opacity={0.4}
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      hideLabel
                      formatter={(_, __, item) => {
                        const p = item.payload as (typeof points)[number];
                        return (
                          <div className="font-mono text-xs space-y-0.5">
                            <div className="font-semibold">{p.symbol}</div>
                            <div>{fmtTs(p.ts)}</div>
                            <div>ypred {p.x.toFixed(2)}</div>
                            <div>y_true {p.y.toFixed(2)}</div>
                          </div>
                        );
                      }}
                    />
                  }
                />
                <Scatter data={points} fill="var(--color-points)" fillOpacity={0.55} />
              </ScatterChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Calibration by ypred decile</CardTitle>
          <CardDescription className="text-xs">
            Rows sorted by ypred into equal-count bins. A useful model shows mean y_true rising
            left to right; matching bars mean it is also well scaled.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-2 sm:px-6">
          {bins.length === 0 ? (
            <Empty />
          ) : (
            <ChartContainer config={calibrationConfig} className="aspect-auto h-[280px] w-full">
              <ComposedChart data={bins} margin={{ left: 4, right: 4, top: 8 }}>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="bin"
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(b) => `D${b}`}
                  className="text-xs"
                />
                <YAxis tickLine={false} axisLine={false} width={36} className="text-xs" />
                <ReferenceLine y={0} stroke="currentColor" opacity={0.3} />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      labelFormatter={(_, p) => {
                        const b = p?.[0]?.payload as CalibrationBin | undefined;
                        return b ? `Decile ${b.bin} · n=${b.n}` : "";
                      }}
                    />
                  }
                />
                <ChartLegend content={<ChartLegendContent />} />
                <Bar dataKey="meanPred" fill="var(--color-meanPred)" radius={2} />
                <Bar dataKey="meanTrue" fill="var(--color-meanTrue)" radius={2} />
              </ComposedChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Distributions                                                        */
/* ------------------------------------------------------------------ */

const histConfig = {
  pred: { label: "ypred", color: COLORS.pred },
  truth: { label: "y_true", color: COLORS.truth },
  error: { label: "Error (y − ypred)", color: COLORS.error },
} satisfies ChartConfig;

/** Bins across the shared 1st–99th percentile range; 30 was too coarse to see the shape. */
const BIN_COUNTS = [40, 80, 160] as const;

export function DistributionChart({ rows }: { rows: ScoredRow[] }) {
  const [binCount, setBinCount] = useState<number>(80);
  const bins: HistogramBin[] = useMemo(() => histograms(rows, binCount), [rows, binCount]);
  const width = bins.length > 1 ? bins[1].x - bins[0].x : null;
  const means = useMemo(() => {
    if (rows.length === 0) return null;
    const avg = (f: (r: ScoredRow) => number) => rows.reduce((a, r) => a + f(r), 0) / rows.length;
    return { pred: avg((r) => r.ypred), truth: avg((r) => r.yTrue) };
  }, [rows]);
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Distributions</CardTitle>
        <CardDescription className="text-xs">
          Counts on one shared bp grid (1st–99th percentile; outliers fold into the edge bins).
          A prediction spread much narrower than y_true is normal for a shrunk forecast.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 px-2 sm:px-6">
        <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
          Bins
          {BIN_COUNTS.map((n) => (
            <Button key={n} size="sm" variant={n === binCount ? "default" : "outline"} className="h-7 px-2 text-xs" onClick={() => setBinCount(n)}>
              {n}
            </Button>
          ))}
          {width != null && <span className="ml-1">≈ {width.toFixed(2)} bp each</span>}
        </div>
        {means && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-0.5" style={{ backgroundColor: COLORS.pred }} />
              Mean ypred <span className="font-mono">{means.pred.toFixed(2)} bp</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-0.5" style={{ backgroundColor: COLORS.truth }} />
              Mean y_true <span className="font-mono">{means.truth.toFixed(2)} bp</span>
            </span>
            <span className="text-muted-foreground">
              (bias {(means.truth - means.pred >= 0 ? "+" : "") + (means.truth - means.pred).toFixed(2)} bp)
            </span>
          </div>
        )}
        {bins.length === 0 ? (
          <Empty />
        ) : (
          <ChartContainer config={histConfig} className="aspect-auto h-[380px] w-full">
            <AreaChart data={bins} margin={{ left: 4, right: 4, top: 8 }}>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="x"
                type="number"
                domain={["dataMin", "dataMax"]}
                tickFormatter={(v: number) => v.toFixed(1)}
                tickLine={false}
                axisLine={false}
                minTickGap={24}
                className="text-xs"
              />
              <YAxis tickLine={false} axisLine={false} width={32} className="text-xs" />
              <ReferenceLine x={0} stroke="currentColor" strokeDasharray="3 3" opacity={0.4} />
              {means && <ReferenceLine x={means.pred} stroke={COLORS.pred} strokeWidth={2} ifOverflow="extendDomain" />}
              {means && <ReferenceLine x={means.truth} stroke={COLORS.truth} strokeWidth={2} ifOverflow="extendDomain" />}
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    labelFormatter={(_, p) => {
                      const x = p?.[0]?.payload?.x;
                      return typeof x === "number" && width != null
                        ? `${(x - width / 2).toFixed(2)} ~ ${(x + width / 2).toFixed(2)} bp`
                        : "";
                    }}
                  />
                }
              />
              <ChartLegend content={<ChartLegendContent className="flex-wrap" />} />
              {(["truth", "pred", "error"] as const).map((k) => (
                <Area
                  key={k}
                  dataKey={k}
                  type="step"
                  stroke={`var(--color-${k})`}
                  fill={`var(--color-${k})`}
                  fillOpacity={0.15}
                  strokeWidth={1.5}
                  isAnimationActive={false}
                />
              ))}
            </AreaChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}

function Empty() {
  return (
    <div className="flex h-[160px] items-center justify-center text-sm text-muted-foreground">
      No settled predictions in this window.
    </div>
  );
}
