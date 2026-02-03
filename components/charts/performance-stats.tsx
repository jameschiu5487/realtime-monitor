"use client";

import { useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { EquityCurve, CombinedTrade } from "@/lib/types/database";

interface PerformanceStatsProps {
  filteredEquityCurve: EquityCurve[];
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
  const periodDays = (endTime - startTime) / (1000 * 60 * 60 * 24);

  // Annualized Return - only calculate for sufficient data periods
  // Annualizing short-term returns is statistically meaningless
  let annualizedReturn = 0;
  if (periodDays >= 30) {
    // Use compound formula for 30+ days of data
    annualizedReturn = (Math.pow(1 + totalReturn / 100, 365 / periodDays) - 1) * 100;
    // Cap to reasonable bounds
    annualizedReturn = Math.max(-500, Math.min(500, annualizedReturn));
  } else if (periodDays >= 7) {
    // For 7-30 days, use compound formula with tighter cap
    annualizedReturn = (Math.pow(1 + totalReturn / 100, 365 / periodDays) - 1) * 100;
    // Tighter cap for shorter periods
    annualizedReturn = Math.max(-200, Math.min(200, annualizedReturn));
  }
  // For periods < 7 days, annualizedReturn stays 0 (not meaningful to annualize)

  // Volatility (annualized) - standard deviation of returns * sqrt(periods per year)
  let volatility = 0;
  if (dailyReturns.length > 1 && periodDays > 0) {
    const meanReturn = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
    const variance = dailyReturns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / (dailyReturns.length - 1);
    const dailyStd = Math.sqrt(variance);
    // Calculate periods per year based on actual data frequency
    const avgHoursBetweenPoints = (periodDays * 24) / Math.max(1, sorted.length - 1);
    const hoursPerYear = 8760;
    const periodsPerYear = hoursPerYear / Math.max(0.1, avgHoursBetweenPoints);
    volatility = dailyStd * Math.sqrt(periodsPerYear) * 100;
    // Cap volatility to reasonable bounds (0% to 200%)
    volatility = Math.min(200, volatility);
  }

  // Sharpe Ratio (assuming 0% risk-free rate)
  // Cap to reasonable bounds (-5 to 5)
  let sharpeRatio = volatility > 0 ? annualizedReturn / volatility : 0;
  sharpeRatio = Math.max(-5, Math.min(5, sharpeRatio));

  // Calmar Ratio (annualized return / max drawdown)
  // Cap to reasonable bounds (-20 to 20)
  let calmarRatio = maxDrawdown > 0 ? annualizedReturn / maxDrawdown : 0;
  calmarRatio = Math.max(-20, Math.min(20, calmarRatio));

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
  filteredEquityCurve,
  filteredCombinedTrades,
}: PerformanceStatsProps) {
  // Calculate stats based on selected time range
  const stats = useMemo(
    () => calculateStats(filteredEquityCurve, filteredCombinedTrades),
    [filteredEquityCurve, filteredCombinedTrades]
  );

  return (
    <Card>
      <CardContent className="p-0">
        {/* Row 1: Return and risk metrics */}
        <div className="grid grid-cols-2 sm:grid-cols-4 border-b">
          <ColoredStatCard
            value={formatPercent(stats.totalReturn)}
            label="Total Return"
            numericValue={stats.totalReturn}
          />
          <ColoredStatCard
            value={formatPercent(-stats.maxDrawdown)}
            label="Max Drawdown"
            numericValue={-stats.maxDrawdown}
          />
          <StatCard
            value={String(stats.positions)}
            label="Positions"
            colored={false}
          />
          <StatCard
            value={formatPercent(stats.netExposure)}
            label="Net Exposure"
            colored={false}
          />
        </div>

        {/* Row 2: Annualized metrics */}
        <div className="grid grid-cols-2 sm:grid-cols-4">
          <ColoredStatCard
            value={formatPercent(stats.annualizedReturn)}
            label="Annualized Return"
            numericValue={stats.annualizedReturn}
          />
          <ColoredStatCard
            value={formatNumber(stats.sharpeRatio)}
            label="Sharpe Ratio"
            numericValue={stats.sharpeRatio}
          />
          <StatCard
            value={formatPercent(stats.volatility)}
            label="Volatility (Ann.)"
            colored={false}
          />
          <ColoredStatCard
            value={formatNumber(stats.calmarRatio)}
            label="Calmar Ratio"
            numericValue={stats.calmarRatio}
          />
        </div>
      </CardContent>
    </Card>
  );
}
