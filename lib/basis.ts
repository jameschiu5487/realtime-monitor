export type Market = "perp" | "spot";
export type BasisExchange = "Binance" | "Bybit";

export const BASIS_EXCHANGES: BasisExchange[] = ["Binance", "Bybit"];
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
}

// 兩腳 K 線以 open time join，任一腳缺的蠟燭直接丟棄（跨交易所偶有缺 K）
export function computeBasisSeries(
  leg1Klines: [number, number][],
  leg2Klines: [number, number][]
): BasisPoint[] {
  const leg2Map = new Map(leg2Klines);
  const points: BasisPoint[] = [];
  for (const [time, p1] of leg1Klines) {
    const p2 = leg2Map.get(time);
    if (p2 === undefined || p2 === 0) continue;
    points.push({
      time,
      leg1: p1,
      leg2: p2,
      basisPct: ((p1 - p2) / p2) * 100,
      basisAbs: p1 - p2,
    });
  }
  return points.sort((a, b) => a.time - b.time);
}

export function legLabel(leg: BasisLeg): string {
  return `${leg.symbol} ${leg.exchange} ${leg.market}`;
}

export function pairLabel(leg1: BasisLeg, leg2: BasisLeg): string {
  return `${legLabel(leg1)} / ${legLabel(leg2)}`;
}
