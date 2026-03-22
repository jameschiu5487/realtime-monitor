"use client";

import { useMemo, useState } from "react";
import {
  useRealtimePolymarketEquity,
  useRealtimePolymarketPositions,
  useRealtimePolymarketSymbolPnl,
} from "@/lib/hooks/use-realtime-data";
import type {
  StrategyRun,
  PolymarketEquity,
  PolymarketPosition,
  PolymarketSymbolPnl,
} from "@/lib/types/database";
import { PolymarketEquityChart } from "./polymarket-equity-chart";
import { PolymarketSymbolPnlChart } from "./polymarket-symbol-pnl-chart";
import { PolymarketPositionsTable } from "./polymarket-positions-table";
import { PolymarketStatsCards } from "./polymarket-stats-cards";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

interface PolymarketContentProps {
  run: StrategyRun;
  allRuns: StrategyRun[];
  initialEquity: PolymarketEquity[];
  initialPositions: PolymarketPosition[];
  initialSymbolPnl: PolymarketSymbolPnl[];
}

export function PolymarketContent({
  run,
  allRuns,
  initialEquity,
  initialPositions,
  initialSymbolPnl,
}: PolymarketContentProps) {
  const [selectedRunId, setSelectedRunId] = useState(run.run_id);
  const currentRun = allRuns.find((r) => r.run_id === selectedRunId) ?? run;

  const { data: equityData } = useRealtimePolymarketEquity(selectedRunId, initialEquity);
  const { data: positionsData } = useRealtimePolymarketPositions(selectedRunId, initialPositions);
  const { data: symbolPnlData } = useRealtimePolymarketSymbolPnl(selectedRunId, initialSymbolPnl);

  // Transform equity data for chart
  const equityChartData = useMemo(
    () =>
      equityData.map((d) => ({
        time: d.ts,
        equity: d.total_equity,
        pnl: d.total_pnl,
        positionValue: d.total_position_value,
        drawdown: d.drawdown_pct,
      })),
    [equityData]
  );

  // Get latest positions (most recent timestamp only)
  const latestPositions = useMemo(() => {
    if (positionsData.length === 0) return [];
    const latestTs = positionsData[0]?.ts;
    if (!latestTs) return [];
    return positionsData.filter((p) => p.ts === latestTs);
  }, [positionsData]);

  // Get latest symbol P&L (most recent timestamp per symbol)
  const latestSymbolPnl = useMemo(() => {
    if (symbolPnlData.length === 0) return [];
    const latestBySymbol = new Map<string, PolymarketSymbolPnl>();
    for (const s of symbolPnlData) {
      const existing = latestBySymbol.get(s.symbol);
      if (!existing || new Date(s.ts) > new Date(existing.ts)) {
        latestBySymbol.set(s.symbol, s);
      }
    }
    return Array.from(latestBySymbol.values());
  }, [symbolPnlData]);

  // Calculate overall stats
  const stats = useMemo(() => {
    const latestEquity = equityData.length > 0 ? equityData[equityData.length - 1] : null;
    const totalTrades = latestSymbolPnl.reduce((sum, s) => sum + s.trade_count, 0);
    const totalWins = latestSymbolPnl.reduce((sum, s) => sum + s.win_count, 0);
    const overallWinRate = totalTrades > 0 ? (totalWins / totalTrades) * 100 : 0;
    const activePositions = latestPositions.filter((p) => !p.settled).length;

    return {
      totalEquity: latestEquity?.total_equity ?? 0,
      totalPnl: latestEquity?.total_pnl ?? 0,
      positionValue: latestEquity?.total_position_value ?? 0,
      drawdown: latestEquity?.drawdown_pct ?? 0,
      totalTrades,
      totalWins,
      overallWinRate,
      activePositions,
      initialCapital: currentRun.initial_capital,
    };
  }, [equityData, latestSymbolPnl, latestPositions, currentRun]);

  return (
    <div className="space-y-6 p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Polymarket Monitor</h1>
          <p className="text-sm text-muted-foreground">
            Up/Down prediction market strategy
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant={currentRun.status === "running" ? "default" : "secondary"}>
            {currentRun.status}
          </Badge>
          <Select value={selectedRunId} onValueChange={setSelectedRunId}>
            <SelectTrigger className="w-[220px]">
              <SelectValue placeholder="Select run" />
            </SelectTrigger>
            <SelectContent>
              {allRuns.map((r) => (
                <SelectItem key={r.run_id} value={r.run_id}>
                  {new Date(r.start_time).toLocaleString("en-US", {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}{" "}
                  ({r.mode})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Stats Cards */}
      <PolymarketStatsCards stats={stats} />

      {/* Equity Curve */}
      <PolymarketEquityChart data={equityChartData} />

      {/* Symbol P&L Chart */}
      <PolymarketSymbolPnlChart
        symbolPnlData={symbolPnlData}
        latestSymbolPnl={latestSymbolPnl}
        initialCapital={currentRun.initial_capital}
      />

      {/* Positions Table */}
      <PolymarketPositionsTable positions={latestPositions} />
    </div>
  );
}
