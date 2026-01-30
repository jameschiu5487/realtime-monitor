import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { RunDetailsHeader } from "@/components/strategies/run-details-header";
import { RunDetailsContent } from "@/components/run-details-content";
import type { EquityCurveDataPoint } from "@/components/charts/equity-curve-chart";
import type { ExchangeEquityDataPoint } from "@/components/charts/exchange-equity-chart";
import type { PnLBreakdownDataPoint } from "@/components/charts/pnl-breakdown-chart";
import type { CumulativePnLDataPoint } from "@/components/charts/cumulative-trade-pnl-chart";
import type { ExposureDataPoint } from "@/components/charts/exposure-chart";
import type { RealtimePositionDataPoint } from "@/components/charts/realtime-position-chart";
import type {
  Strategy,
  StrategyRun,
  EquityCurve,
  PnlSeries,
  CombinedTrade,
  Trade,
  Position,
} from "@/lib/types/database";

interface RunDetailsPageProps {
  params: Promise<{
    strategyId: string;
    runId: string;
  }>;
}

type RunWithStrategy = StrategyRun & { strategies: Strategy | null };

// Calculate exposure series from combined trades and equity curve
function calculateExposureFromCombinedTrades(
  combinedTrades: CombinedTrade[],
  equityCurve: EquityCurve[]
): ExposureDataPoint[] {
  if (equityCurve.length === 0) return [];

  // Sort equity curve by timestamp
  const sortedEquity = [...equityCurve].sort(
    (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime()
  );

  // Create time events for position opens and closes
  interface PositionEvent {
    time: number;
    ts: string;
    type: "open" | "close";
    key: string;
    notional: number;
  }

  const events: PositionEvent[] = [];

  for (const trade of combinedTrades) {
    const key = `${trade.symbol}-${trade.exchange}`;
    const entryTime = new Date(trade.ts).getTime();
    const notional = trade.quantity * trade.entry_price;

    // Add open event
    events.push({
      time: entryTime,
      ts: trade.ts,
      type: "open",
      key,
      notional,
    });

    // Add close event if position was closed (has holding_period_hours)
    if (trade.holding_period_hours !== null && trade.exit_price !== null) {
      const exitTime = entryTime + trade.holding_period_hours * 60 * 60 * 1000;
      const exitTs = new Date(exitTime).toISOString();
      events.push({
        time: exitTime,
        ts: exitTs,
        type: "close",
        key,
        notional,
      });
    }
  }

  // Sort events by time
  events.sort((a, b) => a.time - b.time);

  // Helper to find equity at a given time
  function getEquityAtTime(targetTime: number): number {
    let equity = sortedEquity[0]?.total_equity || 0;
    for (const eq of sortedEquity) {
      if (new Date(eq.ts).getTime() <= targetTime) {
        equity = eq.total_equity;
      } else {
        break;
      }
    }
    return equity;
  }

  // Track open positions
  const openPositions = new Map<string, number>();
  const exposurePoints: ExposureDataPoint[] = [];

  // Start with 0% exposure at the beginning
  if (sortedEquity.length > 0) {
    exposurePoints.push({
      time: sortedEquity[0].ts,
      exposure: 0,
    });
  }

  for (const event of events) {
    if (event.type === "open") {
      const current = openPositions.get(event.key) || 0;
      openPositions.set(event.key, current + event.notional);
    } else {
      // Close - remove the notional
      const current = openPositions.get(event.key) || 0;
      const newNotional = current - event.notional;
      if (newNotional <= 0) {
        openPositions.delete(event.key);
      } else {
        openPositions.set(event.key, newNotional);
      }
    }

    // Calculate total exposure
    let totalExposure = 0;
    for (const notional of openPositions.values()) {
      totalExposure += notional;
    }

    // Get equity at this time
    const equity = getEquityAtTime(event.time);

    // Calculate exposure percentage (0-100%)
    const exposurePct = equity > 0 ? Math.min((totalExposure / equity) * 100, 100) : 0;

    exposurePoints.push({
      time: event.ts,
      exposure: exposurePct,
    });
  }

  return exposurePoints;
}

export default async function RunDetailsPage({ params }: RunDetailsPageProps) {
  const { strategyId, runId } = await params;
  const supabase = await createClient();

  // Fetch all data in parallel
  const [
    runResult,
    equityCurveResult,
    pnlSeriesResult,
    combinedTradesResult,
    tradesResult,
    positionsResult,
  ] = await Promise.all([
    supabase
      .from("strategy_runs")
      .select("*, strategies(*)")
      .eq("run_id", runId)
      .single(),
    supabase
      .from("equity_curve")
      .select("*")
      .eq("run_id", runId)
      .order("ts", { ascending: true }),
    supabase
      .from("pnl_series")
      .select("*")
      .eq("run_id", runId)
      .order("ts", { ascending: true }),
    supabase
      .from("combined_trades")
      .select("*")
      .eq("run_id", runId)
      .order("ts", { ascending: true }),
    supabase
      .from("trades")
      .select("*")
      .eq("run_id", runId)
      .order("ts", { ascending: true }),
    supabase
      .from("positions")
      .select("*")
      .eq("run_id", runId)
      .order("ts", { ascending: false })
      .limit(50),
  ]);

  const run = runResult.data as RunWithStrategy | null;
  const equityCurve = (equityCurveResult.data ?? []) as EquityCurve[];
  const pnlSeries = (pnlSeriesResult.data ?? []) as PnlSeries[];
  const combinedTrades = (combinedTradesResult.data ?? []) as CombinedTrade[];
  const trades = (tradesResult.data ?? []) as Trade[];
  const positions = (positionsResult.data ?? []) as Position[];

  if (runResult.error || !run) {
    return notFound();
  }

  const strategy = run.strategies;

  if (!strategy || strategy.strategy_id !== strategyId) {
    return notFound();
  }

  // Check if hedge is enabled from run params
  const runParams = run.params as { strategy?: { enable_hedge?: boolean } } | null;
  const enableHedge = runParams?.strategy?.enable_hedge ?? false;

  // Transform data for charts
  const equityCurveData: EquityCurveDataPoint[] = equityCurve.map((point) => ({
    time: point.ts,
    equity: point.total_equity,
  }));

  const exchangeEquityData: ExchangeEquityDataPoint[] = equityCurve.map((point) => ({
    time: point.ts,
    binance: point.binance_equity,
    bybit: point.bybit_equity,
  }));

  const pnlBreakdownData: PnLBreakdownDataPoint[] = pnlSeries.map((point) => ({
    time: point.ts,
    funding_pnl: point.total_funding_pnl,
    price_pnl: point.total_price_pnl,
    total_pnl: point.total_pnl,
    total_fee: point.total_fee,
  }));

  const cumulativePnLData: CumulativePnLDataPoint[] = pnlSeries.map((point) => ({
    time: point.ts,
    cumulative: point.total_pnl,
  }));

  // Calculate exposure from combined trades using equity curve
  const exposureData = calculateExposureFromCombinedTrades(combinedTrades, equityCurve);

  // Realtime positions data - include ts for filtering latest
  const realtimePositionData: RealtimePositionDataPoint[] = positions.map((pos) => ({
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

  // Individual trade PnL data will be calculated in the client component
  // based on the filtered combined trades and hedge mode
  const individualTradePnLData = combinedTrades
    .filter((trade) => trade.total_pnl !== null)
    .map((trade, index) => ({
      trade: String(index + 1),
      pnl: trade.total_pnl!,
    }));

  return (
    <div className="space-y-8">
      <RunDetailsHeader strategy={strategy} run={run} />

      <RunDetailsContent
        equityCurveData={equityCurveData}
        exchangeEquityData={exchangeEquityData}
        pnlBreakdownData={pnlBreakdownData}
        individualTradePnLData={individualTradePnLData}
        cumulativePnLData={cumulativePnLData}
        exposureData={exposureData}
        realtimePositionData={realtimePositionData}
        combinedTrades={combinedTrades}
        enableHedge={enableHedge}
      />
    </div>
  );
}
