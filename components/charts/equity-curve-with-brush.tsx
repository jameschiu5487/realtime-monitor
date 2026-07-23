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
  // Equity at the start of the run. When provided, the header also shows
  // Init Equity and PnL (current − init).
  initEquity?: number;
}

const chartConfig = {
  equity: {
    label: "Equity ($)",
    color: "hsl(var(--chart-1))",
  },
} satisfies ChartConfig;

const formatUsd = (value: number) =>
  value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function EquityCurveWithBrush({
  data,
  onRangeChange,
  initEquity,
}: EquityCurveWithBrushProps) {
  const [refAreaLeft, setRefAreaLeft] = useState<string | null>(null);
  const [refAreaRight, setRefAreaRight] = useState<string | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);

  const currentEquity = data.length > 0 ? data[data.length - 1].equity : 0;
  const hasInit = initEquity !== undefined;
  const pnl = hasInit ? currentEquity - initEquity : 0;
  const pnlNegative = pnl < 0;

  // Calculate Y-axis domain based on actual data range
  let minValue = data.length > 0 ? data[0].equity : 0;
  let maxValue = minValue;
  for (const d of data) {
    if (d.equity < minValue) minValue = d.equity;
    if (d.equity > maxValue) maxValue = d.equity;
  }
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
        <div className="flex flex-1 flex-col justify-center gap-1 px-4 py-3 sm:px-6 sm:py-5">
          <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
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
          <CardDescription className="text-xs sm:text-sm">Drag on chart to zoom</CardDescription>
        </div>
        <div className="flex">
          {hasInit && (
            <div className="flex flex-col justify-center gap-1 border-t px-3 py-2 text-left sm:border-t-0 sm:border-l sm:px-6 sm:py-5">
              <span className="text-xs text-muted-foreground whitespace-nowrap">Init Equity</span>
              <span className="text-sm font-bold leading-none sm:text-lg whitespace-nowrap">
                ${formatUsd(initEquity)}
              </span>
            </div>
          )}
          <div className="flex flex-col justify-center gap-1 border-t px-3 py-2 text-left sm:border-t-0 sm:border-l sm:px-6 sm:py-5">
            <span className="text-xs text-muted-foreground whitespace-nowrap">Current Equity</span>
            <span className="text-sm font-bold leading-none sm:text-lg text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
              ${formatUsd(currentEquity)}
            </span>
          </div>
          {hasInit && (
            <div className="flex flex-col justify-center gap-1 border-t px-3 py-2 text-left sm:border-t-0 sm:border-l sm:px-6 sm:py-5">
              <span className="text-xs text-muted-foreground whitespace-nowrap">PnL</span>
              <span
                className={`text-sm font-bold leading-none sm:text-lg whitespace-nowrap ${
                  pnlNegative
                    ? "text-red-600 dark:text-red-400"
                    : "text-emerald-600 dark:text-emerald-400"
                }`}
              >
                {pnlNegative ? "-" : "+"}${formatUsd(Math.abs(pnl))}
              </span>
            </div>
          )}
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
