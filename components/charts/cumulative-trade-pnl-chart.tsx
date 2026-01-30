"use client";

import { Line, LineChart, CartesianGrid, XAxis } from "recharts";
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

export interface CumulativePnLDataPoint {
  time: string;
  cumulative: number;
}

interface CumulativeTradePnLChartProps {
  data: CumulativePnLDataPoint[];
}

const chartConfig = {
  cumulative: {
    label: "Cumulative PnL ($)",
    color: "hsl(var(--chart-1))",
  },
} satisfies ChartConfig;

export function CumulativeTradePnLChart({ data }: CumulativeTradePnLChartProps) {
  const finalPnL = data.length > 0 ? data[data.length - 1].cumulative : 0;

  return (
    <Card>
      <CardHeader className="flex flex-col items-stretch border-b p-0 sm:flex-row">
        <div className="flex flex-1 flex-col justify-center gap-1 px-6 py-5 sm:py-6">
          <CardTitle>Cumulative Trade PnL</CardTitle>
          <CardDescription>Accumulated profit/loss over time</CardDescription>
        </div>
        <div className="flex">
          <div className="flex flex-1 flex-col justify-center gap-1 border-t px-6 py-4 text-left sm:border-t-0 sm:border-l sm:px-8 sm:py-6">
            <span className="text-xs text-muted-foreground">Final PnL</span>
            <span
              className={`text-lg font-bold leading-none sm:text-3xl ${
                finalPnL >= 0
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-red-600 dark:text-red-400"
              }`}
            >
              ${finalPnL.toFixed(2)}
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-2 sm:p-6">
        <ChartContainer config={chartConfig} className="aspect-auto h-[250px] w-full">
          <LineChart
            accessibilityLayer
            data={data}
            margin={{
              left: 12,
              right: 12,
            }}
          >
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
              cursor={false}
              content={
                <ChartTooltipContent
                  className="w-[150px]"
                  labelFormatter={(value) => {
                    const date = new Date(value);
                    return date.toLocaleString();
                  }}
                />
              }
            />
            <Line
              dataKey="cumulative"
              type="monotone"
              stroke="#34d399"
              strokeWidth={2}
              dot={false}
            />
          </LineChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
