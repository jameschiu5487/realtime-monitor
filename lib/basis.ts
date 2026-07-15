export type Market = "perp" | "spot";
// Alpaca 為美股實盤數據（僅 spot 市場）
export type BasisExchange = "Binance" | "Bybit" | "Alpaca";

export const BASIS_EXCHANGES: BasisExchange[] = ["Binance", "Bybit", "Alpaca"];
export const MARKETS: Market[] = ["perp", "spot"];

export interface BasisLeg {
  exchange: BasisExchange;
  market: Market;
  symbol: string;
}

export interface BasisPoint {
  time: number; // ms timestamp（K 線 open time）
  leg1: number;
  leg2: number;
  basisPct: number; // (leg1 - leg2) / leg2 * 100
  basisAbs: number; // leg1 - leg2（USDT）
  fresh: boolean; // 兩腳當根都有真實成交價；false = 有一腳是 forward-fill（如美股休市）
}

// 兩腳 K 線以 open time 取聯集，缺的一腳用最後收盤價 forward-fill——
// 時間軸保持連續（美股休市、交易所缺 K 都不會斷），fresh 標記供圖表區分底色
export function computeBasisSeries(
  leg1Klines: [number, number][],
  leg2Klines: [number, number][]
): BasisPoint[] {
  const leg1Map = new Map(leg1Klines);
  const leg2Map = new Map(leg2Klines);
  const times = [...new Set([...leg1Map.keys(), ...leg2Map.keys()])].sort((a, b) => a - b);
  const points: BasisPoint[] = [];
  let p1: number | undefined;
  let p2: number | undefined;
  for (const time of times) {
    const r1 = leg1Map.get(time);
    const r2 = leg2Map.get(time);
    if (r1 !== undefined) p1 = r1;
    if (r2 !== undefined) p2 = r2;
    if (p1 === undefined || p2 === undefined || p2 === 0) continue;
    points.push({
      time,
      leg1: p1,
      leg2: p2,
      basisPct: ((p1 - p2) / p2) * 100,
      basisAbs: p1 - p2,
      fresh: r1 !== undefined && r2 !== undefined,
    });
  }
  return points;
}

export function legLabel(leg: BasisLeg): string {
  return `${leg.symbol} ${leg.exchange} ${leg.market}`;
}

export function pairLabel(leg1: BasisLeg, leg2: BasisLeg): string {
  return `${legLabel(leg1)} / ${legLabel(leg2)}`;
}
