"use client";

import { useState, useCallback, useRef } from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis, ReferenceArea } from "recharts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RotateCcw } from "lucide-react";
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";

export interface EquityCurveDataPoint {
  time: string;
  equity: number;
}

interface EquityCurveWithBrushProps {
  data: EquityCurveDataPoint[];
  onRangeChange?: (startTime: Date, endTime: Date) => void;
}

const chartConfig = {
  equity: {
    label: "Equity ($)",
    color: "hsl(var(--chart-1))",
  },
} satisfies ChartConfig;

export function EquityCurveWithBrush({
  data,
  onRangeChange,
}: EquityCurveWithBrushProps) {
  const [refAreaLeft, setRefAreaLeft] = useState<string | null>(null);
  const [refAreaRight, setRefAreaRight] = useState<string | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);

  const currentEquity = data.length > 0 ? data[data.length - 1].equity : 0;

  // Calculate Y-axis domain based on actual data range
  const allValues = data.map((d) => d.equity);
  const minValue = allValues.length > 0 ? Math.min(...allValues) : 0;
  const maxValue = allValues.length > 0 ? Math.max(...allValues) : 0;
  const padding = (maxValue - minValue) * 0.1 || 10;
  const yMin = Math.floor(minValue - padding);
  const yMax = Math.ceil(maxValue + padding);

  const handleMouseDown = useCallback((e: any) => {
    if (e && e.activeLabel) {
      setRefAreaLeft(e.activeLabel);
      setRefAreaRight(e.activeLabel);
      setIsSelecting(true);
    }
  }, []);

  const handleMouseMove = useCallback((e: any) => {
    if (isSelecting && e && e.activeLabel) {
      setRefAreaRight(e.activeLabel);
    }
  }, [isSelecting]);

  const handleMouseUp = useCallback(() => {
    if (refAreaLeft && refAreaRight && refAreaLeft !== refAreaRight) {
      // Determine which is start and which is end
      const leftTime = new Date(refAreaLeft);
      const rightTime = new Date(refAreaRight);

      const startTime = leftTime < rightTime ? leftTime : rightTime;
      const endTime = leftTime < rightTime ? rightTime : leftTime;

      if (onRangeChange) {
        onRangeChange(startTime, endTime);
      }
    }

    setRefAreaLeft(null);
    setRefAreaRight(null);
    setIsSelecting(false);
  }, [refAreaLeft, refAreaRight, onRangeChange]);

  const handleReset = useCallback(() => {
    if (onRangeChange && data.length > 0) {
      const startTime = new Date(data[0].time);
      const endTime = new Date(data[data.length - 1].time);
      onRangeChange(startTime, endTime);
    }
  }, [data, onRangeChange]);

  return (
    <Card>
      <CardHeader className="flex flex-col items-stretch border-b p-0 sm:flex-row">
        <div className="flex flex-1 flex-col justify-center gap-1 px-6 py-5 sm:py-6">
          <CardTitle className="flex items-center gap-2">
            Equity Curve
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={handleReset}
              title="Reset zoom"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </Button>
          </CardTitle>
          <CardDescription>Drag on chart to zoom • Click reset to restore</CardDescription>
        </div>
        <div className="flex">
          <div className="flex flex-1 flex-col justify-center gap-1 border-t px-6 py-4 text-left sm:border-t-0 sm:border-l sm:px-8 sm:py-6">
            <span className="text-xs text-muted-foreground">Current Equity</span>
            <span className="text-lg font-bold leading-none sm:text-3xl text-emerald-600 dark:text-emerald-400">
              ${currentEquity.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
          >
            <defs>
              <linearGradient id="fillEquityZoom" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(var(--chart-1))" stopOpacity={0.8} />
                <stop offset="95%" stopColor="hsl(var(--chart-1))" stopOpacity={0.1} />
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
                  className="w-[150px]"
                  labelFormatter={(value) => {
                    const date = new Date(value);
                    return date.toLocaleString();
                  }}
                />
              }
            />
            <Area
              dataKey="equity"
              type="monotone"
              fill="#34d399"
              fillOpacity={0.4}
              stroke="hsl(var(--chart-1))"
              strokeWidth={2}
            />
            {refAreaLeft && refAreaRight && (
              <ReferenceArea
                x1={refAreaLeft}
                x2={refAreaRight}
                strokeOpacity={0.3}
                fill="hsl(var(--primary))"
                fillOpacity={0.3}
              />
            )}
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
