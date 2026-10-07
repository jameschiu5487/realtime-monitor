import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Children of a parent strategy (Kepler, Kepler DX, ...) are private to the users granted
 * them: a push for such a child goes only to users with a `user_strategy_access` row for
 * it, whatever their `trade_strategy_ids` say (an empty filter means "every strategy I can
 * see", not every strategy in the table). Strategies without a parent keep the old rule.
 * Returns `userIds` unchanged when the strategy is not a child or cannot be read.
 */
export async function restrictToChildAccess(
  supabase: SupabaseClient,
  strategyId: string | undefined,
  userIds: string[]
): Promise<string[]> {
  if (!strategyId || userIds.length === 0) return userIds;
  const { data: strat } = await supabase
    .from("strategies")
    .select("parent_strategy_id")
    .eq("strategy_id", strategyId)
    .maybeSingle();
  if (!strat?.parent_strategy_id) return userIds;
  const { data: access } = await supabase
    .from("user_strategy_access")
    .select("user_id")
    .eq("strategy_id", strategyId)
    .in("user_id", userIds);
  const allowed = new Set((access ?? []).map((r: { user_id: string }) => r.user_id));
  return userIds.filter((id) => allowed.has(id));
}
