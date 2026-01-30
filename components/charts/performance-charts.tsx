"use client";

import { useState, useMemo, useCallback } from "react";
import { TimeRangeSelector, TimeRange } from "./time-range-selector";
import { EquityCurveWithBrush } from "./equity-curve-with-brush";
import { ExchangeEquityChart } from "./exchange-equity-chart";
import { PnLBreakdownChart } from "./pnl-breakdown-chart";
import { IndividualTradePnLChart } from "./individual-trade-pnl-chart";
import { CumulativeTradePnLChart } from "./cumulative-trade-pnl-chart";
import type { EquityCurveDataPoint } from "./equity-curve-chart";
import type { ExchangeEquityDataPoint } from "./exchange-equity-chart";
import type { PnLBreakdownDataPoint } from "./pnl-breakdown-chart";
import type { IndividualTradePnLDataPoint } from "./individual-trade-pnl-chart";
import type { CumulativePnLDataPoint } from "./cumulative-trade-pnl-chart";

interface PerformanceChartsProps {
  equityCurveData: EquityCurveDataPoint[];
  exchangeEquityData: ExchangeEquityDataPoint[];
  pnlBreakdownData: PnLBreakdownDataPoint[];
  individualTradePnLData: IndividualTradePnLDataPoint[];
  cumulativePnLData: CumulativePnLDataPoint[];
}

export function PerformanceCharts({
  equityCurveData,
  exchangeEquityData,
  pnlBreakdownData,
  individualTradePnLData,
  cumulativePnLData,
}: PerformanceChartsProps) {
  // Calculate data time range from all time-based data
  const { dataStartTime, dataEndTime } = useMemo(() => {
    const allTimes: Date[] = [];

    equityCurveData.forEach((d) => allTimes.push(new Date(d.time)));
    pnlBreakdownData.forEach((d) => allTimes.push(new Date(d.time)));
    cumulativePnLData.forEach((d) => allTimes.push(new Date(d.time)));

    if (allTimes.length === 0) {
      const now = new Date();
      return { dataStartTime: now, dataEndTime: now };
    }

    const sortedTimes = allTimes.sort((a, b) => a.getTime() - b.getTime());
    return {
      dataStartTime: sortedTimes[0],
      dataEndTime: sortedTimes[sortedTimes.length - 1],
    };
  }, [equityCurveData, pnlBreakdownData, cumulativePnLData]);

  // Initialize with full range
  const [timeRange, setTimeRange] = useState<TimeRange>({
    start: dataStartTime,
    end: dataEndTime,
  });

  // Handle time range change from the selector buttons
  const handleTimeRangeChange = useCallback((range: TimeRange) => {
    setTimeRange(range);
  }, []);

  // Handle range change from chart drag selection
  const handleChartRangeChange = useCallback((startTime: Date, endTime: Date) => {
    setTimeRange({ start: startTime, end: endTime });
  }, []);

  // Filter equity curve data based on selected time range (for the main chart display)
  const filteredEquityCurveData = useMemo(() => {
    return equityCurveData.filter((d) => {
      const time = new Date(d.time);
      return time >= timeRange.start && time <= timeRange.end;
    });
  }, [equityCurveData, timeRange]);

  // Filter data based on selected time range for other charts
  const filteredExchangeEquityData = useMemo(() => {
    return exchangeEquityData.filter((d) => {
      const time = new Date(d.time);
      return time >= timeRange.start && time <= timeRange.end;
    });
  }, [exchangeEquityData, timeRange]);

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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight">Performance Charts</h2>
      </div>

      {/* Time Range Selector */}
      <TimeRangeSelector
        dataStartTime={dataStartTime}
        dataEndTime={dataEndTime}
        onRangeChange={handleTimeRangeChange}
        currentRange={timeRange}
      />

      {/* Row 1: Total Equity with drag-to-zoom (left) + Exchange Equity (right) */}
      <div className="grid gap-6 md:grid-cols-2">
        <EquityCurveWithBrush
          data={filteredEquityCurveData}
          onRangeChange={handleChartRangeChange}
        />
        <ExchangeEquityChart data={filteredExchangeEquityData} />
      </div>

      {/* Row 2: PnL Breakdown */}
      <PnLBreakdownChart data={filteredPnlBreakdownData} />

      {/* Row 3: Trade PnL Charts */}
      <div className="grid gap-6 md:grid-cols-2">
        <IndividualTradePnLChart data={individualTradePnLData} />
        <CumulativeTradePnLChart data={filteredCumulativePnLData} />
      </div>
    </div>
  );
}
