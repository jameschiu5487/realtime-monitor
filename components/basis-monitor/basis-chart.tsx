"use client";

import { CartesianGrid, Line, LineChart, ReferenceLine, XAxis, YAxis } from "recharts";
import { format } from "date-fns";
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
import type { BasisPoint } from "@/lib/basis";

const chartConfig = {
  basis: {
    label: "Basis",
    // Tailwind v4 的 --chart-1 已是 oklch 完整色值，不可再包 hsl()
    color: "var(--chart-1)",
  },
} satisfies ChartConfig;

interface BasisChartProps {
  points: BasisPoint[];
  mode: "pct" | "abs";
  title: string;
}

export function BasisChart({ points, mode, title }: BasisChartProps) {
  // Store time as numeric string so ChartTooltipContent's labelFormatter receives
  // the raw timestamp string (typeof label === "string" branch) rather than falling
  // back to itemConfig?.label which would be "Basis"
  const data = points.map((p) => ({
    time: String(p.time),
    // bp 模式：basisPct 是百分比，×100 換算 basis points
    basis: mode === "pct" ? p.basisPct * 100 : p.basisAbs,
  }));
  const current = data.length > 0 ? data[data.length - 1].basis : null;
  const fmt = (v: number) => (mode === "pct" ? `${v.toFixed(1)} bp` : v.toFixed(4));

  return (
    <Card>
      <CardHeader className="flex flex-col items-stretch border-b p-0 sm:flex-row">
        <div className="flex flex-1 flex-col justify-center gap-1 px-6 py-5 sm:py-6">
          <CardTitle className="font-mono text-base">{title}</CardTitle>
          <CardDescription>
            {mode === "pct" ? "Basis（bp，(leg1 − leg2) / leg2）" : "價差（leg1 − leg2，USDT）"}
          </CardDescription>
        </div>
        <div className="flex">
          <div className="flex flex-1 flex-col justify-center gap-1 border-t px-6 py-4 text-left sm:border-t-0 sm:border-l sm:px-8 sm:py-6">
            <span className="text-xs text-muted-foreground">目前 Basis</span>
            <span
              className={
                "text-lg font-bold leading-none sm:text-2xl " +
                (current !== null && current >= 0
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-red-600 dark:text-red-400")
              }
            >
              {current !== null ? fmt(current) : "—"}
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-2 sm:p-6">
        <ChartContainer config={chartConfig} className="aspect-auto h-[250px] w-full sm:h-[320px]">
          <LineChart accessibilityLayer data={data} margin={{ left: 12, right: 12 }}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="time"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={48}
              tickFormatter={(value) => format(new Date(Number(value)), "MM/dd HH:mm")}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={76}
              domain={["auto", "auto"]}
              tickFormatter={(value) => fmt(Number(value))}
            />
            <ReferenceLine y={0} strokeDasharray="3 3" stroke="var(--muted-foreground)" />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  labelFormatter={(value) => format(new Date(Number(value)), "MM/dd HH:mm")}
                  formatter={(value) => fmt(Number(value))}
                />
              }
            />
            <Line
              dataKey="basis"
              type="monotone"
              stroke="var(--color-basis)"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
