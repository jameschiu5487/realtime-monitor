"use client";

import { useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { EquityCurve, CombinedTrade } from "@/lib/types/database";

interface PerformanceStatsProps {
  filteredEquityCurve: EquityCurve[];
  filteredCombinedTrades: CombinedTrade[];
  shareRatio?: number;
  /**
   * Replaces the turnover (and the PnL it is divided into) derived from
   * combined trades. For books whose engine doesn't write combined_trades —
   * Kepler records fills in `trades` only — so turnover would read 0.
   */
  turnover?: TurnoverFigures;
}

export interface TurnoverFigures {
  notional: number;
  pnl: number;
}

/** Turnover as entry + exit notional of combined trades, with their summed PnL. */
export function combinedTradeTurnover(trades: CombinedTrade[]): TurnoverFigures {
  let notional = 0;
  let pnl = 0;
  for (const t of trades) {
    notional += Math.abs(t.quantity * t.entry_price);
    if (t.exit_price) notional += Math.abs(t.quantity * t.exit_price);
    pnl += t.total_pnl ?? 0;
  }
  return { notional, pnl };
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
function calculateStats(
  equityCurve: EquityCurve[],
  combinedTrades: CombinedTrade[],
  turnoverOverride?: TurnoverFigures
) {
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
  let maxDrawdown = 0;
  for (const p of sorted) { if (p.drawdown_pct > maxDrawdown) maxDrawdown = p.drawdown_pct; }

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

  // Build daily equity snapshots (last equity value per calendar day)
  const dailyEquityMap = new Map<string, number>();
  for (const point of sorted) {
    const day = point.ts.slice(0, 10); // YYYY-MM-DD
    dailyEquityMap.set(day, point.total_equity);
  }
  const dailyEquities = Array.from(dailyEquityMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, equity]) => equity);

  // Calculate daily returns
  const dailyReturns: number[] = [];
  for (let i = 1; i < dailyEquities.length; i++) {
    if (dailyEquities[i - 1] > 0) {
      dailyReturns.push((dailyEquities[i] - dailyEquities[i - 1]) / dailyEquities[i - 1]);
    }
  }

  const N = 365; // trading days per year (crypto = 365)
  const rf = 0.02; // annual risk-free rate

  let volatility = 0;
  let sharpeRatio = 0;
  let calmarRatio = 0;

  if (dailyReturns.length > 1) {
    const meanReturn = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
    const variance = dailyReturns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / (dailyReturns.length - 1);
    const std = Math.sqrt(variance);

    // Annualized return from daily mean
    const annReturnForRatios = meanReturn * N * 100;

    // Annualized Volatility
    volatility = std * Math.sqrt(N) * 100;

    // Sharpe Ratio: (mean_daily - rf_daily) / std_daily * sqrt(N)
    if (std > 0) {
      sharpeRatio = (meanReturn - rf / N) / std * Math.sqrt(N);
    }

    // Calmar Ratio: annualized_return / |MDD|
    if (maxDrawdown > 0) {
      calmarRatio = annReturnForRatios / maxDrawdown;
    }
  }

  // Total Turnover: entry + exit notional values
  const { notional: totalTurnover, pnl: totalPnl } =
    turnoverOverride ?? combinedTradeTurnover(combinedTrades);

  // Turnover Rate: total turnover / initial equity
  const turnoverRate = initialEquity > 0 ? totalTurnover / initialEquity : 0;

  // Daily Turnover Rate: turnover rate / period in days
  const dailyTurnoverRate = periodDays > 0 ? turnoverRate / periodDays : 0;

  // PnL per Turnover in basis points
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
  shareRatio = 1,
  turnover,
}: PerformanceStatsProps) {
  // Calculate stats based on selected time range
  const stats = useMemo(
    () => calculateStats(filteredEquityCurve, filteredCombinedTrades, turnover),
    [filteredEquityCurve, filteredCombinedTrades, turnover]
  );

  // Scale dollar-amount stats by share ratio
  const scaledTotalTurnover = stats.totalTurnover * shareRatio;

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
            value={formatCurrency(scaledTotalTurnover)}
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
