import type { SupabaseClient } from "@supabase/supabase-js";
import type { Json } from "@/lib/types/database";
import { isMissingColumnError } from "@/lib/strategy-hierarchy";
import { accountIdsFromRunParams } from "@/lib/utils/fund-account-strategy";

/**
 * Who may see a parent strategy family (e.g. Kepler, Kepler DX).
 *
 * RLS lets every authenticated user SELECT strategies / strategy_runs /
 * fund_account_equity, so visibility is enforced here, from the viewer's
 * user_strategy_access rows:
 *   - a parent is visible with access to the parent itself or to any child;
 *   - a child page needs access to that child itself;
 *   - everything else (ordinary strategies, accounts not tied to a hidden
 *     family) is left exactly as it was — this only ever removes things that
 *     belong to a parent the viewer cannot see.
 *
 * The pure helpers below take plain rows so the Overview can run them on the
 * shared (user-independent) cached data per request, outside the cache.
 */

type StrategyRef = { strategy_id: string; parent_strategy_id?: string | null };
type RunRef = { strategy_id: string; params: Json | null };

/** Same reading as lib/strategy-hierarchy parentIdOf, for rows where the column may be absent. */
function parentIdOf(strategy: StrategyRef): string | null {
  return strategy.parent_strategy_id ?? null;
}

/** Parents the viewer can see neither directly nor through any child. */
export function hiddenParentIds(
  strategies: readonly StrategyRef[],
  accessibleIds: ReadonlySet<string>
): Set<string> {
  const visible = new Set<string>();
  const parents = new Set<string>();
  for (const s of strategies) {
    const parentId = parentIdOf(s);
    if (!parentId || parentId === s.strategy_id) continue;
    parents.add(parentId);
    if (accessibleIds.has(parentId) || accessibleIds.has(s.strategy_id)) {
      visible.add(parentId);
    }
  }
  return new Set([...parents].filter((id) => !visible.has(id)));
}

/** Hidden parents plus every child of them: the strategies to drop entirely. */
export function hiddenFamilyIds(
  strategies: readonly StrategyRef[],
  accessibleIds: ReadonlySet<string>
): Set<string> {
  const hiddenParents = hiddenParentIds(strategies, accessibleIds);
  const hidden = new Set(hiddenParents);
  for (const s of strategies) {
    const parentId = parentIdOf(s);
    if (parentId && hiddenParents.has(parentId)) hidden.add(s.strategy_id);
  }
  return hidden;
}

/**
 * Fund accounts linked ONLY to hidden strategies.
 *
 * A run links its strategy to the accounts in its params.api
 * (accountIdsFromRunParams) — any run, any status or mode. An account is hidden
 * when it has at least one linked run and every linked run belongs to a hidden
 * strategy. Accounts with no linked run, or with any link to a strategy outside
 * `hiddenStrategyIds`, stay visible.
 */
export function hiddenAccountIds(
  runs: readonly RunRef[],
  hiddenStrategyIds: ReadonlySet<string>
): Set<string> {
  if (hiddenStrategyIds.size === 0) return new Set();
  const linkedToHidden = new Set<string>();
  const linkedToVisible = new Set<string>();
  for (const run of runs) {
    const target = hiddenStrategyIds.has(run.strategy_id) ? linkedToHidden : linkedToVisible;
    for (const accountId of accountIdsFromRunParams(run.params)) target.add(accountId);
  }
  return new Set([...linkedToHidden].filter((id) => !linkedToVisible.has(id)));
}

/**
 * The signed-in user's own user_strategy_access strategy_ids (request-scoped,
 * never cache this). Empty when signed out or on error.
 */
export async function fetchAccessibleStrategyIds(
  supabase: SupabaseClient
): Promise<Set<string>> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Set();
  const { data, error } = (await supabase
    .from("user_strategy_access")
    .select("strategy_id")
    .eq("user_id", user.id)) as {
    data: { strategy_id: string }[] | null;
    error: { message: string } | null;
  };
  if (error) console.error("Error fetching user_strategy_access:", error);
  return new Set((data ?? []).map((r) => r.strategy_id));
}

/**
 * Whether the viewer may open a strategy's own page (detail, combined, run).
 * A child of a parent needs its own access; any other strategy is unchanged
 * (no check), as before.
 */
export async function canViewStrategyPage(
  supabase: SupabaseClient,
  strategy: StrategyRef
): Promise<boolean> {
  if (!parentIdOf(strategy)) return true;
  const accessible = await fetchAccessibleStrategyIds(supabase);
  return accessible.has(strategy.strategy_id);
}

/**
 * hiddenFamilyIds for the signed-in user, read fresh (request-scoped). Before
 * strategies.parent_strategy_id exists there is no hierarchy and nothing is
 * hidden; on any other read error it fails open the same way (pre-existing
 * behaviour: these pages showed everything).
 */
export async function fetchHiddenFamilyIds(
  supabase: SupabaseClient
): Promise<Set<string>> {
  const [accessible, { data, error }] = await Promise.all([
    fetchAccessibleStrategyIds(supabase),
    supabase
      .from("strategies")
      .select("strategy_id, parent_strategy_id")
      .not("parent_strategy_id", "is", null) as unknown as Promise<{
      data: StrategyRef[] | null;
      error: { code?: string; message?: string } | null;
    }>,
  ]);
  if (error) {
    if (!isMissingColumnError(error)) {
      console.error("Error fetching strategy hierarchy:", error);
    }
    return new Set();
  }
  return hiddenFamilyIds(data ?? [], accessible);
}
