export type Exchange = 'Binance' | 'Bybit' | 'BingX' | 'Gate' | 'Bitget' | 'Zoomex' | 'BitMart';

export type ExchangePair =
  | 'BinanceBybit' | 'BinanceBingX' | 'BinanceGate' | 'BinanceBitget' | 'BinanceZoomex' | 'BinanceBitMart'
  | 'BybitBingX' | 'BybitGate' | 'BybitBitget' | 'BybitZoomex' | 'BybitBitMart'
  | 'BingXGate' | 'BingXBitget' | 'BingXZoomex' | 'BingXBitMart'
  | 'GateBitget' | 'GateZoomex' | 'GateBitMart'
  | 'BitgetZoomex' | 'BitgetBitMart'
  | 'ZoomexBitMart';

export type OpportunityType = 'RateArbitrage' | 'IntervalMismatch';

export interface Opportunity {
  symbol: string;
  exchange_pair: ExchangePair;
  opportunity_type: OpportunityType;

  // Exchange A data (first exchange in pair)
  exchange_a: Exchange;
  exchange_a_rate: number;
  exchange_a_rate_bps: number;
  exchange_a_interval_hours: number;
  exchange_a_next_funding: string;

  // Exchange B data (second exchange in pair)
  exchange_b: Exchange;
  exchange_b_rate: number;
  exchange_b_rate_bps: number;
  exchange_b_interval_hours: number;
  exchange_b_next_funding: string;

  // Calculated metrics
  rate_spread_bps: number;
  annualized_return_pct: number;
  short_exchange: Exchange;
  long_exchange: Exchange;
  time_to_funding_a_secs: number;
  time_to_funding_b_secs: number;
  is_in_entry_window: boolean;

  // Cost analysis
  exchange_a_spread_bps: number | null;
  exchange_b_spread_bps: number | null;
  total_spread_cost_bps: number | null;
  net_profit_bps: number | null;

  detected_at: string;
}

export interface OpportunityStats {
  total: number;
  rate_arb_count: number;
  interval_mismatch_count: number;
  in_entry_window: number;
  profitable: number;
  by_exchange_pair: Record<ExchangePair, number>;
  best_opportunity: Opportunity | null;
  best_net_profit: number | null;
  avg_spread_bps: number | null;
  updated_at: string;
}

export interface BidAskSpread {
  symbol: string;
  exchange: Exchange;
  best_bid: number;
  best_ask: number;
  bid_size: number;
  ask_size: number;
  spread_bps: number;
  mid_price: number;
  updated_at: string;
}

export interface CombinedSpread {
  symbol: string;
  binance: BidAskSpread | null;
  bybit: BidAskSpread | null;
  bingx: BidAskSpread | null;
  gate: BidAskSpread | null;
  bitget: BidAskSpread | null;
  zoomex: BidAskSpread | null;
  bitmart: BidAskSpread | null;
  updated_at: string;
}

export interface FundingSnapshot {
  symbol: string;
  exchange: Exchange;
  funding_rate: number;
  funding_interval_hours: number;
  next_funding_time: string;
  mark_price: number;
  fetched_at: string;
}

export interface CombinedFundingRate {
  symbol: string;
  binance: FundingSnapshot | null;
  bybit: FundingSnapshot | null;
  bingx: FundingSnapshot | null;
  gate: FundingSnapshot | null;
  bitget: FundingSnapshot | null;
  zoomex: FundingSnapshot | null;
  bitmart: FundingSnapshot | null;
  updated_at: string;
}

// SSE Message types
export interface SseMessage {
  type: 'opportunities' | 'spreads' | 'stats' | 'heartbeat' | 'funding_rates';
  data: OpportunitiesPayload | SpreadsPayload | StatsPayload | HeartbeatPayload | FundingRatesPayload;
}

export interface OpportunitiesPayload {
  opportunities: Opportunity[];
  count: number;
}

export interface SpreadsPayload {
  spreads: CombinedSpread[];
  count: number;
}

export interface StatsPayload {
  stats: OpportunityStats;
}

export interface HeartbeatPayload {
  timestamp: string;
}

export interface FundingRatesPayload {
  funding_rates: CombinedFundingRate[];
  count: number;
}

// Helper constants
export const ALL_EXCHANGES: Exchange[] = ['Binance', 'Bybit', 'BingX', 'Gate', 'Bitget', 'Zoomex', 'BitMart'];

export const ALL_EXCHANGE_PAIRS: ExchangePair[] = [
  'BinanceBybit', 'BinanceBingX', 'BinanceGate', 'BinanceBitget', 'BinanceZoomex', 'BinanceBitMart',
  'BybitBingX', 'BybitGate', 'BybitBitget', 'BybitZoomex', 'BybitBitMart',
  'BingXGate', 'BingXBitget', 'BingXZoomex', 'BingXBitMart',
  'GateBitget', 'GateZoomex', 'GateBitMart',
  'BitgetZoomex', 'BitgetBitMart',
  'ZoomexBitMart'
];

export function getExchangePairDisplayName(pair: ExchangePair): string {
  switch (pair) {
    case 'BinanceBybit': return 'Binance-Bybit';
    case 'BinanceBingX': return 'Binance-BingX';
    case 'BinanceGate': return 'Binance-Gate';
    case 'BinanceBitget': return 'Binance-Bitget';
    case 'BinanceZoomex': return 'Binance-Zoomex';
    case 'BinanceBitMart': return 'Binance-BitMart';
    case 'BybitBingX': return 'Bybit-BingX';
    case 'BybitGate': return 'Bybit-Gate';
    case 'BybitBitget': return 'Bybit-Bitget';
    case 'BybitZoomex': return 'Bybit-Zoomex';
    case 'BybitBitMart': return 'Bybit-BitMart';
    case 'BingXGate': return 'BingX-Gate';
    case 'BingXBitget': return 'BingX-Bitget';
    case 'BingXZoomex': return 'BingX-Zoomex';
    case 'BingXBitMart': return 'BingX-BitMart';
    case 'GateBitget': return 'Gate-Bitget';
    case 'GateZoomex': return 'Gate-Zoomex';
    case 'GateBitMart': return 'Gate-BitMart';
    case 'BitgetZoomex': return 'Bitget-Zoomex';
    case 'BitgetBitMart': return 'Bitget-BitMart';
    case 'ZoomexBitMart': return 'Zoomex-BitMart';
  }
}

export function getExchangePairsFromSelections(exchanges: Exchange[]): ExchangePair[] {
  const pairs: ExchangePair[] = [];
  const exchangeSet = new Set(exchanges);

  if (exchangeSet.has('Binance') && exchangeSet.has('Bybit')) pairs.push('BinanceBybit');
  if (exchangeSet.has('Binance') && exchangeSet.has('BingX')) pairs.push('BinanceBingX');
  if (exchangeSet.has('Binance') && exchangeSet.has('Gate')) pairs.push('BinanceGate');
  if (exchangeSet.has('Binance') && exchangeSet.has('Bitget')) pairs.push('BinanceBitget');
  if (exchangeSet.has('Binance') && exchangeSet.has('Zoomex')) pairs.push('BinanceZoomex');
  if (exchangeSet.has('Binance') && exchangeSet.has('BitMart')) pairs.push('BinanceBitMart');
  if (exchangeSet.has('Bybit') && exchangeSet.has('BingX')) pairs.push('BybitBingX');
  if (exchangeSet.has('Bybit') && exchangeSet.has('Gate')) pairs.push('BybitGate');
  if (exchangeSet.has('Bybit') && exchangeSet.has('Bitget')) pairs.push('BybitBitget');
  if (exchangeSet.has('Bybit') && exchangeSet.has('Zoomex')) pairs.push('BybitZoomex');
  if (exchangeSet.has('Bybit') && exchangeSet.has('BitMart')) pairs.push('BybitBitMart');
  if (exchangeSet.has('BingX') && exchangeSet.has('Gate')) pairs.push('BingXGate');
  if (exchangeSet.has('BingX') && exchangeSet.has('Bitget')) pairs.push('BingXBitget');
  if (exchangeSet.has('BingX') && exchangeSet.has('Zoomex')) pairs.push('BingXZoomex');
  if (exchangeSet.has('BingX') && exchangeSet.has('BitMart')) pairs.push('BingXBitMart');
  if (exchangeSet.has('Gate') && exchangeSet.has('Bitget')) pairs.push('GateBitget');
  if (exchangeSet.has('Gate') && exchangeSet.has('Zoomex')) pairs.push('GateZoomex');
  if (exchangeSet.has('Gate') && exchangeSet.has('BitMart')) pairs.push('GateBitMart');
  if (exchangeSet.has('Bitget') && exchangeSet.has('Zoomex')) pairs.push('BitgetZoomex');
  if (exchangeSet.has('Bitget') && exchangeSet.has('BitMart')) pairs.push('BitgetBitMart');
  if (exchangeSet.has('Zoomex') && exchangeSet.has('BitMart')) pairs.push('ZoomexBitMart');

  return pairs;
}
