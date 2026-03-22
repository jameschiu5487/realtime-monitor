"use client";

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
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

interface DataPoint {
  time: string;
  equity: number;
  pnl: number;
  positionValue: number;
  drawdown: number;
}

interface PolymarketEquityChartProps {
  data: DataPoint[];
}

const chartConfig = {
  equity: {
    label: "Equity ($)",
    color: "hsl(var(--chart-1))",
  },
} satisfies ChartConfig;

export function PolymarketEquityChart({ data }: PolymarketEquityChartProps) {
  const currentEquity = data.length > 0 ? data[data.length - 1].equity : 0;
  const currentPnl = data.length > 0 ? data[data.length - 1].pnl : 0;

  let minValue = Infinity;
  let maxValue = -Infinity;
  for (const d of data) {
    if (d.equity < minValue) minValue = d.equity;
    if (d.equity > maxValue) maxValue = d.equity;
  }
  const padding = (maxValue - minValue) * 0.1 || 10;
  const yMin = Math.floor(minValue - padding);
  const yMax = Math.ceil(maxValue + padding);

  return (
    <Card>
      <CardHeader className="flex flex-col items-stretch border-b p-0 sm:flex-row">
        <div className="flex flex-1 flex-col justify-center gap-1 px-6 py-5 sm:py-6">
          <CardTitle>Equity Curve</CardTitle>
          <CardDescription>Total portfolio value over time</CardDescription>
        </div>
        <div className="flex">
          <div className="flex flex-1 flex-col justify-center gap-1 border-t px-6 py-4 text-left sm:border-t-0 sm:border-l sm:px-8 sm:py-6">
            <span className="text-xs text-muted-foreground">Current Equity</span>
            <span className="text-lg font-bold leading-none sm:text-3xl text-emerald-600 dark:text-emerald-400">
              ${currentEquity.toFixed(2)}
            </span>
          </div>
          <div className="flex flex-1 flex-col justify-center gap-1 border-t px-6 py-4 text-left sm:border-t-0 sm:border-l sm:px-8 sm:py-6">
            <span className="text-xs text-muted-foreground">P&L</span>
            <span
              className={`text-lg font-bold leading-none sm:text-3xl ${
                currentPnl >= 0
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-red-600 dark:text-red-400"
              }`}
            >
              {currentPnl >= 0 ? "+" : ""}${currentPnl.toFixed(2)}
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-2 sm:p-6">
        {data.length === 0 ? (
          <div className="flex items-center justify-center h-[250px] text-muted-foreground text-sm">
            No equity data yet
          </div>
        ) : (
          <ChartContainer config={chartConfig} className="aspect-auto h-[250px] w-full">
            <AreaChart data={data} margin={{ left: 12, right: 12 }}>
              <defs>
                <linearGradient id="fillPolyEquity" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#34d399" stopOpacity={0.8} />
                  <stop offset="95%" stopColor="#34d399" stopOpacity={0.1} />
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
                    hour: "2-digit",
                    minute: "2-digit",
                  });
                }}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                domain={[yMin, yMax]}
                tickFormatter={(value) => `$${value.toLocaleString()}`}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    className="w-[180px]"
                    labelFormatter={(value) => {
                      const date = new Date(value);
                      return date.toLocaleString("en-US", {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                        hour12: false,
                      });
                    }}
                  />
                }
              />
              <Area
                dataKey="equity"
                type="monotone"
                fill="url(#fillPolyEquity)"
                stroke="#34d399"
                strokeWidth={2}
              />
            </AreaChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
