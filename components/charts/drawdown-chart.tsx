"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  XAxis,
  ReferenceLine,
  ReferenceDot,
} from "recharts";
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

export interface DrawdownDataPoint {
  time: string;
  drawdown: number;
}

interface DrawdownChartProps {
  data: DrawdownDataPoint[];
}

const chartConfig = {
  drawdown: {
    label: "Drawdown (%)",
    color: "hsl(var(--destructive))",
  },
} satisfies ChartConfig;

export function DrawdownChart({ data }: DrawdownChartProps) {
  const maxDrawdown = data.length > 0 ? Math.min(...data.map((d) => d.drawdown)) : 0;
  const maxDrawdownPoint = data.find((d) => d.drawdown === maxDrawdown);

  return (
    <Card>
      <CardHeader className="flex flex-col items-stretch border-b p-0 sm:flex-row">
        <div className="flex flex-1 flex-col justify-center gap-1 px-6 py-5 sm:py-6">
          <CardTitle>Drawdown (%)</CardTitle>
          <CardDescription>Portfolio drawdown percentage over time</CardDescription>
        </div>
        <div className="flex">
          <div className="flex flex-1 flex-col justify-center gap-1 border-t px-6 py-4 text-left sm:border-t-0 sm:border-l sm:px-8 sm:py-6">
            <span className="text-xs text-muted-foreground">Max Drawdown</span>
            <span className="text-lg font-bold leading-none sm:text-3xl text-destructive">
              {maxDrawdown.toFixed(2)}%
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-2 sm:p-6">
        <ChartContainer config={chartConfig} className="aspect-auto h-[250px] w-full">
          <AreaChart
            accessibilityLayer
            data={data}
            margin={{
              left: 12,
              right: 12,
            }}
          >
            <defs>
              <linearGradient id="fillDrawdown" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--color-drawdown)" stopOpacity={0.8} />
                <stop offset="95%" stopColor="var(--color-drawdown)" stopOpacity={0.1} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="time"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={32}
              tickFormatter={(value) => {
                const date = new Date(value);
                return date.toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                });
              }}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  className="w-[150px]"
                  labelFormatter={(value) => {
                    const date = new Date(value);
                    return date.toLocaleString("en-US", {
                      year: "numeric",
                      month: "numeric",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                      hour12: false,
                    });
                  }}
                />
              }
            />
            <ReferenceLine
              y={0}
              stroke="hsl(var(--muted-foreground))"
              strokeDasharray="3 3"
            />
            {maxDrawdownPoint && (
              <ReferenceDot
                x={maxDrawdownPoint.time}
                y={maxDrawdownPoint.drawdown}
                r={6}
                fill="var(--color-drawdown)"
                stroke="white"
                strokeWidth={2}
              />
            )}
            <Area
              dataKey="drawdown"
              type="monotone"
              fill="#f87171"
              fillOpacity={0.4}
              stroke="var(--color-drawdown)"
              strokeWidth={2}
            />
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
