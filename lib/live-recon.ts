/**
 * Live vs shadow reconciliation: the live funding-arb runs' realised trades,
 * matched to the shadow events they traded.
 *
 * Units (verified 2026-10-05 trade by trade against CARV/ARK/EWZ/LYN): the
 * shadow's y_bp, funding_bp and fee are bp of BOTH legs' entry notional added
 * together — the live legs' funding and commission divided by that sum land
 * on the shadow's funding_bp and on 4.4 bp. Dividing by one leg doubles them.
 */

/** Live strategies that trade the shadow's events. Both run the model now. */
export const LIVE_STRATEGIES = [
  { id: "9b07876d-710a-4d59-9589-fba3a89f4841", name: "Super_Newtonz", note: "basis funding + model" },
  { id: "b2c3d4e5-f6a7-8901-bcde-f12345678901", name: "Newtonz", note: "newton_z + model" },
] as const;

/** One combined_trades leg as the page reads it. */
export interface LiveLeg {
  run_id: string;
  symbol: string;
  ts: string;
  quantity: number;
  entry_price: number;
  holding_period_hours: number | null;
  price_pnl: number | null;
  funding_fee_realized: number | null;
  commission_fee: number | null;
}

/** Both legs of one live position, in bp of their summed entry notional. */
export interface LiveTrade {
  strategy: string;
  symbol: string;
  entryMs: number;
  exitMs: number;
  grossUsd: number;
  legs: number;
  priceBp: number;
  fundingBp: number;
  /** Commission, negative. */
  feeBp: number;
  netBp: number;
}

/** Legs of one position are written a few ms apart. */
const LEG_GAP_MS = 60_000;
const HOUR_MS = 60 * 60 * 1000;

export function pairLegs(legs: LiveLeg[], strategyOfRun: Map<string, string>): LiveTrade[] {
  const sorted = [...legs].sort(
    (a, b) => a.run_id.localeCompare(b.run_id) || a.symbol.localeCompare(b.symbol) || Date.parse(a.ts) - Date.parse(b.ts)
  );
  const out: LiveTrade[] = [];
  let group: LiveLeg[] = [];
  const flush = () => {
    if (group.length === 0) return;
    const gross = group.reduce((s, l) => s + Math.abs(Number(l.quantity) * Number(l.entry_price)), 0);
    if (gross > 0) {
      const sum = (f: (l: LiveLeg) => number | null) => group.reduce((s, l) => s + Number(f(l) ?? 0), 0);
      const exitMs = Math.max(...group.map((l) => Date.parse(l.ts)));
      const holdH = Math.max(...group.map((l) => Number(l.holding_period_hours ?? 0)));
      const priceBp = (1e4 * sum((l) => l.price_pnl)) / gross;
      const fundingBp = (1e4 * sum((l) => l.funding_fee_realized)) / gross;
      const feeBp = (1e4 * sum((l) => l.commission_fee)) / gross;
      out.push({
        strategy: strategyOfRun.get(group[0].run_id) ?? "Unknown",
        symbol: group[0].symbol,
        entryMs: exitMs - holdH * HOUR_MS,
        exitMs,
        grossUsd: gross,
        legs: group.length,
        priceBp,
        fundingBp,
        feeBp,
        netBp: priceBp + fundingBp + feeBp,
      });
    }
    group = [];
  };
  for (const l of sorted) {
    const prev = group[group.length - 1];
    if (prev && (prev.run_id !== l.run_id || prev.symbol !== l.symbol || Date.parse(l.ts) - Date.parse(prev.ts) > LEG_GAP_MS)) flush();
    group.push(l);
  }
  flush();
  return out.sort((a, b) => b.exitMs - a.exitMs);
}

/** Event-level shadow facts; y and settled funding don't depend on the model. */
export interface ShadowEvent {
  ts: number;
  symbol: string;
  y: number | null;
  settledFunding: number | null;
  expFunding: number | null;
}

export interface MatchedTrade extends LiveTrade {
  /** Settlement the trade was matched to; null when it crossed none with a shadow event. */
  settleTs: number | null;
  /** Whole-hour settlements inside the hold that have a shadow event. */
  settlementsCrossed: number;
  event: ShadowEvent | null;
}

/**
 * The settlement a position traded is a whole hour inside (entry, exit]. A
 * position can close before any (stopped out) or straddle several (a 4 h
 * hold); the latest hour with a shadow event for the symbol is the one taken.
 */
export function matchTrades(trades: LiveTrade[], events: Map<string, ShadowEvent>): MatchedTrade[] {
  return trades.map((t) => {
    let event: ShadowEvent | null = null;
    let crossed = 0;
    for (let h = Math.floor(t.exitMs / HOUR_MS) * HOUR_MS; h > t.entryMs; h -= HOUR_MS) {
      const e = events.get(`${h}|${t.symbol}`);
      if (!e) continue;
      crossed++;
      event ??= e;
    }
    return { ...t, settleTs: event?.ts ?? null, settlementsCrossed: crossed, event };
  });
}
