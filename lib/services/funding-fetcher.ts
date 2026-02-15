import type { FundingSnapshot, Exchange, CombinedFundingRate } from "@/lib/types/opportunity";

// Fetch funding rates from all exchanges in parallel
export async function fetchAllFundingRates(): Promise<CombinedFundingRate[]> {
  const [binance, bybit, bingx, gate, bitget, zoomex, bitmart] = await Promise.all([
    fetchBinanceFunding(),
    fetchBybitFunding(),
    fetchBingXFunding(),
    fetchGateFunding(),
    fetchBitgetFunding(),
    fetchZoomexFunding(),
    fetchBitMartFunding(),
  ]);

  // Merge all funding rates by symbol
  const symbolMap = new Map<string, CombinedFundingRate>();

  const addToMap = (snapshot: FundingSnapshot, exchangeKey: 'binance' | 'bybit' | 'bingx' | 'gate' | 'bitget' | 'zoomex' | 'bitmart') => {
    const symbol = normalizeSymbol(snapshot.symbol);
    if (!symbolMap.has(symbol)) {
      symbolMap.set(symbol, {
        symbol,
        binance: null,
        bybit: null,
        bingx: null,
        gate: null,
        bitget: null,
        zoomex: null,
        bitmart: null,
        updated_at: new Date().toISOString(),
      });
    }
    const entry = symbolMap.get(symbol)!;
    entry[exchangeKey] = { ...snapshot, symbol };
  };

  binance.forEach(s => addToMap(s, 'binance'));
  bybit.forEach(s => addToMap(s, 'bybit'));
  bingx.forEach(s => addToMap(s, 'bingx'));
  gate.forEach(s => addToMap(s, 'gate'));
  bitget.forEach(s => addToMap(s, 'bitget'));
  zoomex.forEach(s => addToMap(s, 'zoomex'));
  bitmart.forEach(s => addToMap(s, 'bitmart'));

  return Array.from(symbolMap.values());
}

// Normalize symbol to standard format (e.g., BTCUSDT)
function normalizeSymbol(symbol: string): string {
  return symbol
    .replace(/-/g, '')
    .replace(/_/g, '')
    .replace(/USDT$/, 'USDT')
    .toUpperCase();
}

// Binance Futures funding rates
async function fetchBinanceFunding(): Promise<FundingSnapshot[]> {
  try {
    const [premiumRes, infoRes] = await Promise.all([
      fetch('https://fapi.binance.com/fapi/v1/premiumIndex'),
      fetch('https://fapi.binance.com/fapi/v1/fundingInfo'),
    ]);

    if (!premiumRes.ok || !infoRes.ok) return [];

    const premiumData = await premiumRes.json();
    const infoData = await infoRes.json();

    // Create interval map from fundingInfo
    const intervalMap = new Map<string, number>();
    for (const info of infoData) {
      // Binance returns interval in milliseconds
      const intervalHours = info.fundingIntervalHours || 8;
      intervalMap.set(info.symbol, intervalHours);
    }

    return premiumData
      .filter((item: { symbol: string }) => item.symbol.endsWith('USDT'))
      .map((item: {
        symbol: string;
        lastFundingRate: string;
        nextFundingTime: number;
        markPrice: string;
      }) => ({
        symbol: item.symbol,
        exchange: 'Binance' as Exchange,
        funding_rate: parseFloat(item.lastFundingRate),
        funding_interval_hours: intervalMap.get(item.symbol) || 8,
        next_funding_time: new Date(item.nextFundingTime).toISOString(),
        mark_price: parseFloat(item.markPrice),
        fetched_at: new Date().toISOString(),
      }));
  } catch (e) {
    console.error('Binance funding fetch error:', e);
    return [];
  }
}

// Bybit Futures funding rates
async function fetchBybitFunding(): Promise<FundingSnapshot[]> {
  try {
    // Fetch both tickers and instruments info in parallel
    const [tickersRes, instrumentsRes] = await Promise.all([
      fetch('https://api.bybit.com/v5/market/tickers?category=linear'),
      fetch('https://api.bybit.com/v5/market/instruments-info?category=linear'),
    ]);

    if (!tickersRes.ok || !instrumentsRes.ok) return [];

    const tickersData = await tickersRes.json();
    const instrumentsData = await instrumentsRes.json();

    if (tickersData.retCode !== 0 || instrumentsData.retCode !== 0) return [];

    // Build interval map from instruments info
    // fundingInterval is in minutes
    const intervalMap = new Map<string, number>();
    for (const inst of instrumentsData.result.list) {
      const intervalMinutes = parseInt(inst.fundingInterval) || 480; // default 480 min = 8h
      intervalMap.set(inst.symbol, intervalMinutes / 60); // convert to hours
    }

    return tickersData.result.list
      .filter((item: { symbol: string }) => item.symbol.endsWith('USDT'))
      .map((item: {
        symbol: string;
        fundingRate: string;
        nextFundingTime: string;
        markPrice: string;
      }) => ({
        symbol: item.symbol,
        exchange: 'Bybit' as Exchange,
        funding_rate: parseFloat(item.fundingRate),
        funding_interval_hours: intervalMap.get(item.symbol) || 8,
        next_funding_time: new Date(parseInt(item.nextFundingTime)).toISOString(),
        mark_price: parseFloat(item.markPrice),
        fetched_at: new Date().toISOString(),
      }));
  } catch (e) {
    console.error('Bybit funding fetch error:', e);
    return [];
  }
}

// BingX Futures funding rates
async function fetchBingXFunding(): Promise<FundingSnapshot[]> {
  try {
    const res = await fetch('https://open-api.bingx.com/openApi/swap/v2/quote/premiumIndex');
    if (!res.ok) return [];

    const data = await res.json();
    if (data.code !== 0) return [];

    return data.data
      .filter((item: { symbol: string }) => item.symbol.includes('-USDT'))
      .map((item: {
        symbol: string;
        lastFundingRate: string;
        nextFundingTime: number;
        markPrice: string;
      }) => ({
        symbol: item.symbol.replace('-', ''),
        exchange: 'BingX' as Exchange,
        funding_rate: parseFloat(item.lastFundingRate),
        funding_interval_hours: 8,
        next_funding_time: new Date(item.nextFundingTime).toISOString(),
        mark_price: parseFloat(item.markPrice),
        fetched_at: new Date().toISOString(),
      }));
  } catch (e) {
    console.error('BingX funding fetch error:', e);
    return [];
  }
}

// Gate.io Futures funding rates
async function fetchGateFunding(): Promise<FundingSnapshot[]> {
  try {
    const res = await fetch('https://api.gateio.ws/api/v4/futures/usdt/contracts');
    if (!res.ok) return [];

    const data = await res.json();

    return data
      .filter((item: { name: string; in_delisting: boolean }) =>
        item.name.endsWith('_USDT') && !item.in_delisting
      )
      .map((item: {
        name: string;
        funding_rate: string;
        funding_next_apply: number;
        mark_price: string;
        funding_interval: number;
      }) => ({
        symbol: item.name.replace('_', ''),
        exchange: 'Gate' as Exchange,
        funding_rate: parseFloat(item.funding_rate),
        funding_interval_hours: item.funding_interval / 3600 || 8,
        next_funding_time: new Date(item.funding_next_apply * 1000).toISOString(),
        mark_price: parseFloat(item.mark_price),
        fetched_at: new Date().toISOString(),
      }));
  } catch (e) {
    console.error('Gate funding fetch error:', e);
    return [];
  }
}

// Calculate next funding time based on interval (funding happens at fixed UTC times)
function calculateNextFundingTime(intervalHours: number): Date {
  const now = new Date();
  const utcHours = now.getUTCHours();
  const utcMinutes = now.getUTCMinutes();

  // Find the next funding time slot
  const fundingTimes: number[] = [];
  for (let h = 0; h < 24; h += intervalHours) {
    fundingTimes.push(h);
  }

  let nextFundingHour = fundingTimes.find(h => h > utcHours || (h === utcHours && utcMinutes < 0));

  const result = new Date(now);
  result.setUTCMinutes(0, 0, 0);

  if (nextFundingHour !== undefined) {
    result.setUTCHours(nextFundingHour);
  } else {
    // Next funding is tomorrow at first slot
    result.setUTCDate(result.getUTCDate() + 1);
    result.setUTCHours(fundingTimes[0]);
  }

  return result;
}

// Bitget Futures funding rates
async function fetchBitgetFunding(): Promise<FundingSnapshot[]> {
  try {
    // Fetch both tickers and contracts info in parallel
    const [tickersRes, contractsRes] = await Promise.all([
      fetch('https://api.bitget.com/api/v2/mix/market/tickers?productType=USDT-FUTURES'),
      fetch('https://api.bitget.com/api/v2/mix/market/contracts?productType=USDT-FUTURES'),
    ]);

    if (!tickersRes.ok || !contractsRes.ok) return [];

    const tickersData = await tickersRes.json();
    const contractsData = await contractsRes.json();

    if (tickersData.code !== '00000' || contractsData.code !== '00000') return [];

    // Build interval map from contracts info
    // fundInterval is in hours
    const intervalMap = new Map<string, number>();
    for (const contract of contractsData.data) {
      const intervalHours = parseInt(contract.fundInterval) || 8;
      intervalMap.set(contract.symbol, intervalHours);
    }

    return tickersData.data
      .filter((item: { symbol: string }) => item.symbol.endsWith('USDT'))
      .map((item: {
        symbol: string;
        fundingRate: string;
        markPrice: string;
      }) => {
        const intervalHours = intervalMap.get(item.symbol) || 8;
        return {
          symbol: item.symbol,
          exchange: 'Bitget' as Exchange,
          funding_rate: parseFloat(item.fundingRate),
          funding_interval_hours: intervalHours,
          next_funding_time: calculateNextFundingTime(intervalHours).toISOString(),
          mark_price: parseFloat(item.markPrice),
          fetched_at: new Date().toISOString(),
        };
      });
  } catch (e) {
    console.error('Bitget funding fetch error:', e);
    return [];
  }
}

// Zoomex Futures funding rates - currently disabled due to API access issues
async function fetchZoomexFunding(): Promise<FundingSnapshot[]> {
  // Zoomex API is not accessible from this region
  // Return empty array for now
  return [];
}

// BitMart Futures funding rates
async function fetchBitMartFunding(): Promise<FundingSnapshot[]> {
  try {
    const res = await fetch('https://api-cloud-v2.bitmart.com/contract/public/details');
    if (!res.ok) return [];

    const data = await res.json();
    if (data.code !== 1000) return [];

    return data.data.symbols
      .filter((item: { symbol: string; status: string }) =>
        item.symbol.endsWith('USDT') && item.status === 'Trading'
      )
      .map((item: {
        symbol: string;
        funding_rate: string;
        expected_funding_rate: string;
        funding_time: number;
        funding_interval_hours: number;
        last_price: string;
        index_price: string;
      }) => ({
        symbol: item.symbol,
        exchange: 'BitMart' as Exchange,
        funding_rate: parseFloat(item.funding_rate || item.expected_funding_rate || '0'),
        funding_interval_hours: item.funding_interval_hours || 8,
        next_funding_time: new Date(item.funding_time).toISOString(),
        mark_price: parseFloat(item.index_price || item.last_price),
        fetched_at: new Date().toISOString(),
      }));
  } catch (e) {
    console.error('BitMart funding fetch error:', e);
    return [];
  }
}
