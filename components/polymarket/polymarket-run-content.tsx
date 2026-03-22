"use client";

import { useMemo } from "react";
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

interface PolymarketRunContentProps {
  runId: string;
  run: StrategyRun;
  initialEquity: PolymarketEquity[];
  initialPositions: PolymarketPosition[];
  initialSymbolPnl: PolymarketSymbolPnl[];
}

export function PolymarketRunContent({
  runId,
  run,
  initialEquity,
  initialPositions,
  initialSymbolPnl,
}: PolymarketRunContentProps) {
  const { data: equityData } = useRealtimePolymarketEquity(runId, initialEquity);
  const { data: positionsData } = useRealtimePolymarketPositions(runId, initialPositions);
  const { data: symbolPnlData } = useRealtimePolymarketSymbolPnl(runId, initialSymbolPnl);

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
      initialCapital: run.initial_capital,
    };
  }, [equityData, latestSymbolPnl, latestPositions, run]);

  return (
    <div className="space-y-6">
      <PolymarketStatsCards stats={stats} />
      <PolymarketEquityChart data={equityChartData} />
      <PolymarketSymbolPnlChart
        symbolPnlData={symbolPnlData}
        latestSymbolPnl={latestSymbolPnl}
        initialCapital={run.initial_capital}
      />
      <PolymarketPositionsTable positions={latestPositions} />
    </div>
  );
}
