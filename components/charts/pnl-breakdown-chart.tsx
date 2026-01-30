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

export interface PnLBreakdownDataPoint {
  time: string;
  funding_pnl: number;
  price_pnl: number;
  total_pnl: number;
  total_fee: number;
}

interface PnLBreakdownChartProps {
  data: PnLBreakdownDataPoint[];
}

const chartConfig = {
  funding_pnl: {
    label: "Funding PnL",
    color: "hsl(210 100% 50%)", // Blue
  },
  price_pnl: {
    label: "Price Convergence",
    color: "hsl(280 100% 60%)", // Purple
  },
  total_pnl: {
    label: "Total PnL",
    color: "hsl(142 76% 36%)", // Green
  },
} satisfies ChartConfig;

export function PnLBreakdownChart({ data }: PnLBreakdownChartProps) {
  const latestFunding = data.length > 0 ? data[data.length - 1].funding_pnl : 0;
  const latestPrice = data.length > 0 ? data[data.length - 1].price_pnl : 0;
  const latestTotal = data.length > 0 ? data[data.length - 1].total_pnl : 0;
  const latestFee = data.length > 0 ? data[data.length - 1].total_fee : 0;

  // Calculate Y-axis domain based on actual data range
  const allValues = data.flatMap((d) => [d.funding_pnl, d.price_pnl, d.total_pnl]);
  const minValue = allValues.length > 0 ? Math.min(...allValues) : 0;
  const maxValue = allValues.length > 0 ? Math.max(...allValues) : 0;
  const range = maxValue - minValue;
  const padding = range * 0.1 || 10;
  const yMin = Math.floor(minValue - padding);
  const yMax = Math.ceil(maxValue + padding);

  const formatValue = (value: number) => {
    const formatted = value.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return value >= 0 ? `$${formatted}` : `-$${formatted.replace("-", "")}`;
  };

  return (
    <Card>
      <CardHeader className="flex flex-col items-stretch border-b p-0 sm:flex-row">
        <div className="flex flex-1 flex-col justify-center gap-1 px-6 py-5 sm:py-6">
          <CardTitle>PnL Breakdown</CardTitle>
          <CardDescription>Funding, Price Convergence & Total PnL</CardDescription>
        </div>
        <div className="flex">
          <div className="flex flex-1 flex-col justify-center gap-1 border-t px-4 py-4 text-left sm:border-t-0 sm:border-l sm:px-6 sm:py-6">
            <span className="text-xs text-muted-foreground">Funding</span>
            <span className={`text-sm font-bold leading-none sm:text-lg ${latestFunding >= 0 ? "text-blue-500" : "text-red-500"}`}>
              {formatValue(latestFunding)}
            </span>
          </div>
          <div className="flex flex-1 flex-col justify-center gap-1 border-t border-l px-4 py-4 text-left sm:border-t-0 sm:px-6 sm:py-6">
            <span className="text-xs text-muted-foreground">Price</span>
            <span className={`text-sm font-bold leading-none sm:text-lg ${latestPrice >= 0 ? "text-purple-500" : "text-red-500"}`}>
              {formatValue(latestPrice)}
            </span>
          </div>
          <div className="flex flex-1 flex-col justify-center gap-1 border-t border-l px-4 py-4 text-left sm:border-t-0 sm:px-6 sm:py-6">
            <span className="text-xs text-muted-foreground">Fee</span>
            <span className="text-sm font-bold leading-none sm:text-lg text-orange-500">
              {formatValue(latestFee)}
            </span>
          </div>
          <div className="flex flex-1 flex-col justify-center gap-1 border-t border-l px-4 py-4 text-left sm:border-t-0 sm:px-6 sm:py-6">
            <span className="text-xs text-muted-foreground">Total</span>
            <span className={`text-sm font-bold leading-none sm:text-lg ${latestTotal >= 0 ? "text-emerald-500" : "text-red-500"}`}>
              {formatValue(latestTotal)}
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-2 sm:p-6">
        <ChartContainer config={chartConfig} className="aspect-auto h-[200px] sm:h-[250px] w-full">
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
                return date.toLocaleString("en-US", {
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
                  className="w-[200px]"
                  labelFormatter={(value) => {
                    const date = new Date(value);
                    return date.toLocaleString("en-US", {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    });
                  }}
                  formatter={(value, name) => (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">{name}</span>
                      <span className="font-mono font-medium">
                        {formatValue(Number(value))}
                      </span>
                    </div>
                  )}
                />
              }
            />
            <Legend />
            <Line
              dataKey="funding_pnl"
              name="Funding PnL"
              type="monotone"
              stroke="hsl(210 100% 50%)"
              strokeWidth={2}
              dot={false}
            />
            <Line
              dataKey="price_pnl"
              name="Price Convergence"
              type="monotone"
              stroke="hsl(280 100% 60%)"
              strokeWidth={2}
              dot={false}
            />
            <Line
              dataKey="total_pnl"
              name="Total PnL"
              type="monotone"
              stroke="hsl(142 76% 36%)"
              strokeWidth={2}
              dot={false}
            />
          </LineChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
