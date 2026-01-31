"use client";

import { useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { EquityCurve, CombinedTrade } from "@/lib/types/database";

interface PerformanceStatsProps {
  equityCurve: EquityCurve[];
  filteredEquityCurve: EquityCurve[];
  combinedTrades: CombinedTrade[];
  filteredCombinedTrades: CombinedTrade[];
}

function formatPercent(value: number, decimals: number = 2) {
  const formatted = Math.abs(value).toFixed(decimals);
  return value >= 0 ? `${formatted}%` : `-${formatted}%`;
}

function formatNumber(value: number, decimals: number = 2) {
  return value.toFixed(decimals);
}

function getValueColor(value: number) {
  if (value > 0) return "text-emerald-600 dark:text-emerald-400";
  if (value < 0) return "text-red-600 dark:text-red-400";
  return "";
}

function StatCard({
  value,
  label,
  colored = true,
}: {
  value: string;
  label: string;
  colored?: boolean;
  numericValue?: number;
}) {
  return (
    <div className="flex flex-col items-center justify-center p-3 sm:p-4">
      <span className={cn(
        "text-lg sm:text-2xl font-bold",
        colored ? "" : ""
      )}>
        {value}
      </span>
      <span className="text-xs sm:text-sm text-muted-foreground text-center">
        {label}
      </span>
    </div>
  );
}

function ColoredStatCard({
  value,
  label,
  numericValue,
}: {
  value: string;
  label: string;
  numericValue: number;
}) {
  return (
    <div className="flex flex-col items-center justify-center p-3 sm:p-4">
      <span className={cn(
        "text-lg sm:text-2xl font-bold",
        getValueColor(numericValue)
      )}>
        {value}
      </span>
      <span className="text-xs sm:text-sm text-muted-foreground text-center">
        {label}
      </span>
    </div>
  );
}

// Calculate statistics from equity curve data
function calculateStats(equityCurve: EquityCurve[], combinedTrades: CombinedTrade[]) {
  if (equityCurve.length === 0) {
    return {
      totalReturn: 0,
      maxDrawdown: 0,
      positions: 0,
      netExposure: 0,
      annualizedReturn: 0,
      sharpeRatio: 0,
      volatility: 0,
      calmarRatio: 0,
    };
  }

  // Sort by timestamp
  const sorted = [...equityCurve].sort(
    (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime()
  );

  const firstPoint = sorted[0];
  const lastPoint = sorted[sorted.length - 1];

  // Total Return
  const initialEquity = firstPoint.total_equity;
  const finalEquity = lastPoint.total_equity;
  const totalReturn = initialEquity > 0
    ? ((finalEquity - initialEquity) / initialEquity) * 100
    : 0;

  // Max Drawdown (find the maximum drawdown_pct in the data)
  const maxDrawdown = Math.max(...sorted.map((p) => p.drawdown_pct));

  // Positions count
  const positions = combinedTrades.length;

  // Net Exposure (current)
  const netExposure = lastPoint.total_equity > 0
    ? (lastPoint.total_position_value / lastPoint.total_equity) * 100
    : 0;

  // Calculate daily returns for volatility and Sharpe
  const dailyReturns: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const prevEquity = sorted[i - 1].total_equity;
    const currEquity = sorted[i].total_equity;
    if (prevEquity > 0) {
      dailyReturns.push((currEquity - prevEquity) / prevEquity);
    }
  }

  // Calculate period in days
  const startTime = new Date(firstPoint.ts).getTime();
  const endTime = new Date(lastPoint.ts).getTime();
  const periodDays = Math.max(1, (endTime - startTime) / (1000 * 60 * 60 * 24));

  // Annualized Return (compound)
  const annualizedReturn = periodDays > 0
    ? (Math.pow(1 + totalReturn / 100, 365 / periodDays) - 1) * 100
    : 0;

  // Volatility (annualized) - standard deviation of returns * sqrt(252)
  let volatility = 0;
  if (dailyReturns.length > 1) {
    const meanReturn = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
    const variance = dailyReturns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / (dailyReturns.length - 1);
    const dailyStd = Math.sqrt(variance);
    // Assume hourly data, annualize based on ~8760 hours per year
    const hoursPerYear = 8760;
    const avgHoursBetweenPoints = periodDays * 24 / sorted.length;
    const periodsPerYear = hoursPerYear / avgHoursBetweenPoints;
    volatility = dailyStd * Math.sqrt(periodsPerYear) * 100;
  }

  // Sharpe Ratio (assuming 0% risk-free rate)
  const sharpeRatio = volatility > 0 ? annualizedReturn / volatility : 0;

  // Calmar Ratio (annualized return / max drawdown)
  const calmarRatio = maxDrawdown > 0 ? annualizedReturn / maxDrawdown : 0;

  return {
    totalReturn,
    maxDrawdown,
    positions,
    netExposure,
    annualizedReturn,
    sharpeRatio,
    volatility,
    calmarRatio,
  };
}

export function PerformanceStats({
  equityCurve,
  filteredEquityCurve,
  combinedTrades,
  filteredCombinedTrades,
}: PerformanceStatsProps) {
  // Calculate real-time stats (all data)
  const realtimeStats = useMemo(
    () => calculateStats(equityCurve, combinedTrades),
    [equityCurve, combinedTrades]
  );

  // Calculate filtered stats (based on time range)
  const filteredStats = useMemo(
    () => calculateStats(filteredEquityCurve, filteredCombinedTrades),
    [filteredEquityCurve, filteredCombinedTrades]
  );

  return (
    <Card>
      <CardContent className="p-0">
        {/* Row 1: Realtime stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 border-b">
          <ColoredStatCard
            value={formatPercent(realtimeStats.totalReturn)}
            label="Total Return"
            numericValue={realtimeStats.totalReturn}
          />
          <ColoredStatCard
            value={formatPercent(-realtimeStats.maxDrawdown)}
            label="Max Drawdown"
            numericValue={-realtimeStats.maxDrawdown}
          />
          <StatCard
            value={String(realtimeStats.positions)}
            label="Positions"
            colored={false}
          />
          <StatCard
            value={formatPercent(realtimeStats.netExposure)}
            label="Net Exposure"
            colored={false}
          />
        </div>

        {/* Row 2: Period-based stats (filtered by time range) */}
        <div className="grid grid-cols-2 sm:grid-cols-4">
          <ColoredStatCard
            value={formatPercent(filteredStats.annualizedReturn)}
            label="Annualized Return"
            numericValue={filteredStats.annualizedReturn}
          />
          <ColoredStatCard
            value={formatNumber(filteredStats.sharpeRatio)}
            label="Sharpe Ratio"
            numericValue={filteredStats.sharpeRatio}
          />
          <StatCard
            value={formatPercent(filteredStats.volatility)}
            label="Volatility (Ann.)"
            colored={false}
          />
          <ColoredStatCard
            value={formatNumber(filteredStats.calmarRatio)}
            label="Calmar Ratio"
            numericValue={filteredStats.calmarRatio}
          />
        </div>
      </CardContent>
    </Card>
  );
}
