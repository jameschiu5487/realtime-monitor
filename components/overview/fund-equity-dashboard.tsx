"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  XAxis,
  YAxis,
} from "recharts";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { createClient } from "@/lib/supabase/client";
import type { FundAccountEquity } from "@/lib/types/database";
import { downsample } from "@/lib/utils/equity";
import {
  buildFundEquityCurve,
  computeRangeDelta,
  type FundEquityRange,
  latestByAccount,
  rangeToMs,
  summarizeByExchange,
  totalEquityFromLatest,
  upsertFundEquityRow,
} from "@/lib/utils/fund-equity";

const ranges: FundEquityRange[] = ["24h", "7d", "30d"];

const chartConfig = {
  equity: {
    label: "Total Equity",
    color: "hsl(142 76% 36%)",
  },
} satisfies ChartConfig;

function formatMoney(value: number): string {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatExchangeName(exchange: string): string {
  return exchange.length > 0
    ? `${exchange[0].toUpperCase()}${exchange.slice(1)}`
    : exchange;
}

export function FundEquityDashboard({
  initialData,
  fetchError,
}: {
  initialData: FundAccountEquity[];
  fetchError?: string | null;
}) {
  const [rows, setRows] = useState(initialData);
  const [range, setRange] = useState<FundEquityRange>("24h");
  const [expandedExchanges, setExpandedExchanges] = useState<Set<string>>(
    new Set()
  );
  const [live, setLive] = useState(true);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`fund-equity-${Date.now()}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "fund_account_equity",
        },
        (payload) => {
          const row = payload.new as FundAccountEquity;
          setRows((prev) => upsertFundEquityRow(prev, row));
        }
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") setLive(true);
        if (
          status === "CHANNEL_ERROR" ||
          status === "TIMED_OUT" ||
          status === "CLOSED"
        ) {
          setLive(false);
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const latest = useMemo(() => latestByAccount(rows), [rows]);
  const total = useMemo(() => totalEquityFromLatest(latest), [latest]);
  const exchanges = useMemo(() => summarizeByExchange(latest), [latest]);
  const sinceMs = useMemo(() => Date.now() - rangeToMs(range), [range]);
  const curve = useMemo(
    () => downsample(buildFundEquityCurve(rows, sinceMs)),
    [rows, sinceMs]
  );
  const { delta, deltaPct } = useMemo(
    () => computeRangeDelta(curve, total),
    [curve, total]
  );
  const yDomain = useMemo<[number, number]>(() => {
    if (curve.length === 0) return [0, 1];
    const values = curve.map((point) => point.equity);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const padding = Math.max((max - min) * 0.08, Math.abs(max) * 0.01, 1);
    return [min - padding, max + padding];
  }, [curve]);

  function toggleExchange(exchange: string) {
    setExpandedExchanges((current) => {
      const next = new Set(current);
      if (next.has(exchange)) {
        next.delete(exchange);
      } else {
        next.add(exchange);
      }
      return next;
    });
  }

  if (fetchError) {
    return (
      <Card>
        <CardContent className="text-sm text-destructive">
          {fetchError}
        </CardContent>
      </Card>
    );
  }

  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="text-sm text-muted-foreground">
          尚無帳戶權益資料
        </CardContent>
      </Card>
    );
  }

  const deltaColor = delta >= 0 ? "text-emerald-600" : "text-red-600";
  const deltaSign = delta >= 0 ? "+" : "";

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold tracking-tight">Fund Equity</h2>
        {live ? (
          <div className="flex items-center gap-2 text-xs font-medium text-emerald-600">
            <span className="size-2 rounded-full bg-emerald-500" />
            Live
          </div>
        ) : (
          <div className="text-xs font-medium text-muted-foreground">
            即時更新暫停
          </div>
        )}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Total Balance
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="font-mono text-3xl font-semibold tracking-tight">
            ${formatMoney(total)}
          </div>
          <div className="mt-2 flex items-center gap-2 text-sm">
            <span className={deltaColor}>
              {deltaSign}${formatMoney(delta)}
              {deltaPct === null
                ? ""
                : ` (${deltaSign}${deltaPct.toFixed(2)}%)`}
            </span>
            <span className="text-muted-foreground">{range}</span>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-3">
        {exchanges.map(({ exchange, total: exchangeTotal, accounts }) => {
          const expanded = expandedExchanges.has(exchange);

          return (
            <Card key={exchange} className="gap-0 py-0">
              <button
                type="button"
                className="w-full rounded-xl text-left outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring"
                aria-expanded={expanded}
                onClick={() => toggleExchange(exchange)}
              >
                <CardHeader className="grid-cols-[1fr_auto] items-center gap-3 py-5">
                  <div className="space-y-1.5">
                    <CardTitle>{formatExchangeName(exchange)}</CardTitle>
                    <div className="font-mono text-lg font-semibold">
                      ${formatMoney(exchangeTotal)}
                    </div>
                  </div>
                  {expanded ? (
                    <ChevronDown className="size-4 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="size-4 text-muted-foreground" />
                  )}
                </CardHeader>
              </button>

              {expanded && (
                <CardContent className="border-t py-4">
                  <div className="space-y-3">
                    {accounts.map((account) => (
                      <div
                        key={account.account_id}
                        className="flex items-center justify-between gap-3 text-sm"
                      >
                        <span className="truncate font-mono text-muted-foreground">
                          {account.account_id}
                        </span>
                        <span className="shrink-0 font-mono font-medium">
                          ${formatMoney(account.total_equity)}
                        </span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              )}
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader className="grid-cols-[1fr_auto] items-center gap-3">
          <CardTitle>Equity Curve</CardTitle>
          <div className="flex items-center gap-1">
            {ranges.map((option) => (
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
        </CardHeader>
        <CardContent>
          <ChartContainer
            config={chartConfig}
            className="h-[300px] w-full aspect-auto"
          >
            <AreaChart
              accessibilityLayer
              data={curve}
              margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
            >
              <defs>
                <linearGradient
                  id="fillFundEquity"
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop
                    offset="5%"
                    stopColor="hsl(142 76% 36%)"
                    stopOpacity={0.8}
                  />
                  <stop
                    offset="95%"
                    stopColor="hsl(142 76% 36%)"
                    stopOpacity={0.1}
                  />
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
                  new Date(Number(value)).toLocaleString(undefined, {
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
                  if (Math.abs(amount) >= 1_000_000) {
                    return `$${(amount / 1_000_000).toFixed(1)}M`;
                  }
                  if (Math.abs(amount) >= 1_000) {
                    return `$${(amount / 1_000).toFixed(1)}K`;
                  }
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
                        ? new Date(time).toLocaleString()
                        : "Invalid Date";
                    }}
                    formatter={(value) => (
                      <div className="flex w-full items-center justify-between gap-4">
                        <span className="text-muted-foreground">
                          Total Equity
                        </span>
                        <span className="font-mono font-medium">
                          ${formatMoney(Number(value))}
                        </span>
                      </div>
                    )}
                  />
                }
              />
              <Area
                dataKey="equity"
                name="Total Equity"
                type="monotone"
                fill="url(#fillFundEquity)"
                stroke="hsl(142 76% 36%)"
                strokeWidth={2}
              />
            </AreaChart>
          </ChartContainer>
        </CardContent>
      </Card>
    </section>
  );
}
