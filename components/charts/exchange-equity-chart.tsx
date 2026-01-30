"use client";

import { Line, LineChart, CartesianGrid, XAxis, YAxis, Legend } from "recharts";
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

export interface ExchangeEquityDataPoint {
  time: string;
  binance: number;
  bybit: number;
}

interface ExchangeEquityChartProps {
  data: ExchangeEquityDataPoint[];
}

const chartConfig = {
  binance: {
    label: "Binance",
    color: "hsl(45 93% 47%)", // Yellow/Gold for Binance
  },
  bybit: {
    label: "Bybit",
    color: "hsl(24 100% 50%)", // Orange for Bybit
  },
} satisfies ChartConfig;

export function ExchangeEquityChart({ data }: ExchangeEquityChartProps) {
  const latestBinance = data.length > 0 ? data[data.length - 1].binance : 0;
  const latestBybit = data.length > 0 ? data[data.length - 1].bybit : 0;

  // Calculate Y-axis domain based on actual data range
  const allValues = data.flatMap((d) => [d.binance, d.bybit]);
  const minValue = Math.min(...allValues);
  const maxValue = Math.max(...allValues);
  const padding = (maxValue - minValue) * 0.1 || 10; // 10% padding
  const yMin = Math.floor(minValue - padding);
  const yMax = Math.ceil(maxValue + padding);

  return (
    <Card>
      <CardHeader className="flex flex-col items-stretch border-b p-0 sm:flex-row">
        <div className="flex flex-1 flex-col justify-center gap-1 px-6 py-5 sm:py-6">
          <CardTitle>Exchange Equity</CardTitle>
          <CardDescription>Individual exchange equity over time</CardDescription>
        </div>
        <div className="flex">
          <div className="flex flex-1 flex-col justify-center gap-1 border-t px-6 py-4 text-left sm:border-t-0 sm:border-l sm:px-8 sm:py-6">
            <span className="text-xs text-muted-foreground">Binance</span>
            <span className="text-lg font-bold leading-none sm:text-2xl text-yellow-500">
              ${latestBinance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
          <div className="flex flex-1 flex-col justify-center gap-1 border-t border-l px-6 py-4 text-left sm:border-t-0 sm:px-8 sm:py-6">
            <span className="text-xs text-muted-foreground">Bybit</span>
            <span className="text-lg font-bold leading-none sm:text-2xl text-orange-500">
              ${latestBybit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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
                      year: "numeric",
                      month: "numeric",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                      hour12: false,
                    });
                  }}
                  formatter={(value, name) => (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">{name}</span>
                      <span className="font-mono font-medium">
                        ${Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </div>
                  )}
                />
              }
            />
            <Legend />
            <Line
              dataKey="binance"
              name="Binance"
              type="monotone"
              stroke="hsl(45 93% 47%)"
              strokeWidth={2}
              dot={false}
            />
            <Line
              dataKey="bybit"
              name="Bybit"
              type="monotone"
              stroke="hsl(24 100% 50%)"
              strokeWidth={2}
              dot={false}
            />
          </LineChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
