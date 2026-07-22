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
import { exchangeCardClass } from "@/lib/utils/fund-account-strategy";
import { cn } from "@/lib/utils";
import {
  buildFundEquityCurve,
  type FundEquityRange,
  latestByAccount,
  rangeToMs,
  summarizeByExchange,
  totalEquityFromLatest,
  upsertFundEquityRow,
} from "@/lib/utils/fund-equity";

const ranges: FundEquityRange[] = ["24h", "7d", "30d"];
const ROW_RETENTION_MS = rangeToMs("30d") + 60 * 60 * 1000;
const NOW_REFRESH_MS = 60 * 1000;

const chartConfig = {
  equity: {
    label: "Total Equity",
    color: "hsl(142 76% 36%)",
  },
} satisfies ChartConfig;

function formatMoney(value: number): string {
  // Fixed locale avoids SSR/client hydration mismatches.
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatExchangeName(exchange: string): string {
  return exchange.length > 0
    ? `${exchange[0].toUpperCase()}${exchange.slice(1)}`
    : exchange;
}

function pruneOldRows(
  rows: FundAccountEquity[],
  nowMs: number
): FundAccountEquity[] {
  const cutoffMs = nowMs - ROW_RETENTION_MS;
  return rows.filter((row) => new Date(row.ts).getTime() >= cutoffMs);
}

export function FundEquityDashboard({
  initialData,
  fetchError,
  shareRatio = 1,
  accountStrategies = {},
  onSummaryChange,
}: {
  initialData: FundAccountEquity[];
  fetchError?: string | null;
  /** From user_strategy_access via deriveFundShareRatio; scales all displayed amounts. */
  shareRatio?: number;
  /** account_id → strategy names for running realtime / test-realtime runs. */
  accountStrategies?: Record<string, string[]>;
  onSummaryChange?: (summary: { total: number; accountCount: number }) => void;
}) {
  const [rows, setRows] = useState(initialData);
  const [range, setRange] = useState<FundEquityRange>("24h");
  const exchangesWithStrategies = useMemo(() => {
    const set = new Set<string>();
    for (const [accountId, names] of Object.entries(accountStrategies)) {
      if (names.length === 0) continue;
      const exchange = accountId.split("_")[0];
      if (exchange) set.add(exchange);
    }
    return set;
  }, [accountStrategies]);
  const [expandedExchanges, setExpandedExchanges] = useState<Set<string>>(
    () => new Set(exchangesWithStrategies)
  );
  useEffect(() => {
    setExpandedExchanges((prev) => {
      const next = new Set(prev);
      for (const exchange of exchangesWithStrategies) next.add(exchange);
      return next;
    });
  }, [exchangesWithStrategies]);
  const [live, setLive] = useState(true);
  // 0 = use data-derived clock (SSR/client first paint match); set after mount.
  const [nowMs, setNowMs] = useState(0);

  const latestDataMs = useMemo(() => {
    let max = 0;
    for (const row of rows) {
      max = Math.max(max, new Date(row.ts).getTime());
    }
    return max;
  }, [rows]);
  const effectiveNowMs = nowMs > 0 ? nowMs : latestDataMs;

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
          setRows((prev) =>
            pruneOldRows(upsertFundEquityRow(prev, row), Date.now())
          );
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

  useEffect(() => {
    const refreshNow = () => {
      const currentNowMs = Date.now();
      setNowMs(currentNowMs);
      setRows((prev) => pruneOldRows(prev, currentNowMs));
    };

    refreshNow();
    const intervalId = window.setInterval(refreshNow, NOW_REFRESH_MS);
    return () => window.clearInterval(intervalId);
  }, [range]);

  const latest = useMemo(() => latestByAccount(rows), [rows]);
  const total = useMemo(
    () => totalEquityFromLatest(latest) * shareRatio,
    [latest, shareRatio]
  );
  const exchanges = useMemo(
    () =>
      summarizeByExchange(latest).map((group) => ({
        ...group,
        total: group.total * shareRatio,
        accounts: group.accounts.map((account) => ({
          ...account,
          total_equity: account.total_equity * shareRatio,
        })),
      })),
    [latest, shareRatio]
  );
  const sinceMs = useMemo(
    () => (effectiveNowMs > 0 ? effectiveNowMs - rangeToMs(range) : 0),
    [effectiveNowMs, range]
  );
  const curve = useMemo(
    () =>
      downsample(buildFundEquityCurve(rows, sinceMs)).map((point) => ({
        ...point,
        equity: point.equity * shareRatio,
      })),
    [rows, sinceMs, shareRatio]
  );

  useEffect(() => {
    onSummaryChange?.({ total, accountCount: latest.size });
  }, [total, latest, onSummaryChange]);

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
      <section className="space-y-4">
        <Card>
          <CardContent className="text-sm text-destructive">
            {fetchError}
          </CardContent>
        </Card>
      </section>
    );
  }

  if (rows.length === 0) {
    return (
      <section className="space-y-4">
        <Card>
          <CardContent className="text-sm text-muted-foreground">
            尚無帳戶權益資料
          </CardContent>
        </Card>
      </section>
    );
  }

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

      <div className="grid gap-4 sm:grid-cols-3">
        {exchanges.map(({ exchange, total: exchangeTotal, accounts }) => {
          const expanded = expandedExchanges.has(exchange);

          return (
            <Card
              key={exchange}
              className={cn("gap-0 py-0", exchangeCardClass(exchange))}
            >
              <button
                type="button"
                className="w-full rounded-xl text-left outline-none transition-colors hover:bg-background/40 focus-visible:ring-2 focus-visible:ring-ring"
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
                <CardContent className="border-t border-inherit py-4">
                  <div className="space-y-3">
                    {accounts.map((account) => {
                      const strategies =
                        accountStrategies[account.account_id] ?? [];
                      return (
                        <div
                          key={account.account_id}
                          className="flex items-center justify-between gap-3 text-sm"
                        >
                          <div className="min-w-0 flex flex-1 items-center gap-2">
                            <span className="truncate font-mono text-muted-foreground">
                              {account.account_id}
                            </span>
                            {strategies.length > 0 && (
                              <span
                                className="truncate rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground"
                                title={strategies.join(", ")}
                              >
                                {strategies.join(", ")}
                              </span>
                            )}
                          </div>
                          <span className="shrink-0 font-mono font-medium">
                            ${formatMoney(account.total_equity)}
                          </span>
                        </div>
                      );
                    })}
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
                        ? new Date(time).toLocaleString("en-US", {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                            hour12: false,
                          })
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
