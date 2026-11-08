"use client";

import { Area, AreaChart, CartesianGrid, XAxis, YAxis, ReferenceLine } from "recharts";
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
import { formatDate, formatDateTime } from "@/lib/time";

export interface AccountReturnPoint {
  time: string;
  /** Cumulative return, percent of the account. */
  value: number;
}

interface AccountReturnChartProps {
  data: AccountReturnPoint[];
  title: string;
  description: string;
  currentLabel?: string;
}

const chartConfig = {
  value: {
    label: "Return (% of account)",
    color: "var(--chart-1)",
  },
} satisfies ChartConfig;

/** A cumulative return in percent of the account, with its latest value in the header. */
export function AccountReturnChart({
  data,
  title,
  description,
  currentLabel = "Return",
}: AccountReturnChartProps) {
  const current = data.length > 0 ? data[data.length - 1].value : 0;
  const tone =
    current > 0
      ? "text-emerald-600 dark:text-emerald-400"
      : current < 0
        ? "text-red-600 dark:text-red-400"
        : "";

  return (
    <Card>
      <CardHeader className="flex flex-col items-stretch border-b p-0 sm:flex-row">
        <div className="flex flex-1 flex-col justify-center gap-1 px-6 py-5 sm:py-6">
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
        <div className="flex">
          <div className="flex flex-1 flex-col justify-center gap-1 border-t px-6 py-4 text-left sm:border-t-0 sm:border-l sm:px-8 sm:py-6">
            <span className="text-xs text-muted-foreground">{currentLabel}</span>
            <span className={`text-lg font-bold leading-none sm:text-3xl ${tone}`}>
              {current > 0 ? "+" : ""}
              {current.toFixed(2)}%
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-2 sm:p-6">
        <ChartContainer config={chartConfig} className="aspect-auto h-[250px] sm:h-[300px] w-full">
          <AreaChart accessibilityLayer data={data} margin={{ left: 12, right: 12 }}>
            <defs>
              <linearGradient id="fillAccountReturn" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--color-value)" stopOpacity={0.6} />
                <stop offset="95%" stopColor="var(--color-value)" stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="time"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={32}
              tickFormatter={(value) => formatDate(new Date(value), { month: "short", day: "numeric" })}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={52}
              tickFormatter={(v: number) => `${v.toFixed(1)}%`}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  className="w-[170px]"
                  labelFormatter={(value) =>
                    formatDateTime(new Date(value), {
                      year: "numeric",
                      month: "numeric",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                      hour12: false,
                    })
                  }
                  formatter={(v) => `${Number(v).toFixed(2)}%`}
                />
              }
            />
            <ReferenceLine y={0} stroke="var(--muted-foreground)" strokeDasharray="3 3" />
            <Area
              dataKey="value"
              type="linear"
              fill="url(#fillAccountReturn)"
              stroke="var(--color-value)"
              strokeWidth={2}
            />
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
