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

function formatCurrency(value: number) {
  if (value >= 1000000) {
    return `$${(value / 1000000).toFixed(2)}M`;
  } else if (value >= 1000) {
    return `$${(value / 1000).toFixed(2)}K`;
  }
  return `$${value.toFixed(2)}`;
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
      totalTurnover: 0,
      turnoverRate: 0,
      dailyTurnoverRate: 0,
      pnlPerTurnoverBps: 0,
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

  // Calculate period in days
  const startTime = new Date(firstPoint.ts).getTime();
  const endTime = new Date(lastPoint.ts).getTime();
  const periodDays = (endTime - startTime) / (1000 * 60 * 60 * 24);

  // Annualized Return (linear): total_return * (365 / days)
  let annualizedReturn = 0;
  if (periodDays > 0) {
    annualizedReturn = totalReturn * (365 / periodDays);
  }

  // Calculate simple returns: r_t = (E_t - E_(t-1)) / E_(t-1)
  const simpleReturns: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const prevEquity = sorted[i - 1].total_equity;
    const currEquity = sorted[i].total_equity;
    if (prevEquity > 0) {
      simpleReturns.push((currEquity - prevEquity) / prevEquity);
    }
  }

  // Calculate N (periods per year) based on actual data frequency
  const totalHours = periodDays * 24;
  const numIntervals = Math.max(1, sorted.length - 1);
  const avgHoursBetweenPoints = totalHours / numIntervals;
  const hoursPerYear = 8760; // 365 * 24
  const N = hoursPerYear / Math.max(0.1, avgHoursBetweenPoints);

  // Risk-free rate (annual)
  const rf = 0.02;

  // Calculate volatility, Sharpe, and Calmar from simple returns
  let volatility = 0;
  let sharpeRatio = 0;
  let calmarRatio = 0;

  if (simpleReturns.length > 1) {
    const meanReturn = simpleReturns.reduce((a, b) => a + b, 0) / simpleReturns.length;
    const variance = simpleReturns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / (simpleReturns.length - 1);
    const std = Math.sqrt(variance);

    // Annualized return for Sharpe/Calmar: mean(r) * N (consistent scaling)
    const annReturnForRatios = meanReturn * N * 100; // as percentage

    // Annualized Volatility: std(r) * sqrt(N) * 100 (as percentage)
    volatility = std * Math.sqrt(N) * 100;

    // Sharpe Ratio: (mean(r) - rf/N) / std(r) * sqrt(N)
    if (std > 0) {
      sharpeRatio = (meanReturn - rf / N) / std * Math.sqrt(N);
    }

    // Calmar Ratio: annualized_return / |MDD|
    // Using same annualized return as Sharpe for consistency
    if (maxDrawdown > 0) {
      calmarRatio = annReturnForRatios / maxDrawdown;
    }
  }

  // Total Turnover: entry + exit notional values
  const totalTurnover = combinedTrades.reduce((sum, trade) => {
    const entryNotional = Math.abs(trade.quantity * trade.entry_price);
    const exitNotional = trade.exit_price
      ? Math.abs(trade.quantity * trade.exit_price)
      : 0;
    return sum + entryNotional + exitNotional;
  }, 0);

  // Turnover Rate: total turnover / initial equity
  const turnoverRate = initialEquity > 0 ? totalTurnover / initialEquity : 0;

  // Daily Turnover Rate: turnover rate / period in days
  const dailyTurnoverRate = periodDays > 0 ? turnoverRate / periodDays : 0;

  // PnL per Turnover in basis points
  const totalPnl = combinedTrades.reduce(
    (sum, trade) => sum + (trade.total_pnl ?? 0),
    0
  );
  const pnlPerTurnoverBps = totalTurnover > 0 ? (totalPnl / totalTurnover) * 10000 : 0;

  return {
    totalReturn,
    maxDrawdown,
    positions,
    netExposure,
    annualizedReturn,
    sharpeRatio,
    volatility,
    calmarRatio,
    totalTurnover,
    turnoverRate,
    dailyTurnoverRate,
    pnlPerTurnoverBps,
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
        <div className="grid grid-cols-2 sm:grid-cols-4 border-b">
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

        {/* Row 3: Turnover metrics */}
        <div className="grid grid-cols-2 sm:grid-cols-4">
          <StatCard
            value={formatCurrency(stats.totalTurnover)}
            label="Total Turnover"
            colored={false}
          />
          <StatCard
            value={formatNumber(stats.turnoverRate, 2) + "x"}
            label="Turnover Rate"
            colored={false}
          />
          <StatCard
            value={formatNumber(stats.dailyTurnoverRate, 4) + "x"}
            label="Daily Turnover Rate"
            colored={false}
          />
          <ColoredStatCard
            value={formatNumber(stats.pnlPerTurnoverBps, 2)}
            label="PnL/Turnover (bp)"
            numericValue={stats.pnlPerTurnoverBps}
          />
        </div>
      </CardContent>
    </Card>
  );
}
