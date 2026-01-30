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
  exposure: number; // percentage 0-100+
}

interface ExposureChartProps {
  data: ExposureDataPoint[];
}

const chartConfig = {
  exposure: {
    label: "Exposure",
    color: "hsl(var(--chart-1))",
  },
} satisfies ChartConfig;

export function ExposureChart({ data }: ExposureChartProps) {
  const currentExposure = data.length > 0 ? data[data.length - 1].exposure : 0;

  // Calculate Y-axis domain
  const { yMin, yMax } = useMemo(() => {
    if (data.length === 0) return { yMin: 0, yMax: 100 };
    const values = data.map((d) => d.exposure);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const padding = (max - min) * 0.1 || 10;
    return {
      yMin: Math.max(0, Math.floor(min - padding)),
      yMax: Math.ceil(max + padding),
    };
  }, [data]);

  return (
    <Card>
      <CardHeader className="flex flex-col items-stretch border-b p-0 sm:flex-row">
        <div className="flex flex-1 flex-col justify-center gap-1 px-6 py-5 sm:py-6">
          <CardTitle>Exposure</CardTitle>
          <CardDescription>Portfolio exposure over time</CardDescription>
        </div>
        <div className="flex">
          <div className="flex flex-1 flex-col justify-center gap-1 border-t px-6 py-4 text-left sm:border-t-0 sm:border-l sm:px-8 sm:py-6">
            <span className="text-xs text-muted-foreground">Current</span>
            <span className="text-lg font-bold leading-none sm:text-3xl text-emerald-600 dark:text-emerald-400">
              {currentExposure.toFixed(1)}%
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-2 sm:p-6">
        <ChartContainer config={chartConfig} className="aspect-auto h-[250px] w-full">
          <AreaChart
            data={data}
            margin={{
              left: 12,
              right: 12,
            }}
          >
            <defs>
              <linearGradient id="fillExposure" x1="0" y1="0" x2="0" y2="1">
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
                  className="w-[150px]"
                  labelFormatter={(value) => {
                    const date = new Date(value);
                    return date.toLocaleString();
                  }}
                  formatter={(value) => [`${Number(value).toFixed(1)}%`, "Exposure"]}
                />
              }
            />
            <Area
              dataKey="exposure"
              type="monotone"
              fill="#34d399"
              fillOpacity={0.4}
              stroke="#34d399"
              strokeWidth={2}
            />
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
