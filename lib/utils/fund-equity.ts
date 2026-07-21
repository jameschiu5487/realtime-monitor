import type { FundAccountEquity } from "@/lib/types/database";
import type { ChartDataPoint } from "@/lib/utils/equity";

export type FundEquityRange = "24h" | "7d" | "30d";

export function rangeToMs(range: FundEquityRange): number {
  switch (range) {
    case "24h":
      return 24 * 60 * 60 * 1000;
    case "7d":
      return 7 * 24 * 60 * 60 * 1000;
    case "30d":
      return 30 * 24 * 60 * 60 * 1000;
  }
}

/** Latest row per account_id (max ts wins). */
export function latestByAccount(
  rows: FundAccountEquity[]
): Map<string, FundAccountEquity> {
  const map = new Map<string, FundAccountEquity>();
  for (const row of rows) {
    const prev = map.get(row.account_id);
    if (!prev || new Date(row.ts).getTime() > new Date(prev.ts).getTime()) {
      map.set(row.account_id, row);
    }
  }
  return map;
}

export function totalEquityFromLatest(
  latest: Map<string, FundAccountEquity>
): number {
  let sum = 0;
  for (const row of latest.values()) {
    sum += Number(row.total_equity);
  }
  return sum;
}

export function summarizeByExchange(
  latest: Map<string, FundAccountEquity>
): {
  exchange: string;
  total: number;
  accounts: { account_id: string; total_equity: number }[];
}[] {
  const byEx = new Map<
    string,
    { account_id: string; total_equity: number }[]
  >();
  for (const row of latest.values()) {
    const list = byEx.get(row.exchange) ?? [];
    list.push({
      account_id: row.account_id,
      total_equity: Number(row.total_equity),
    });
    byEx.set(row.exchange, list);
  }
  return Array.from(byEx.entries())
    .map(([exchange, accounts]) => {
      accounts.sort((a, b) => a.account_id.localeCompare(b.account_id));
      const total = accounts.reduce((s, a) => s + a.total_equity, 0);
      return { exchange, total, accounts };
    })
    .sort((a, b) => a.exchange.localeCompare(b.exchange));
}

/**
 * Forward-fill per account across the union of timestamps >= sinceMs,
 * then sum. Accounts with no row yet at a ts are skipped (not zero-filled).
 * Rows with ts < sinceMs are still used as seed for forward-fill.
 */
export function buildFundEquityCurve(
  rows: FundAccountEquity[],
  sinceMs: number
): ChartDataPoint[] {
  if (rows.length === 0) return [];

  const byAccount = new Map<string, { t: number; equity: number }[]>();
  for (const row of rows) {
    const t = new Date(row.ts).getTime();
    const list = byAccount.get(row.account_id) ?? [];
    list.push({ t, equity: Number(row.total_equity) });
    byAccount.set(row.account_id, list);
  }
  for (const list of byAccount.values()) {
    list.sort((a, b) => a.t - b.t);
  }

  const timestamps = new Set<number>();
  for (const list of byAccount.values()) {
    for (const p of list) {
      if (p.t >= sinceMs) timestamps.add(p.t);
    }
  }
  const sortedTs = Array.from(timestamps).sort((a, b) => a - b);
  if (sortedTs.length === 0) return [];

  const indices = new Map<string, number>();
  for (const id of byAccount.keys()) indices.set(id, -1);

  const curve: ChartDataPoint[] = [];
  for (const ts of sortedTs) {
    let sum = 0;
    let contributors = 0;
    for (const [accountId, list] of byAccount) {
      let idx = indices.get(accountId)!;
      while (idx + 1 < list.length && list[idx + 1].t <= ts) {
        idx += 1;
      }
      indices.set(accountId, idx);
      if (idx >= 0) {
        sum += list[idx].equity;
        contributors += 1;
      }
    }
    if (contributors > 0) {
      curve.push({ time: ts, equity: sum });
    }
  }
  return curve;
}

export function computeRangeDelta(
  curve: ChartDataPoint[],
  currentTotal: number
): { delta: number; deltaPct: number | null } {
  if (curve.length === 0) {
    return { delta: 0, deltaPct: null };
  }
  const start = curve[0].equity;
  const delta = currentTotal - start;
  const deltaPct = start !== 0 ? (delta / start) * 100 : null;
  return { delta, deltaPct };
}

/** Upsert a row into an array keyed by (account_id, ts). */
export function upsertFundEquityRow(
  rows: FundAccountEquity[],
  incoming: FundAccountEquity
): FundAccountEquity[] {
  const key = `${incoming.account_id}|${incoming.ts}`;
  let replaced = false;
  const next = rows.map((r) => {
    if (`${r.account_id}|${r.ts}` === key) {
      replaced = true;
      return incoming;
    }
    return r;
  });
  if (!replaced) next.push(incoming);
  return next.sort(
    (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime()
  );
}
