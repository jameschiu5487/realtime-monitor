"use client";

import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, ReferenceLine, XAxis, YAxis } from "recharts";
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
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { cn } from "@/lib/utils";
import { exchangeColor, exchangeLabel } from "@/lib/exchange-colors";
import {
  buildHistogram,
  summarize,
  summarizeByExchange,
  tradesSince,
  type SlippageStats,
  type SlippageTrade,
} from "@/lib/slippage";

interface SlippageAnalysisProps {
  trades: SlippageTrade[];
  /** Days in the "recent" window, compared against the full history. */
  recentDays?: number;
}

const bps = (v: number, digits = 2) => `${v > 0 ? "+" : ""}${v.toFixed(digits)}`;

/** Positive slippage is a cost, so it reads red; negative is a rebate. */
function costClass(v: number): string {
  if (v > 0.01) return "text-red-500";
  if (v < -0.01) return "text-green-500";
  return "text-muted-foreground";
}

function StatBlock({
  title,
  subtitle,
  stats,
  compareTo,
}: {
  title: string;
  subtitle: string;
  stats: SlippageStats | null;
  compareTo?: SlippageStats | null;
}) {
  if (!stats) {
    return (
      <div className="rounded-lg border p-3">
        <div className="text-sm font-medium">{title}</div>
        <div className="text-xs text-muted-foreground">{subtitle}</div>
        <p className="mt-3 text-sm text-muted-foreground">No fills in this window</p>
      </div>
    );
  }

  // Only shown on the recent block: how its average moved against the baseline.
  const drift = compareTo ? stats.mean - compareTo.mean : null;

  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-baseline justify-between gap-2">
        <div>
          <div className="text-sm font-medium">{title}</div>
          <div className="text-xs text-muted-foreground">{subtitle}</div>
        </div>
        <span className="text-xs text-muted-foreground tabular-nums">
          {stats.count} fills
        </span>
      </div>

      <div className="mt-3 flex items-baseline gap-2">
        <span className={cn("text-2xl font-semibold tabular-nums", costClass(stats.mean))}>
          {bps(stats.mean)}
        </span>
        <span className="text-xs text-muted-foreground">bp avg cost</span>
        {drift !== null && (
          <span
            className={cn("text-xs tabular-nums", costClass(drift))}
            title="Change in average versus the full history"
          >
            {bps(drift)} vs all
          </span>
        )}
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        {[
          ["Median", bps(stats.median)],
          ["Std dev", stats.stdDev.toFixed(2)],
          ["p95", bps(stats.p95)],
          ["Worst", bps(stats.worst)],
          ["Adverse", `${(stats.adverseShare * 100).toFixed(0)}%`],
        ].map(([label, value]) => (
          <div key={label} className="flex justify-between gap-2">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/**
 * Slippage on this strategy's fills: a full-history baseline, the recent
 * window beside it, and the distribution split by venue.
 *
 * Renders nothing when the strategy has no slippage data at all —
 * trades.exec_slippage_bps only exists from 2026-08-10, so strategies that
 * stopped before then have none and an empty card would just be noise.
 */
export function SlippageAnalysis({ trades, recentDays = 7 }: SlippageAnalysisProps) {
  const view = useMemo(() => {
    if (trades.length === 0) return null;

    const since = new Date(Date.now() - recentDays * 24 * 60 * 60 * 1000);
    const recent = tradesSince(trades, since);
    const values = trades.map((t) => t.exec_slippage_bps);

    const timestamps = trades.map((t) => new Date(t.ts).getTime());
    const firstTs = new Date(Math.min(...timestamps));

    return {
      all: summarize(values),
      recent: summarize(recent.map((t) => t.exec_slippage_bps)),
      byExchange: summarizeByExchange(trades),
      histogram: buildHistogram(trades),
      firstTs,
    };
  }, [trades, recentDays]);

  if (!view || !view.all || !view.histogram) return null;

  const { all, recent, byExchange, histogram, firstTs } = view;

  const chartConfig: ChartConfig = Object.fromEntries(
    histogram.exchanges.map((e) => [
      e,
      { label: exchangeLabel(e), color: exchangeColor(e) },
    ]),
  );

  const since = firstTs.toLocaleDateString("en-US", { month: "short", day: "numeric" });

  return (
    <Card>
      <CardHeader className="px-3 sm:px-6">
        <CardTitle className="text-sm sm:text-base font-medium">
          Execution Slippage
        </CardTitle>
        <CardDescription className="text-xs sm:text-sm">
          Positive is a cost — the fill came in worse than expected. {all.count} fills
          since {since}.
        </CardDescription>
      </CardHeader>

      <CardContent className="px-3 sm:px-6 space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <StatBlock title="All time" subtitle={`since ${since}`} stats={all} />
          <StatBlock
            title="Recent"
            subtitle={`last ${recentDays} days`}
            stats={recent}
            compareTo={all}
          />
        </div>

        <div>
          <div className="text-xs text-muted-foreground mb-2">
            Distribution ({histogram.binWidth} bp bins)
          </div>
          <ChartContainer
            config={chartConfig}
            className="aspect-auto h-[200px] sm:h-[240px] w-full"
          >
            <BarChart data={histogram.bins} margin={{ left: 4, right: 4, top: 4 }}>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tickMargin={6}
                interval="preserveStartEnd"
                minTickGap={16}
                className="text-xs"
              />
              <YAxis tickLine={false} axisLine={false} width={28} className="text-xs" />
              {/* Break-even. Label comes from the histogram so it matches a real tick. */}
              {histogram.zeroLabel && (
                <ReferenceLine
                  x={histogram.zeroLabel}
                  stroke="currentColor"
                  strokeDasharray="3 3"
                  opacity={0.4}
                />
              )}
              <ChartTooltip content={<ChartTooltipContent indicator="dot" />} />
              {histogram.exchanges.map((e) => (
                <Bar
                  key={e}
                  dataKey={`counts.${e}`}
                  name={exchangeLabel(e)}
                  stackId="slippage"
                  fill={exchangeColor(e)}
                  radius={0}
                />
              ))}
            </BarChart>
          </ChartContainer>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-muted-foreground">
              <tr className="border-b">
                <th className="py-1.5 text-left font-medium">Exchange</th>
                <th className="py-1.5 text-right font-medium">Fills</th>
                <th className="py-1.5 text-right font-medium">Mean</th>
                <th className="py-1.5 text-right font-medium">Median</th>
                <th className="py-1.5 text-right font-medium">p95</th>
                <th className="py-1.5 text-right font-medium">Worst</th>
                <th className="py-1.5 text-right font-medium">Adverse</th>
              </tr>
            </thead>
            <tbody>
              {byExchange.map((row) => (
                <tr key={row.exchange} className="border-b last:border-0">
                  <td className="py-1.5">
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className="inline-block h-2 w-2 rounded-sm"
                        style={{ backgroundColor: exchangeColor(row.exchange) }}
                      />
                      {exchangeLabel(row.exchange)}
                    </span>
                  </td>
                  <td className="py-1.5 text-right tabular-nums">{row.count}</td>
                  <td className={cn("py-1.5 text-right tabular-nums", costClass(row.mean))}>
                    {bps(row.mean)}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">{bps(row.median)}</td>
                  <td className="py-1.5 text-right tabular-nums">{bps(row.p95)}</td>
                  <td className="py-1.5 text-right tabular-nums">{bps(row.worst)}</td>
                  <td className="py-1.5 text-right tabular-nums">
                    {(row.adverseShare * 100).toFixed(0)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
