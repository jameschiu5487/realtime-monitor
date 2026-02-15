import type {
  Opportunity,
  OpportunityStats,
  CombinedFundingRate,
  FundingSnapshot,
  Exchange,
  ExchangePair,
} from "@/lib/types/opportunity";

const MIN_RATE_SPREAD_BPS = 3.0;
const ENTRY_WINDOW_MINUTES = 10;

interface ExchangePairConfig {
  pair: ExchangePair;
  exchangeA: Exchange;
  exchangeB: Exchange;
  keyA: keyof CombinedFundingRate;
  keyB: keyof CombinedFundingRate;
}

const EXCHANGE_PAIRS: ExchangePairConfig[] = [
  { pair: 'BinanceBybit', exchangeA: 'Binance', exchangeB: 'Bybit', keyA: 'binance', keyB: 'bybit' },
  { pair: 'BinanceBingX', exchangeA: 'Binance', exchangeB: 'BingX', keyA: 'binance', keyB: 'bingx' },
  { pair: 'BinanceGate', exchangeA: 'Binance', exchangeB: 'Gate', keyA: 'binance', keyB: 'gate' },
  { pair: 'BinanceBitget', exchangeA: 'Binance', exchangeB: 'Bitget', keyA: 'binance', keyB: 'bitget' },
  { pair: 'BinanceZoomex', exchangeA: 'Binance', exchangeB: 'Zoomex', keyA: 'binance', keyB: 'zoomex' },
  { pair: 'BinanceBitMart', exchangeA: 'Binance', exchangeB: 'BitMart', keyA: 'binance', keyB: 'bitmart' },
  { pair: 'BybitBingX', exchangeA: 'Bybit', exchangeB: 'BingX', keyA: 'bybit', keyB: 'bingx' },
  { pair: 'BybitGate', exchangeA: 'Bybit', exchangeB: 'Gate', keyA: 'bybit', keyB: 'gate' },
  { pair: 'BybitBitget', exchangeA: 'Bybit', exchangeB: 'Bitget', keyA: 'bybit', keyB: 'bitget' },
  { pair: 'BybitZoomex', exchangeA: 'Bybit', exchangeB: 'Zoomex', keyA: 'bybit', keyB: 'zoomex' },
  { pair: 'BybitBitMart', exchangeA: 'Bybit', exchangeB: 'BitMart', keyA: 'bybit', keyB: 'bitmart' },
  { pair: 'BingXGate', exchangeA: 'BingX', exchangeB: 'Gate', keyA: 'bingx', keyB: 'gate' },
  { pair: 'BingXBitget', exchangeA: 'BingX', exchangeB: 'Bitget', keyA: 'bingx', keyB: 'bitget' },
  { pair: 'BingXZoomex', exchangeA: 'BingX', exchangeB: 'Zoomex', keyA: 'bingx', keyB: 'zoomex' },
  { pair: 'BingXBitMart', exchangeA: 'BingX', exchangeB: 'BitMart', keyA: 'bingx', keyB: 'bitmart' },
  { pair: 'GateBitget', exchangeA: 'Gate', exchangeB: 'Bitget', keyA: 'gate', keyB: 'bitget' },
  { pair: 'GateZoomex', exchangeA: 'Gate', exchangeB: 'Zoomex', keyA: 'gate', keyB: 'zoomex' },
  { pair: 'GateBitMart', exchangeA: 'Gate', exchangeB: 'BitMart', keyA: 'gate', keyB: 'bitmart' },
  { pair: 'BitgetZoomex', exchangeA: 'Bitget', exchangeB: 'Zoomex', keyA: 'bitget', keyB: 'zoomex' },
  { pair: 'BitgetBitMart', exchangeA: 'Bitget', exchangeB: 'BitMart', keyA: 'bitget', keyB: 'bitmart' },
  { pair: 'ZoomexBitMart', exchangeA: 'Zoomex', exchangeB: 'BitMart', keyA: 'zoomex', keyB: 'bitmart' },
];

export function detectOpportunities(fundingRates: CombinedFundingRate[]): Opportunity[] {
  const opportunities: Opportunity[] = [];
  const now = Date.now();

  for (const rate of fundingRates) {
    for (const pairConfig of EXCHANGE_PAIRS) {
      const snapshotA = rate[pairConfig.keyA] as FundingSnapshot | null;
      const snapshotB = rate[pairConfig.keyB] as FundingSnapshot | null;

      if (!snapshotA || !snapshotB) continue;

      const rateA = snapshotA.funding_rate * 10000; // Convert to bps
      const rateB = snapshotB.funding_rate * 10000;
      const rateSpread = Math.abs(rateA - rateB);

      // Calculate time to funding for each exchange
      const nextFundingA = new Date(snapshotA.next_funding_time).getTime();
      const nextFundingB = new Date(snapshotB.next_funding_time).getTime();
      const timeToFundingASecs = Math.floor((nextFundingA - now) / 1000);
      const timeToFundingBSecs = Math.floor((nextFundingB - now) / 1000);
      const minTimeToFunding = Math.min(timeToFundingASecs, timeToFundingBSecs);

      // Check if in entry window (either exchange)
      const isInEntryWindow = minTimeToFunding <= ENTRY_WINDOW_MINUTES * 60 && minTimeToFunding > 0;

      // Determine opportunity type based on next funding time
      // If funding times are within 5 minutes of each other, consider them the same
      const fundingTimeDiffSecs = Math.abs(timeToFundingASecs - timeToFundingBSecs);
      const sameFundingTime = fundingTimeDiffSecs < 300; // Within 5 minutes
      const opportunityType = sameFundingTime ? 'RateArbitrage' : 'IntervalMismatch';

      // Calculate effective spread based on opportunity type
      let effectiveSpread: number;
      let shortExchange: Exchange;
      let longExchange: Exchange;

      if (sameFundingTime) {
        // Rate Arbitrage: both exchanges pay at same time, spread = difference
        effectiveSpread = rateSpread;
        [shortExchange, longExchange] = rateA > rateB
          ? [pairConfig.exchangeA, pairConfig.exchangeB]
          : [pairConfig.exchangeB, pairConfig.exchangeA];
      } else {
        // Interval Mismatch: only the exchange with sooner funding pays
        // Use the rate from the exchange with nearer funding time
        const aHasSoonerFunding = timeToFundingASecs < timeToFundingBSecs;
        const soonerRate = aHasSoonerFunding ? rateA : rateB;
        const soonerExchange = aHasSoonerFunding ? pairConfig.exchangeA : pairConfig.exchangeB;
        const laterExchange = aHasSoonerFunding ? pairConfig.exchangeB : pairConfig.exchangeA;

        // Effective spread is the absolute rate of the sooner funding exchange
        effectiveSpread = Math.abs(soonerRate);

        // Direction: if rate is positive, short the sooner exchange to receive funding
        // if rate is negative, long the sooner exchange to receive funding
        if (soonerRate > 0) {
          shortExchange = soonerExchange;
          longExchange = laterExchange;
        } else {
          longExchange = soonerExchange;
          shortExchange = laterExchange;
        }
      }

      if (effectiveSpread < MIN_RATE_SPREAD_BPS) continue;

      // Calculate annualized return based on the shorter interval
      const effectiveIntervalHours = Math.min(snapshotA.funding_interval_hours, snapshotB.funding_interval_hours);
      const periodsPerYear = (365 * 24) / effectiveIntervalHours;
      const annualizedReturn = effectiveSpread * periodsPerYear / 100; // Convert bps to percentage

      opportunities.push({
        symbol: rate.symbol,
        exchange_pair: pairConfig.pair,
        opportunity_type: opportunityType,
        exchange_a: pairConfig.exchangeA,
        exchange_a_rate: snapshotA.funding_rate,
        exchange_a_rate_bps: rateA,
        exchange_a_interval_hours: snapshotA.funding_interval_hours,
        exchange_a_next_funding: snapshotA.next_funding_time,
        exchange_b: pairConfig.exchangeB,
        exchange_b_rate: snapshotB.funding_rate,
        exchange_b_rate_bps: rateB,
        exchange_b_interval_hours: snapshotB.funding_interval_hours,
        exchange_b_next_funding: snapshotB.next_funding_time,
        rate_spread_bps: effectiveSpread,
        annualized_return_pct: annualizedReturn,
        short_exchange: shortExchange,
        long_exchange: longExchange,
        time_to_funding_a_secs: timeToFundingASecs,
        time_to_funding_b_secs: timeToFundingBSecs,
        is_in_entry_window: isInEntryWindow,
        exchange_a_spread_bps: null,
        exchange_b_spread_bps: null,
        total_spread_cost_bps: null,
        net_profit_bps: effectiveSpread, // Without spread cost, net = gross
        detected_at: new Date().toISOString(),
      });
    }
  }

  // Sort by net profit descending
  opportunities.sort((a, b) => (b.net_profit_bps ?? 0) - (a.net_profit_bps ?? 0));

  return opportunities;
}

export function calculateStats(opportunities: Opportunity[]): OpportunityStats {
  const rateArbCount = opportunities.filter(o => o.opportunity_type === 'RateArbitrage').length;
  const intervalMismatchCount = opportunities.filter(o => o.opportunity_type === 'IntervalMismatch').length;
  const inEntryWindow = opportunities.filter(o => o.is_in_entry_window).length;
  const profitable = opportunities.filter(o => (o.net_profit_bps ?? 0) > 0).length;

  const byExchangePair: Record<ExchangePair, number> = {} as Record<ExchangePair, number>;
  for (const opp of opportunities) {
    byExchangePair[opp.exchange_pair] = (byExchangePair[opp.exchange_pair] || 0) + 1;
  }

  const bestOpportunity = opportunities.length > 0 ? opportunities[0] : null;
  const bestNetProfit = bestOpportunity?.net_profit_bps ?? null;

  const avgSpreadBps = opportunities.length > 0
    ? opportunities.reduce((sum, o) => sum + o.rate_spread_bps, 0) / opportunities.length
    : null;

  return {
    total: opportunities.length,
    rate_arb_count: rateArbCount,
    interval_mismatch_count: intervalMismatchCount,
    in_entry_window: inEntryWindow,
    profitable,
    by_exchange_pair: byExchangePair,
    best_opportunity: bestOpportunity,
    best_net_profit: bestNetProfit,
    avg_spread_bps: avgSpreadBps,
    updated_at: new Date().toISOString(),
  };
}
