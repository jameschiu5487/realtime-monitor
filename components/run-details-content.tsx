"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
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
import { PerformanceStats } from "@/components/charts/performance-stats";
import { SymbolPnLChart } from "@/components/charts/symbol-pnl-chart";
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
  initialCapital: number;
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
// Exposure = position_value / total_equity (relative to total portfolio)
function transformExposureData(data: EquityCurve[]): ExposureDataPoint[] {
  return data.map((point) => {
    const totalEquity = point.total_equity;

    // All exposures are calculated relative to total equity
    const binanceExposure = totalEquity > 0
      ? (point.binance_position_value / totalEquity) * 100
      : 0;
    const bybitExposure = totalEquity > 0
      ? (point.bybit_position_value / totalEquity) * 100
      : 0;
    const totalExposure = totalEquity > 0
      ? (point.total_position_value / totalEquity) * 100
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
  initialCapital,
  enableHedge,
}: RunDetailsContentProps) {
  // Use realtime hooks for live data updates
  const { data: equityCurve, isFreshDataLoaded: isEquityLoaded } = useRealtimeEquityCurve(runId, initialEquityCurve);
  const { data: pnlSeries, isFreshDataLoaded: isPnlLoaded } = useRealtimePnlSeries(runId, initialPnlSeries);
  const { data: combinedTrades, isFreshDataLoaded: isTradesLoaded } = useRealtimeCombinedTrades(runId, initialCombinedTrades);
  const { data: positions, lastInsertTime: positionsLastInsertTime } = useRealtimePositions(runId, initialPositions);

  // Check if all critical data is loaded
  const isFreshDataLoaded = isEquityLoaded && isPnlLoaded && isTradesLoaded;

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

  // Track if user has manually changed the time range
  const userChangedRangeRef = useRef(false);

  // Use timestamps for more reliable dependency comparison
  const dataStartTimestamp = dataStartTime.getTime();
  const dataEndTimestamp = dataEndTime.getTime();

  // Sync time range to full data range when fresh data is loaded
  // This handles initial load and fresh client fetch
  useEffect(() => {
    // Only sync after fresh data is loaded from client-side fetch
    if (!isFreshDataLoaded) {
      console.log("[TimeRange] Waiting for fresh data to load...");
      return;
    }

    console.log("[TimeRange] Fresh data loaded, syncing time range");
    console.log("[TimeRange] Data range:", new Date(dataStartTimestamp).toISOString(), "-", new Date(dataEndTimestamp).toISOString());

    // If user hasn't manually changed the range, sync to full data range
    if (!userChangedRangeRef.current) {
      console.log("[TimeRange] Auto-syncing to full range");
      setTimeRange({
        start: new Date(dataStartTimestamp),
        end: new Date(dataEndTimestamp),
      });
    }
  }, [isFreshDataLoaded, dataStartTimestamp, dataEndTimestamp]);

  // Handle real-time updates - extend time range if user is at the data end
  useEffect(() => {
    if (!isFreshDataLoaded) return;

    // If user manually changed the range, only extend if they're near the data end
    if (userChangedRangeRef.current) {
      setTimeRange((prev) => {
        const isNearDataEnd = dataEndTimestamp - prev.end.getTime() < 2 * 60 * 1000;
        if (isNearDataEnd && prev.end.getTime() < dataEndTimestamp) {
          console.log("[TimeRange] Auto-extending to new data end");
          return {
            start: prev.start,
            end: new Date(dataEndTimestamp),
          };
        }
        return prev;
      });
    } else {
      // User hasn't changed range, keep syncing to full range
      setTimeRange({
        start: new Date(dataStartTimestamp),
        end: new Date(dataEndTimestamp),
      });
    }
  }, [dataEndTimestamp, dataStartTimestamp, isFreshDataLoaded]);

  // Handle time range change from the selector buttons
  const handleTimeRangeChange = useCallback((range: TimeRange) => {
    // Check if user clicked "All" (range matches full data range)
    const isAllRange =
      Math.abs(range.start.getTime() - dataStartTime.getTime()) < 1000 &&
      Math.abs(range.end.getTime() - dataEndTime.getTime()) < 1000;

    // Reset flag if "All" is clicked, otherwise mark as user-changed
    userChangedRangeRef.current = !isAllRange;
    setTimeRange(range);
  }, [dataStartTime, dataEndTime]);

  // Handle range change from chart drag selection
  const handleChartRangeChange = useCallback((startTime: Date, endTime: Date) => {
    userChangedRangeRef.current = true;
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

  // Filter raw equity curve for performance stats
  const filteredEquityCurve = useMemo(() => {
    return equityCurve.filter((d) => {
      const time = new Date(d.ts);
      return time >= timeRange.start && time <= timeRange.end;
    });
  }, [equityCurve, timeRange]);

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

        {/* Performance Stats */}
        <PerformanceStats
          filteredEquityCurve={filteredEquityCurve}
          filteredCombinedTrades={filteredCombinedTrades}
        />

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
          <RealtimePositionChart data={realtimePositionData} lastInsertTime={positionsLastInsertTime} />
        </div>

        {/* Row 3: PnL Breakdown */}
        <PnLBreakdownChart data={filteredPnlBreakdownData} />

        {/* Row 4: Trade PnL Charts */}
        <div className="grid gap-3 sm:gap-6 md:grid-cols-2">
          <IndividualTradePnLChart data={filteredIndividualTradePnLData} />
          <CumulativeTradePnLChart data={filteredCumulativePnLData} />
        </div>
      </div>

      {/* Symbol P&L Chart */}
      <SymbolPnLChart combinedTrades={filteredCombinedTrades} initialCapital={initialCapital} />

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
