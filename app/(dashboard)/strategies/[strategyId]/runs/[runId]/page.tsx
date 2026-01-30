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

// Calculate exposure series from equity curve position values
function calculateExposureFromEquityCurve(
  equityCurve: EquityCurve[]
): ExposureDataPoint[] {
  if (equityCurve.length === 0) return [];

  return equityCurve.map((point) => {
    // Calculate exposure percentage: (position_value / equity) * 100
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

  // Calculate exposure from equity curve position values
  const exposureData = calculateExposureFromEquityCurve(equityCurve);

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
