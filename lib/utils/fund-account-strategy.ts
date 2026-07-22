import type { Json } from "@/lib/types/database";

/** Extract exchange prefix from account_id (binance_4 → binance). */
export function exchangeFromAccountId(accountId: string): string {
  return accountId.split("_")[0]?.toLowerCase() ?? "";
}

function normalizeExchange(exchangeOrAccountId: string): string {
  return exchangeOrAccountId.includes("_")
    ? exchangeFromAccountId(exchangeOrAccountId)
    : exchangeOrAccountId.toLowerCase();
}

/** Tailwind classes for account chips (Active Strategies). */
export function exchangeBadgeClass(exchangeOrAccountId: string): string {
  switch (normalizeExchange(exchangeOrAccountId)) {
    case "binance":
      return "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400";
    case "bybit":
      return "bg-orange-500/15 text-orange-700 dark:text-orange-400";
    case "zoomex":
      return "bg-sky-500/15 text-sky-700 dark:text-sky-400";
    default:
      return "bg-muted text-muted-foreground";
  }
}

/** Tailwind classes for Fund Equity exchange cards. */
export function exchangeCardClass(exchangeOrAccountId: string): string {
  switch (normalizeExchange(exchangeOrAccountId)) {
    case "binance":
      return "border-yellow-500/40 bg-yellow-500/5";
    case "bybit":
      return "border-orange-500/40 bg-orange-500/5";
    case "zoomex":
      return "border-sky-500/40 bg-sky-500/5";
    default:
      return "";
  }
}

/**
 * Map API key env names to fund_account_equity.account_id.
 * BINANCE_API_KEY_4 → binance_4; ZOOMEX_API_KEY → zoomex_1.
 */
export function envNameToAccountId(envName: string): string | null {
  const match = envName.match(/^([A-Z]+)_API_KEY(?:_(\d+))?$/);
  if (!match) return null;
  const exchange = match[1].toLowerCase();
  const index = match[2] ?? "1";
  return `${exchange}_${index}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Resolve fund account_ids used by a run from params.api.
 * Prefers execution_mapping target exchanges; falls back to non-spot *_api_key_env.
 */
export function accountIdsFromRunParams(params: Json | null | undefined): string[] {
  if (!isRecord(params)) return [];
  const api = params.api;
  if (!isRecord(api)) return [];

  const exchanges = new Set<string>();
  const mapping = api.execution_mapping;
  if (isRecord(mapping)) {
    for (const target of Object.values(mapping)) {
      if (typeof target === "string" && target.length > 0) {
        exchanges.add(target.toLowerCase());
      }
    }
  }

  if (exchanges.size === 0) {
    for (const key of Object.keys(api)) {
      const match = key.match(/^([a-z0-9]+)_api_key_env$/);
      if (match && !match[1].includes("spot")) {
        exchanges.add(match[1]);
      }
    }
  }

  const accountIds: string[] = [];
  for (const exchange of exchanges) {
    const envName = api[`${exchange}_api_key_env`];
    if (typeof envName !== "string") continue;
    const accountId = envNameToAccountId(envName);
    if (accountId) accountIds.push(accountId);
  }
  return accountIds;
}

type LiveRun = {
  status: string;
  mode: string;
  strategy_id: string;
  params: Json | null;
};

/** account_id → unique strategy names (running realtime / test-realtime). */
export function buildAccountStrategyMap(
  runs: LiveRun[],
  strategyNameMap: Record<string, string>,
  isLiveMode: (mode: string) => boolean
): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const run of runs) {
    if (run.status !== "running" || !isLiveMode(run.mode)) continue;
    const name = strategyNameMap[run.strategy_id] ?? "Unknown";
    for (const accountId of accountIdsFromRunParams(run.params)) {
      const list = map[accountId] ?? [];
      if (!list.includes(name)) list.push(name);
      map[accountId] = list;
    }
  }
  return map;
}

/** strategy_id → unique account_ids used by running realtime / test-realtime runs. */
export function buildStrategyAccountMap(
  runs: LiveRun[],
  isLiveMode: (mode: string) => boolean
): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const run of runs) {
    if (run.status !== "running" || !isLiveMode(run.mode)) continue;
    const list = map[run.strategy_id] ?? [];
    for (const accountId of accountIdsFromRunParams(run.params)) {
      if (!list.includes(accountId)) list.push(accountId);
    }
    map[run.strategy_id] = list;
  }
  for (const strategyId of Object.keys(map)) {
    map[strategyId].sort((a, b) => a.localeCompare(b));
  }
  return map;
}
