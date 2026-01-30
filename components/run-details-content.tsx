"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TimeRangeSelector, TimeRange } from "@/components/charts/time-range-selector";
import { EquityCurveWithBrush } from "@/components/charts/equity-curve-with-brush";
import { ExchangeEquityChart } from "@/components/charts/exchange-equity-chart";
import { ExposureChart } from "@/components/charts/exposure-chart";
import { RealtimePositionChart } from "@/components/charts/realtime-position-chart";
import { PnLBreakdownChart } from "@/components/charts/pnl-breakdown-chart";
import { IndividualTradePnLChart } from "@/components/charts/individual-trade-pnl-chart";
import { CumulativeTradePnLChart } from "@/components/charts/cumulative-trade-pnl-chart";
import { CombinedTradesTable } from "@/components/trades/combined-trades-table";
import {
  useRealtimeEquityCurve,
  useRealtimePnlSeries,
  useRealtimeCombinedTrades,
  useRealtimePositions,
} from "@/lib/hooks/use-realtime-data";
import type { EquityCurveDataPoint } from "@/components/charts/equity-curve-chart";
import type { ExchangeEquityDataPoint } from "@/components/charts/exchange-equity-chart";
import type { ExposureDataPoint } from "@/components/charts/exposure-chart";
import type { RealtimePositionDataPoint } from "@/components/charts/realtime-position-chart";
import type { PnLBreakdownDataPoint } from "@/components/charts/pnl-breakdown-chart";
import type { CumulativePnLDataPoint } from "@/components/charts/cumulative-trade-pnl-chart";
import type {
  EquityCurve,
  PnlSeries,
  CombinedTrade,
  Position,
} from "@/lib/types/database";

interface RunDetailsContentProps {
  runId: string;
  initialEquityCurve: EquityCurve[];
  initialPnlSeries: PnlSeries[];
  initialCombinedTrades: CombinedTrade[];
  initialPositions: Position[];
  enableHedge: boolean;
}

// Transform equity curve to chart data points
function transformEquityCurveData(data: EquityCurve[]): EquityCurveDataPoint[] {
  return data.map((point) => ({
    time: point.ts,
    equity: point.total_equity,
  }));
}

// Transform equity curve to exchange equity data points
function transformExchangeEquityData(data: EquityCurve[]): ExchangeEquityDataPoint[] {
  return data.map((point) => ({
    time: point.ts,
    binance: point.binance_equity,
    bybit: point.bybit_equity,
  }));
}

// Transform equity curve to exposure data points
function transformExposureData(data: EquityCurve[]): ExposureDataPoint[] {
  return data.map((point) => {
    const binanceExposure = point.binance_equity > 0
      ? Math.min((point.binance_position_value / point.binance_equity) * 100, 100)
      : 0;
    const bybitExposure = point.bybit_equity > 0
      ? Math.min((point.bybit_position_value / point.bybit_equity) * 100, 100)
      : 0;
    const totalExposure = point.total_equity > 0
      ? Math.min((point.total_position_value / point.total_equity) * 100, 100)
      : 0;

    return {
      time: point.ts,
      binance_exposure: binanceExposure,
      bybit_exposure: bybitExposure,
      total_exposure: totalExposure,
    };
  });
}

// Transform PnL series to breakdown data points
function transformPnlBreakdownData(data: PnlSeries[]): PnLBreakdownDataPoint[] {
  return data.map((point) => ({
    time: point.ts,
    funding_pnl: point.total_funding_pnl,
    price_pnl: point.total_price_pnl,
    total_pnl: point.total_pnl,
    total_fee: point.total_fee,
  }));
}

// Transform PnL series to cumulative data points
function transformCumulativePnLData(data: PnlSeries[]): CumulativePnLDataPoint[] {
  return data.map((point) => ({
    time: point.ts,
    cumulative: point.total_pnl,
  }));
}

// Transform positions to realtime position data points
function transformRealtimePositionData(data: Position[]): RealtimePositionDataPoint[] {
  return data.map((pos) => ({
    symbol: pos.symbol,
    exchange: pos.exchange,
    position: pos.position,
    avg_price: pos.avg_price,
    mark_price: pos.mark_price,
    notional_value: pos.notional_value,
    unrealized_pnl: pos.unrealized_pnl,
    leverage: pos.leverage,
    liq_price: pos.liq_price,
    ts: pos.ts,
  }));
}

export function RunDetailsContent({
  runId,
  initialEquityCurve,
  initialPnlSeries,
  initialCombinedTrades,
  initialPositions,
  enableHedge,
}: RunDetailsContentProps) {
  // Use realtime hooks for live data updates
  const equityCurve = useRealtimeEquityCurve(runId, initialEquityCurve);
  const pnlSeries = useRealtimePnlSeries(runId, initialPnlSeries);
  const combinedTrades = useRealtimeCombinedTrades(runId, initialCombinedTrades);
  const positions = useRealtimePositions(runId, initialPositions);

  // Transform data for charts
  const equityCurveData = useMemo(() => transformEquityCurveData(equityCurve), [equityCurve]);
  const exchangeEquityData = useMemo(() => transformExchangeEquityData(equityCurve), [equityCurve]);
  const exposureData = useMemo(() => transformExposureData(equityCurve), [equityCurve]);
  const pnlBreakdownData = useMemo(() => transformPnlBreakdownData(pnlSeries), [pnlSeries]);
  const cumulativePnLData = useMemo(() => transformCumulativePnLData(pnlSeries), [pnlSeries]);
  const realtimePositionData = useMemo(() => transformRealtimePositionData(positions), [positions]);

  // Calculate data time range from all time-based data
  const { dataStartTime, dataEndTime } = useMemo(() => {
    const allTimes: Date[] = [];

    equityCurveData.forEach((d) => allTimes.push(new Date(d.time)));
    pnlBreakdownData.forEach((d) => allTimes.push(new Date(d.time)));
    cumulativePnLData.forEach((d) => allTimes.push(new Date(d.time)));
    exposureData.forEach((d) => allTimes.push(new Date(d.time)));
    combinedTrades.forEach((d) => allTimes.push(new Date(d.ts)));

    if (allTimes.length === 0) {
      const now = new Date();
      return { dataStartTime: now, dataEndTime: now };
    }

    const sortedTimes = allTimes.sort((a, b) => a.getTime() - b.getTime());
    return {
      dataStartTime: sortedTimes[0],
      dataEndTime: sortedTimes[sortedTimes.length - 1],
    };
  }, [equityCurveData, pnlBreakdownData, cumulativePnLData, exposureData, combinedTrades]);

  // Initialize with full range
  const [timeRange, setTimeRange] = useState<TimeRange>({
    start: dataStartTime,
    end: dataEndTime,
  });

  // Update time range when data range changes (new data comes in)
  useEffect(() => {
    setTimeRange((prev) => {
      // If current end time equals previous data end time, extend to new end time
      // This keeps the view updated as new data arrives
      const prevEndWasAtDataEnd = Math.abs(prev.end.getTime() - dataEndTime.getTime()) < 60000; // within 1 minute
      if (prevEndWasAtDataEnd) {
        return {
          start: prev.start,
          end: dataEndTime,
        };
      }
      return prev;
    });
  }, [dataEndTime]);

  // Handle time range change from the selector buttons
  const handleTimeRangeChange = useCallback((range: TimeRange) => {
    setTimeRange(range);
  }, []);

  // Handle range change from chart drag selection
  const handleChartRangeChange = useCallback((startTime: Date, endTime: Date) => {
    setTimeRange({ start: startTime, end: endTime });
  }, []);

  // Filter data based on selected time range
  const filteredEquityCurveData = useMemo(() => {
    return equityCurveData.filter((d) => {
      const time = new Date(d.time);
      return time >= timeRange.start && time <= timeRange.end;
    });
  }, [equityCurveData, timeRange]);

  const filteredExchangeEquityData = useMemo(() => {
    return exchangeEquityData.filter((d) => {
      const time = new Date(d.time);
      return time >= timeRange.start && time <= timeRange.end;
    });
  }, [exchangeEquityData, timeRange]);

  const filteredExposureData = useMemo(() => {
    return exposureData.filter((d) => {
      const time = new Date(d.time);
      return time >= timeRange.start && time <= timeRange.end;
    });
  }, [exposureData, timeRange]);

  const filteredPnlBreakdownData = useMemo(() => {
    return pnlBreakdownData.filter((d) => {
      const time = new Date(d.time);
      return time >= timeRange.start && time <= timeRange.end;
    });
  }, [pnlBreakdownData, timeRange]);

  const filteredCumulativePnLData = useMemo(() => {
    return cumulativePnLData.filter((d) => {
      const time = new Date(d.time);
      return time >= timeRange.start && time <= timeRange.end;
    });
  }, [cumulativePnLData, timeRange]);

  // Filter combined trades based on time range
  const filteredCombinedTrades = useMemo(() => {
    return combinedTrades.filter((d) => {
      const time = new Date(d.ts);
      return time >= timeRange.start && time <= timeRange.end;
    });
  }, [combinedTrades, timeRange]);

  // Filter individual trade PnL data based on filtered combined trades
  const filteredIndividualTradePnLData = useMemo(() => {
    if (!enableHedge) {
      // Non-hedge mode: filter and re-index
      return filteredCombinedTrades
        .filter((trade) => trade.total_pnl !== null)
        .map((trade, index) => ({
          trade: String(index + 1),
          pnl: trade.total_pnl!,
        }));
    }

    // Hedge mode: group into pairs and sum P&L
    const sorted = [...filteredCombinedTrades].sort(
      (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime()
    );
    const used = new Set<number>();
    const pairPnLs: number[] = [];

    for (let i = 0; i < sorted.length; i++) {
      if (used.has(sorted[i].combined_trade_id)) continue;

      const trade1 = sorted[i];
      let matchIndex = -1;

      for (let j = i + 1; j < sorted.length; j++) {
        if (used.has(sorted[j].combined_trade_id)) continue;
        const trade2 = sorted[j];

        if (trade2.symbol === trade1.symbol && trade2.exchange !== trade1.exchange) {
          const timeDiff = Math.abs(
            new Date(trade2.ts).getTime() - new Date(trade1.ts).getTime()
          );
          if (timeDiff <= 60 * 1000) {
            matchIndex = j;
            break;
          }
        }
      }

      if (matchIndex !== -1) {
        const trade2 = sorted[matchIndex];
        used.add(trade1.combined_trade_id);
        used.add(trade2.combined_trade_id);
        const pairPnl = (trade1.total_pnl ?? 0) + (trade2.total_pnl ?? 0);
        pairPnLs.push(pairPnl);
      } else {
        used.add(trade1.combined_trade_id);
        if (trade1.total_pnl !== null) {
          pairPnLs.push(trade1.total_pnl);
        }
      }
    }

    return pairPnLs.map((pnl, index) => ({
      trade: String(index + 1),
      pnl,
    }));
  }, [filteredCombinedTrades, enableHedge]);

  return (
    <>
      {/* Performance Charts */}
      <div className="space-y-3 sm:space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl sm:text-2xl font-bold tracking-tight">Performance Charts</h2>
        </div>

        {/* Time Range Selector */}
        <TimeRangeSelector
          dataStartTime={dataStartTime}
          dataEndTime={dataEndTime}
          onRangeChange={handleTimeRangeChange}
          currentRange={timeRange}
        />

        {/* Row 1: Total Equity with drag-to-zoom (left) + Exchange Equity (right) */}
        <div className="grid gap-3 sm:gap-6 md:grid-cols-2">
          <EquityCurveWithBrush
            data={filteredEquityCurveData}
            onRangeChange={handleChartRangeChange}
          />
          <ExchangeEquityChart data={filteredExchangeEquityData} />
        </div>

        {/* Row 2: Exposure (left) + Realtime Positions (right) */}
        <div className="grid gap-3 sm:gap-6 md:grid-cols-2">
          <ExposureChart data={filteredExposureData} />
          <RealtimePositionChart data={realtimePositionData} />
        </div>

        {/* Row 3: PnL Breakdown */}
        <PnLBreakdownChart data={filteredPnlBreakdownData} />

        {/* Row 4: Trade PnL Charts */}
        <div className="grid gap-3 sm:gap-6 md:grid-cols-2">
          <IndividualTradePnLChart data={filteredIndividualTradePnLData} />
          <CumulativeTradePnLChart data={filteredCumulativePnLData} />
        </div>
      </div>

      {/* Combined Trades Table */}
      <Card>
        <CardHeader className="px-4 sm:px-6">
          <CardTitle className="text-lg sm:text-xl">Historical Positions ({filteredCombinedTrades.length})</CardTitle>
        </CardHeader>
        <CardContent className="px-2 sm:px-6">
          <div className="max-h-[500px] sm:max-h-[880px] overflow-auto relative [&_thead]:sticky [&_thead]:top-0 [&_thead]:z-10 [&_thead]:bg-background">
            <CombinedTradesTable
              combinedTrades={filteredCombinedTrades}
              enableHedge={enableHedge}
            />
          </div>
        </CardContent>
      </Card>
    </>
  );
}
