"use client";

import { useMemo } from "react";
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

export interface ExposureDataPoint {
  time: string;
  binance_exposure: number;
  bybit_exposure: number;
  total_exposure: number;
}

interface ExposureChartProps {
  data: ExposureDataPoint[];
}

const chartConfig = {
  binance_exposure: {
    label: "Binance",
    color: "#f0b90b", // Binance yellow
  },
  bybit_exposure: {
    label: "Bybit",
    color: "#f7a600", // Bybit orange
  },
} satisfies ChartConfig;

export function ExposureChart({ data }: ExposureChartProps) {
  const currentExposure = data.length > 0 ? data[data.length - 1].total_exposure : 0;
  const currentBinance = data.length > 0 ? data[data.length - 1].binance_exposure : 0;
  const currentBybit = data.length > 0 ? data[data.length - 1].bybit_exposure : 0;

  // Calculate Y-axis domain
  const { yMin, yMax } = useMemo(() => {
    if (data.length === 0) return { yMin: 0, yMax: 100 };
    const allValues = data.flatMap((d) => [d.binance_exposure, d.bybit_exposure, d.total_exposure]);
    const max = Math.max(...allValues);
    const padding = max * 0.1 || 10;
    return {
      yMin: 0,
      yMax: Math.ceil(max + padding),
    };
  }, [data]);

  return (
    <Card>
      <CardHeader className="flex flex-col items-stretch border-b p-0 sm:flex-row">
        <div className="flex flex-1 flex-col justify-center gap-1 px-4 py-3 sm:px-6 sm:py-6">
          <CardTitle className="text-base sm:text-lg">Exposure</CardTitle>
          <CardDescription className="text-xs sm:text-sm">Portfolio exposure by exchange</CardDescription>
        </div>
        <div className="flex">
          <div className="flex flex-1 flex-col justify-center gap-1 border-t px-2 py-2 text-left sm:border-t-0 sm:border-l sm:px-6 sm:py-6">
            <span className="text-xs text-muted-foreground">Binance</span>
            <span className="text-sm font-bold leading-none sm:text-2xl" style={{ color: "#f0b90b" }}>
              {currentBinance.toFixed(1)}%
            </span>
          </div>
          <div className="flex flex-1 flex-col justify-center gap-1 border-t border-l px-2 py-2 text-left sm:border-t-0 sm:px-6 sm:py-6">
            <span className="text-xs text-muted-foreground">Bybit</span>
            <span className="text-sm font-bold leading-none sm:text-2xl" style={{ color: "#f7a600" }}>
              {currentBybit.toFixed(1)}%
            </span>
          </div>
          <div className="flex flex-1 flex-col justify-center gap-1 border-t border-l px-2 py-2 text-left sm:border-t-0 sm:px-6 sm:py-6">
            <span className="text-xs text-muted-foreground">Total</span>
            <span className="text-sm font-bold leading-none sm:text-2xl text-emerald-600 dark:text-emerald-400">
              {currentExposure.toFixed(1)}%
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-2 sm:p-6">
        <ChartContainer config={chartConfig} className="aspect-auto h-[200px] sm:h-[250px] w-full">
          <AreaChart
            data={data}
            margin={{
              left: 12,
              right: 12,
            }}
          >
            <defs>
              <linearGradient id="fillBinanceExposure" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#f0b90b" stopOpacity={0.8} />
                <stop offset="95%" stopColor="#f0b90b" stopOpacity={0.1} />
              </linearGradient>
              <linearGradient id="fillBybitExposure" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#f7a600" stopOpacity={0.8} />
                <stop offset="95%" stopColor="#f7a600" stopOpacity={0.1} />
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
                return date.toLocaleString("en-US", {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                  hour12: false,
                });
              }}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              domain={[yMin, yMax]}
              tickFormatter={(value) => `${value.toFixed(0)}%`}
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
                  formatter={(value, name) => {
                    const label = name === "binance_exposure" ? "Binance" : name === "bybit_exposure" ? "Bybit" : "Total";
                    return [`${Number(value).toFixed(1)}%`, label];
                  }}
                />
              }
            />
            <Area
              dataKey="binance_exposure"
              type="monotone"
              fill="url(#fillBinanceExposure)"
              stroke="#f0b90b"
              strokeWidth={2}
              stackId="1"
            />
            <Area
              dataKey="bybit_exposure"
              type="monotone"
              fill="url(#fillBybitExposure)"
              stroke="#f7a600"
              strokeWidth={2}
              stackId="1"
            />
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
