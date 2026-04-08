"use client";

import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EquityCurveWithBrush } from "@/components/charts/equity-curve-with-brush";
import { cn } from "@/lib/utils";
import {
  useRealtimeEquityCurve,
  useRealtimePnlSeries,
  useRealtimePositions,
  useRealtimeTrades,
} from "@/lib/hooks/use-realtime-data";
import type { EquityCurveDataPoint } from "@/components/charts/equity-curve-chart";
import type {
  EquityCurve,
  PnlSeries,
  Position,
  Trade,
} from "@/lib/types/database";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

interface GriffinRunContentProps {
  runId: string;
  initialEquityCurve: EquityCurve[];
  initialPnlSeries: PnlSeries[];
  initialPositions: Position[];
  initialTrades: Trade[];
  initialCapital: number;
}

function formatTime(ts: string) {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDateTime(ts: string) {
  return new Date(ts).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function GriffinRunContent({
  runId,
  initialEquityCurve,
  initialPnlSeries,
  initialPositions,
  initialTrades,
  initialCapital,
}: GriffinRunContentProps) {
  // Real-time data hooks
  const { data: equityCurve } = useRealtimeEquityCurve(runId, initialEquityCurve);
  const { data: pnlSeries } = useRealtimePnlSeries(runId, initialPnlSeries);
  const { data: positions } = useRealtimePositions(runId, initialPositions);
  const { data: trades } = useRealtimeTrades(runId, initialTrades);

  // === Equity Curve Data ===
  const equityCurveData = useMemo((): EquityCurveDataPoint[] => {
    return equityCurve.map((d) => ({
      time: d.ts,
      equity: d.total_equity,
      pnl: d.total_pnl,
      drawdown: d.drawdown_pct * 100,
    }));
  }, [equityCurve]);

  // === Exposure Data (position_value / effective_capital as %) ===
  const effectiveCapital = initialCapital > 0 ? initialCapital : 1;
  const exposureData = useMemo(() => {
    return equityCurve.map((d) => ({
      time: d.ts,
      exposure: (d.total_position_value / effectiveCapital) * 100,
    }));
  }, [equityCurve, effectiveCapital]);

  // === PnL Breakdown — totalPnl from equity curve, fee from pnl_series ===
  const firstEquity = equityCurve.length > 0 ? equityCurve[0].total_equity : 0;

  const pnlData = useMemo(() => {
    // Build fee lookup by minute (ts → total_fee)
    const feeByMinute = new Map<string, number>();
    for (const d of pnlSeries) {
      const key = d.ts.slice(0, 16); // YYYY-MM-DDTHH:MM
      feeByMinute.set(key, -d.total_fee);
    }

    let lastFee = 0;
    return equityCurve.map((d) => {
      const key = d.ts.slice(0, 16);
      const fee = feeByMinute.get(key) ?? lastFee;
      lastFee = fee;
      const totalPnl = d.total_equity - firstEquity;
      return {
        time: d.ts,
        totalPnl,
        fee,
        pricePnl: totalPnl - fee,
      };
    });
  }, [equityCurve, pnlSeries, firstEquity]);

  // Current values
  const latestExposure = exposureData.length > 0 ? exposureData[exposureData.length - 1] : null;
  const latestPnl = pnlData.length > 0 ? pnlData[pnlData.length - 1] : null;

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Griffin Performance Stats */}
      <GriffinStats equityCurve={equityCurve} positions={positions} initialCapital={initialCapital} pnlSeries={pnlSeries} trades={trades} />

      {/* Equity Curve */}
      <EquityCurveWithBrush data={equityCurveData} />

      {/* Exposure (single chart, % with positive/negative) */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <div>
            <CardTitle className="text-base">Net Exposure</CardTitle>
            <p className="text-xs text-muted-foreground">Position Value / Effective Capital</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-muted-foreground">Current</p>
            <p className={`text-2xl font-bold ${(latestExposure?.exposure ?? 0) >= 0 ? "text-green-500" : "text-red-500"}`}>
              {(latestExposure?.exposure ?? 0).toFixed(2)}%
            </p>
          </div>
        </CardHeader>
        <CardContent>
          <div className="h-[250px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={exposureData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                <XAxis
                  dataKey="time"
                  tickFormatter={formatTime}
                  tick={{ fontSize: 11, fill: "#888" }}
                />
                <YAxis
                  tickFormatter={(v: number) => `${v.toFixed(1)}%`}
                  tick={{ fontSize: 11, fill: "#888" }}
                  domain={["auto", "auto"]}
                />
                <Tooltip
                  formatter={(v: number) => [`${v.toFixed(2)}%`, "Exposure"]}
                  labelFormatter={(l: string) => formatDateTime(l)}
                  contentStyle={{ backgroundColor: "#1a1a1a", border: "1px solid #333" }}
                />
                <defs>
                  <linearGradient id="griffinExposureGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
                    <stop offset="50%" stopColor="#22c55e" stopOpacity={0} />
                    <stop offset="50%" stopColor="#ef4444" stopOpacity={0} />
                    <stop offset="95%" stopColor="#ef4444" stopOpacity={0.3} />
                  </linearGradient>
                </defs>
                <Area
                  type="monotone"
                  dataKey="exposure"
                  stroke="#f59e0b"
                  strokeWidth={2}
                  fill="url(#griffinExposureGrad)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* PnL Breakdown (Fee + Funding + Total only) */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <div>
            <CardTitle className="text-base">PnL Breakdown</CardTitle>
            <p className="text-xs text-muted-foreground">Price PnL, Fee & Total</p>
          </div>
          <div className="flex gap-6 text-right">
            <div>
              <p className="text-xs text-muted-foreground">Price PnL</p>
              <p className="text-lg font-bold text-blue-400">
                ${(latestPnl?.pricePnl ?? 0).toFixed(2)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Fee</p>
              <p className="text-lg font-bold text-orange-400">
                ${(latestPnl?.fee ?? 0).toFixed(2)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total</p>
              <p className={`text-lg font-bold ${(latestPnl?.totalPnl ?? 0) >= 0 ? "text-green-500" : "text-red-500"}`}>
                ${(latestPnl?.totalPnl ?? 0).toFixed(2)}
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="h-[250px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={pnlData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                <XAxis
                  dataKey="time"
                  tickFormatter={formatTime}
                  tick={{ fontSize: 11, fill: "#888" }}
                />
                <YAxis
                  tickFormatter={(v: number) => `$${v.toFixed(0)}`}
                  tick={{ fontSize: 11, fill: "#888" }}
                />
                <Tooltip
                  formatter={(v: number, name: string) => [`$${v.toFixed(2)}`, name]}
                  labelFormatter={(l: string) => formatDateTime(l)}
                  contentStyle={{ backgroundColor: "#1a1a1a", border: "1px solid #333" }}
                />
                <Line type="monotone" dataKey="pricePnl" stroke="#3b82f6" strokeWidth={1.5} dot={false} name="Price PnL" />
                <Line type="monotone" dataKey="fee" stroke="#f97316" strokeWidth={1.5} dot={false} name="Fee" />
                <Line type="monotone" dataKey="totalPnl" stroke="#22c55e" strokeWidth={2} dot={false} name="Total PnL" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ======== Griffin-specific Performance Stats ========

function GriffinStats({
  equityCurve,
  positions,
  initialCapital,
  pnlSeries,
  trades,
}: {
  equityCurve: EquityCurve[];
  positions: Position[];
  initialCapital: number;
  pnlSeries: PnlSeries[];
  trades: Trade[];
}) {
  const stats = useMemo(() => {
    if (equityCurve.length === 0) {
      return {
        totalReturn: 0, maxDrawdown: 0, leverage: 0, netExposure: 0, totalTurnover: 0, pricePnl: 0,
        annualizedReturn: 0, sharpeRatio: 0, volatility: 0, calmarRatio: 0,
        totalFee: 0, totalFunding: 0, totalPnl: 0,
      };
    }

    const sorted = [...equityCurve].sort(
      (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime()
    );
    const first = sorted[0];
    const last = sorted[sorted.length - 1];

    const totalReturn = first.total_equity > 0
      ? ((last.total_equity - first.total_equity) / first.total_equity) * 100
      : 0;

    let maxDrawdown = 0;
    for (const p of sorted) {
      if (p.drawdown_pct > maxDrawdown) maxDrawdown = p.drawdown_pct;
    }

    // Leverage = abs(position_value) / equity
    const leverage = last.total_equity > 0
      ? Math.abs(last.total_position_value) / last.total_equity
      : 0;

    // Net Exposure = position_value / effective_capital (%)
    const effectiveCapital = initialCapital > 0 ? initialCapital : 1;
    const netExposure = (last.total_position_value / effectiveCapital) * 100;

    // Period
    const periodDays = (new Date(last.ts).getTime() - new Date(first.ts).getTime()) / 86400000;
    const annualizedReturn = periodDays > 0 ? totalReturn * (365 / periodDays) : 0;

    // Minute-level returns for Sharpe/Vol (annualized)
    const minuteReturns: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i - 1].total_equity > 0)
        minuteReturns.push(
          (sorted[i].total_equity - sorted[i - 1].total_equity) / sorted[i - 1].total_equity
        );
    }

    const MINUTES_PER_YEAR = 365 * 24 * 60;
    let volatility = 0, sharpeRatio = 0;
    if (minuteReturns.length > 1) {
      const mean = minuteReturns.reduce((a, b) => a + b, 0) / minuteReturns.length;
      const variance = minuteReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / (minuteReturns.length - 1);
      const std = Math.sqrt(variance);
      // Annualize: multiply by sqrt(minutes_per_year)
      volatility = std * Math.sqrt(MINUTES_PER_YEAR) * 100;
      if (std > 0) {
        sharpeRatio = (mean - 0.02 / MINUTES_PER_YEAR) / std * Math.sqrt(MINUTES_PER_YEAR);
      }
    }

    // Fee / Funding from pnl_series
    const latestPnl = pnlSeries.length > 0 ? pnlSeries[pnlSeries.length - 1] : null;
    // Total PnL from equity curve (always matches equity display)
    const totalPnl = last.total_equity - first.total_equity;
    const totalFee = -(latestPnl?.total_fee ?? 0);
    const pricePnl = totalPnl - totalFee;
    // Turnover: sum(quantity * price) from trades table
    const totalTurnover = trades.reduce((sum: number, t: Trade) => sum + t.quantity_actual * t.price, 0);

    return {
      totalReturn, maxDrawdown: maxDrawdown * 100, leverage, netExposure,
      annualizedReturn, sharpeRatio, volatility,
      pricePnl, totalFee, totalPnl, totalTurnover,
    };
  }, [equityCurve, positions, initialCapital, pnlSeries]);

  const getColor = (v: number) =>
    v > 0 ? "text-emerald-400" : v < 0 ? "text-red-400" : "";

  return (
    <Card>
      <CardContent className="p-0">
        <div className="grid grid-cols-4 divide-x divide-border">
          <Stat label="Total Return" value={`${stats.totalReturn.toFixed(2)}%`} color={getColor(stats.totalReturn)} />
          <Stat label="Max Drawdown" value={`-${stats.maxDrawdown.toFixed(2)}%`} color="text-red-400" />
          <Stat label="Leverage" value={`${stats.leverage.toFixed(2)}x`} />
          <Stat label="Net Exposure" value={`${stats.netExposure.toFixed(2)}%`} color={getColor(stats.netExposure)} />
        </div>
        <div className="grid grid-cols-4 divide-x divide-border border-t border-border">
          <Stat label="Annualized Return" value={`${stats.annualizedReturn.toFixed(2)}%`} color={getColor(stats.annualizedReturn)} />
          <Stat label="Sharpe Ratio" value={stats.sharpeRatio.toFixed(2)} />
          <Stat label="Volatility (Ann.)" value={`${stats.volatility.toFixed(2)}%`} />
          <Stat label="Turnover" value={`$${stats.totalTurnover.toFixed(2)}`} />
        </div>
        <div className="grid grid-cols-4 divide-x divide-border border-t border-border">
          <Stat label="Price PnL" value={`$${stats.pricePnl.toFixed(2)}`} color={getColor(stats.pricePnl)} />
          <Stat label="Fee" value={`$${stats.totalFee.toFixed(2)}`} color={getColor(stats.totalFee)} />
          <Stat label="Total PnL" value={`$${stats.totalPnl.toFixed(2)}`} color={getColor(stats.totalPnl)} />
          <Stat label="PnL / Capital" value={`${((stats.totalPnl / (initialCapital || 1)) * 10000).toFixed(1)} bp`} color={getColor(stats.totalPnl)} />
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex flex-col items-center justify-center p-3 sm:p-4">
      <span className={cn("text-lg sm:text-2xl font-bold", color)}>{value}</span>
      <span className="text-xs sm:text-sm text-muted-foreground text-center">{label}</span>
    </div>
  );
}
