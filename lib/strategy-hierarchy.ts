import type { SupabaseClient } from "@supabase/supabase-js";
import type { Strategy } from "@/lib/types/database";

/**
 * Parent/child strategies (one level).
 *
 * `strategies.parent_strategy_id` is added by
 * supabase/manual/2026-09-22-strategy-parent.sql, and this code may deploy
 * before that SQL runs. Everything here therefore tolerates the column being
 * absent:
 *   - `select("*")` never names the column, so it simply comes back without
 *     the key — `parentIdOf` reads that as "top-level".
 *   - Filtering on the column does fail (PostgREST 42703 "column ... does not
 *     exist"); `fetchChildStrategies` treats that as "no children".
 * Before the column exists every strategy is therefore top-level and the UI is
 * exactly the old flat one.
 */

/** A strategy's parent id, or null — also null when the column doesn't exist yet. */
export function parentIdOf(strategy: Pick<Strategy, "parent_strategy_id">): string | null {
  return strategy.parent_strategy_id ?? null;
}

/** PostgREST error for a column that isn't in the schema (yet). */
export function isMissingColumnError(
  error: { code?: string; message?: string } | null | undefined
): boolean {
  if (!error) return false;
  return (
    error.code === "42703" ||
    error.code === "PGRST204" ||
    /column .* does not exist|could not find the .* column/i.test(error.message ?? "")
  );
}

/**
 * Children of a strategy, oldest first. Empty when there are none or when the
 * parent_strategy_id column doesn't exist yet.
 */
export async function fetchChildStrategies(
  supabase: SupabaseClient,
  parentId: string
): Promise<Strategy[]> {
  const { data, error } = await supabase
    .from("strategies")
    .select("*")
    .eq("parent_strategy_id", parentId)
    .order("created_at", { ascending: true });

  if (error) {
    if (!isMissingColumnError(error)) {
      console.error("Error fetching child strategies:", error);
    }
    return [];
  }
  return (data ?? []) as Strategy[];
}

export interface StrategyGroup {
  strategy: Strategy;
  /** Children the user can access. Empty for an ordinary strategy. */
  children: Strategy[];
}

/**
 * Nest children under their parents for the strategies list.
 *
 * `strategies` must already be limited to what the user may see: the
 * strategies they have access to, plus the parents of those (a parent is shown
 * when the user can see it or any of its children). A child whose parent isn't
 * in the list stays top-level. Groups are ordered newest first by the most
 * recent created_at among the parent and its children.
 */
export function groupStrategies(strategies: Strategy[]): StrategyGroup[] {
  const byId = new Map(strategies.map((s) => [s.strategy_id, s]));
  const childrenOf = new Map<string, Strategy[]>();
  const topLevel: Strategy[] = [];

  for (const s of strategies) {
    const parentId = parentIdOf(s);
    if (parentId && parentId !== s.strategy_id && byId.has(parentId)) {
      const list = childrenOf.get(parentId) ?? [];
      list.push(s);
      childrenOf.set(parentId, list);
    } else {
      topLevel.push(s);
    }
  }

  const created = (s: Strategy) => new Date(s.created_at).getTime() || 0;
  const groups = topLevel.map((strategy) => {
    const children = (childrenOf.get(strategy.strategy_id) ?? []).sort(
      (a, b) => created(a) - created(b)
    );
    return { strategy, children };
  });

  const newest = (g: StrategyGroup) =>
    Math.max(created(g.strategy), ...g.children.map(created));
  return groups.sort((a, b) => newest(b) - newest(a));
}

export interface ParentRef {
  strategy_id: string;
  name: string;
}

/**
 * The parent of a strategy (id + name), or null for a top-level strategy.
 * Child pages use it for the breadcrumb and to label their equity as a
 * simulation of the child's own virtual book (the real account money is on
 * the parent page).
 */
export async function fetchParentRef(
  supabase: SupabaseClient,
  strategy: Pick<Strategy, "parent_strategy_id">
): Promise<ParentRef | null> {
  const parentId = parentIdOf(strategy);
  if (!parentId) return null;
  const { data, error } = await supabase
    .from("strategies")
    .select("strategy_id, name")
    .eq("strategy_id", parentId)
    .maybeSingle();
  if (error) console.error("Error fetching parent strategy:", error);
  return (data as ParentRef | null) ?? null;
}
