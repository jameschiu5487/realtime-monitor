"use client";

import { useMemo, useState } from "react";
import { Landmark } from "lucide-react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { cn } from "@/lib/utils";
import { downsample } from "@/lib/utils/equity";
import { exchangeBadgeClass } from "@/lib/utils/fund-account-strategy";
import {
  buildFundEquityCurve,
  computeRangeDelta,
  latestByAccount,
  maxDrawdown,
  totalEquityFromLatest,
} from "@/lib/utils/fund-equity";
import type { FundAccountEquity } from "@/lib/types/database";

export const ACCOUNT_EQUITY_RANGES = ["24h", "7d", "30d", "90d"] as const;
export type AccountEquityRange = (typeof ACCOUNT_EQUITY_RANGES)[number];

const HOUR_MS = 60 * 60 * 1000;
const RANGE_MS: Record<AccountEquityRange, number> = {
  "24h": 24 * HOUR_MS,
  "7d": 7 * 24 * HOUR_MS,
  "30d": 30 * 24 * HOUR_MS,
  "90d": 90 * 24 * HOUR_MS,
};

const COLOR = "hsl(142 76% 36%)";
const chartConfig = {
  equity: { label: "Account equity", color: COLOR },
} satisfies ChartConfig;

function money(value: number, signed = false): string {
  // Fixed locale keeps SSR and hydration identical.
  const abs = `$${Math.abs(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
  if (value < 0) return `-${abs}`;
  return signed && value > 0 ? `+${abs}` : abs;
}

function tone(value: number | null) {
  if (value === null || value === 0) return "";
  return value > 0
    ? "text-emerald-600 dark:text-emerald-400"
    : "text-red-600 dark:text-red-400";
}

/** UTC so the server render and the browser agree. */
function utcMinute(ms: number): string {
  return `${new Date(ms).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

interface ParentAccountEquityProps {
  parentName: string;
  /** fund_account_equity account_ids behind the children's running live runs. */
  accountIds: string[];
  /** Rows for those accounts: hourly beyond 24h, 5-minute within it. */
  rows: FundAccountEquity[];
  /** Server clock, so ranges match between SSR and hydration. */
  nowMs: number;
  /** Viewer's share_ratio on the parent itself; null without direct access. */
  parentShareRatio: number | null;
  fetchError: string | null;
}

/**
 * Real exchange-account money behind a parent strategy.
 *
 * Deliberately NOT scaled by share_ratio: account equity is fund-level, not a
 * strategy share (docs/superpowers/specs/2026-07-21-fund-equity-dashboard-design.md).
 */
export function ParentAccountEquity({
  parentName,
  accountIds,
  rows,
  nowMs,
  parentShareRatio,
  fetchError,
}: ParentAccountEquityProps) {
  const [range, setRange] = useState<AccountEquityRange>("7d");

  const latest = useMemo(() => latestByAccount(rows), [rows]);
  const total = useMemo(() => totalEquityFromLatest(latest), [latest]);
  const lastUpdateMs = useMemo(() => {
    let max = 0;
    for (const row of latest.values()) max = Math.max(max, new Date(row.ts).getTime());
    return max;
  }, [latest]);
  const curve = useMemo(
    () => downsample(buildFundEquityCurve(rows, nowMs - RANGE_MS[range])),
    [rows, nowMs, range]
  );
  const { delta, deltaPct } = useMemo(() => computeRangeDelta(curve, total), [curve, total]);
  const drawdown = useMemo(() => maxDrawdown(curve), [curve]);
  const yDomain = useMemo<[number, number]>(() => {
    if (curve.length === 0) return [0, 1];
    const values = curve.map((p) => p.equity);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const spread = max - min;
    const padding = spread > 0 ? spread * 0.08 : Math.max(Math.abs(max) * 0.001, 1);
    return [min - padding, max + padding];
  }, [curve]);

  const hasData = rows.length > 0 && latest.size > 0;
  const showRatioNote = parentShareRatio !== null && parentShareRatio !== 1;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Landmark className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
          <h2 className="text-lg sm:text-xl font-semibold tracking-tight">Real account equity</h2>
          {accountIds.map((id) => (
            <span
              key={id}
              className={cn("rounded-md px-1.5 py-0.5 font-mono text-xs font-medium", exchangeBadgeClass(id))}
            >
              {id}
            </span>
          ))}
        </div>
        {hasData && (
          <div className="flex items-center gap-1">
            {ACCOUNT_EQUITY_RANGES.map((option) => (
              <Button
                key={option}
                type="button"
                size="sm"
                variant={range === option ? "default" : "ghost"}
                onClick={() => setRange(option)}
              >
                {option}
              </Button>
            ))}
          </div>
        )}
      </div>

      {!hasData ? (
        <Card>
          <CardContent className="space-y-1 py-6 text-center">
            <p className="text-sm font-medium">No account equity data yet</p>
            <p className="text-xs text-muted-foreground">
              {fetchError
                ? "Could not load account equity. Please refresh in a moment."
                : accountIds.length === 0
                  ? "The children's live runs do not name a trading account in params.api yet; the real account equity appears here once the trading system writes it."
                  : `No equity records for account ${accountIds.join(", ")} yet.`}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card className="gap-0 py-0">
          <div className="grid grid-cols-2 sm:grid-cols-4 border-b">
            <Figure label="Current account equity" value={money(total)} />
            <Figure
              label={`${range} change`}
              value={money(delta, true)}
              sub={deltaPct === null ? undefined : `${deltaPct >= 0 ? "+" : ""}${deltaPct.toFixed(2)}%`}
              className={tone(delta)}
            />
            <Figure
              label={`${range} max drawdown`}
              value={drawdown ? `${drawdown.pct > 0 ? "-" : ""}${drawdown.pct.toFixed(2)}%` : "—"}
              sub={drawdown && drawdown.amount > 0 ? money(-drawdown.amount) : undefined}
              className={drawdown && drawdown.pct > 0 ? "text-red-600 dark:text-red-400" : ""}
            />
            <Figure label="Last update" value={utcMinute(lastUpdateMs)} small />
          </div>
          <CardContent className="px-2 py-4 sm:px-6">
            <ChartContainer config={chartConfig} className="aspect-auto h-[240px] sm:h-[280px] w-full">
              <AreaChart accessibilityLayer data={curve} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="fillParentAccountEquity" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={COLOR} stopOpacity={0.8} />
                    <stop offset="95%" stopColor={COLOR} stopOpacity={0.1} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="time"
                  type="number"
                  scale="time"
                  domain={["dataMin", "dataMax"]}
                  tickLine={false}
                  axisLine={false}
                  tickMargin={6}
                  minTickGap={48}
                  tickFormatter={(value) =>
                    new Date(Number(value)).toLocaleString("en-US", {
                      month: range === "24h" ? undefined : "short",
                      day: range === "24h" ? undefined : "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                      hour12: false,
                    })
                  }
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tickMargin={4}
                  width={64}
                  domain={yDomain}
                  tickFormatter={(value) => {
                    const amount = Number(value);
                    if (Math.abs(amount) >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
                    if (Math.abs(amount) >= 1_000) return `$${(amount / 1_000).toFixed(1)}K`;
                    return `$${amount.toFixed(0)}`;
                  }}
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      className="w-[190px]"
                      labelFormatter={(_value, payload) => {
                        const time = payload?.[0]?.payload?.time;
                        return time
                          ? new Date(time).toLocaleString("en-US", {
                              month: "short",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                              hour12: false,
                            })
                          : "";
                      }}
                      formatter={(value) => (
                        <div className="flex w-full items-center justify-between gap-4">
                          <span className="text-muted-foreground">Account equity</span>
                          <span className="font-mono font-medium">{money(Number(value))}</span>
                        </div>
                      )}
                    />
                  }
                />
                <Area
                  dataKey="equity"
                  name="Account equity"
                  type="monotone"
                  fill="url(#fillParentAccountEquity)"
                  stroke={COLOR}
                  strokeWidth={2}
                />
              </AreaChart>
            </ChartContainer>
          </CardContent>
        </Card>
      )}

      <div className="space-y-1 text-xs text-muted-foreground">
        <p>
          <Badge variant="outline" className="mr-1.5 border-emerald-500/50 text-emerald-700 dark:text-emerald-400">
            Real
          </Badge>
          Total account equity reported by the exchange (fund_account_equity): the whole account, not scaled by share; deposits and withdrawals show up in the curve and drawdown.
          One point per 5 minutes within 24 h, hourly before that.
        </p>
        {showRatioNote && (
          <p className="text-amber-700 dark:text-amber-400">
            Your share of {parentName} (share_ratio) is {parentShareRatio}; the real account equity above is the whole account and is not scaled by it.
          </p>
        )}
      </div>
    </section>
  );
}

function Figure({
  label,
  value,
  sub,
  className,
  small,
}: {
  label: string;
  value: string;
  sub?: string;
  className?: string;
  small?: boolean;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-0.5 p-3 sm:p-4 text-center">
      <span
        className={cn(
          "font-bold font-mono",
          small ? "text-xs sm:text-sm" : "text-lg sm:text-2xl",
          className
        )}
      >
        {value}
      </span>
      {sub && <span className={cn("text-xs font-mono", className)}>{sub}</span>}
      <span className="text-xs sm:text-sm text-muted-foreground">{label}</span>
    </div>
  );
}
