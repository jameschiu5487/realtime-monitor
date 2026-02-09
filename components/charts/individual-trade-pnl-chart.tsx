"use client";

import { Bar, BarChart, CartesianGrid, XAxis, Cell, ReferenceLine } from "recharts";
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

export interface IndividualTradePnLDataPoint {
  trade: string;
  pnl: number;
}

interface IndividualTradePnLChartProps {
  data: IndividualTradePnLDataPoint[];
}

const chartConfig = {
  pnl: {
    label: "Trade PnL ($)",
  },
  profit: {
    label: "Profit",
    color: "hsl(142 76% 36%)",
  },
  loss: {
    label: "Loss",
    color: "hsl(0 84% 60%)",
  },
} satisfies ChartConfig;

export function IndividualTradePnLChart({ data }: IndividualTradePnLChartProps) {
  const totalPnL = data.reduce((acc, curr) => acc + curr.pnl, 0);
  const winningTrades = data.filter((d) => d.pnl > 0).length;
  const winRate = data.length > 0 ? (winningTrades / data.length) * 100 : 0;

  return (
    <Card>
      <CardHeader className="flex flex-col items-stretch border-b p-0 sm:flex-row">
        <div className="flex flex-1 flex-col justify-center gap-1 px-6 py-5 sm:py-6">
          <CardTitle>Individual Trade PnL</CardTitle>
          <CardDescription>Profit/Loss per trade</CardDescription>
        </div>
        <div className="flex">
          <div className="flex flex-1 flex-col justify-center gap-1 border-t px-6 py-4 text-left sm:border-t-0 sm:border-l sm:px-8 sm:py-6">
            <span className="text-xs text-muted-foreground">Win Rate</span>
            <span
              className={`text-lg font-bold leading-none sm:text-3xl ${
                winRate >= 50
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-red-600 dark:text-red-400"
              }`}
            >
              {winRate.toFixed(1)}%
            </span>
            <span className="text-xs text-muted-foreground">
              {winningTrades}/{data.length} trades
            </span>
          </div>
          <div className="flex flex-1 flex-col justify-center gap-1 border-t px-6 py-4 text-left sm:border-t-0 sm:border-l sm:px-8 sm:py-6">
            <span className="text-xs text-muted-foreground">Total PnL</span>
            <span
              className={`text-lg font-bold leading-none sm:text-3xl ${
                totalPnL >= 0
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-red-600 dark:text-red-400"
              }`}
            >
              ${totalPnL.toFixed(2)}
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-2 sm:p-6">
        <ChartContainer config={chartConfig} className="aspect-auto h-[200px] sm:h-[250px] w-full">
          <BarChart
            accessibilityLayer
            data={data}
            margin={{
              left: 12,
              right: 12,
            }}
          >
            <defs>
              <linearGradient id="profitGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#34d399" stopOpacity={0.9} />
                <stop offset="100%" stopColor="#34d399" stopOpacity={0.4} />
              </linearGradient>
              <linearGradient id="lossGradient" x1="0" y1="1" x2="0" y2="0">
                <stop offset="0%" stopColor="#f87171" stopOpacity={0.9} />
                <stop offset="100%" stopColor="#f87171" stopOpacity={0.4} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="trade" tickLine={false} axisLine={false} tickMargin={8} />
            <ReferenceLine
              y={0}
              stroke="hsl(var(--muted-foreground))"
              strokeDasharray="3 3"
            />
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  className="w-[150px]"
                  labelFormatter={(value) => `Trade #${value}`}
                />
              }
            />
            <Bar dataKey="pnl" radius={4}>
              {data.map((entry, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={entry.pnl >= 0 ? "url(#profitGradient)" : "url(#lossGradient)"}
                />
              ))}
            </Bar>
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
