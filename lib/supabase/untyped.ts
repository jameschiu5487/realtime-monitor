import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Returns an untyped view of a Supabase client, for writes only.
 *
 * Why this exists: `lib/types/database.ts` is hand-maintained and omits the
 * `Relationships` field that postgrest-js requires on every table. Without it
 * the schema fails postgrest's `GenericSchema` constraint and `.insert()` /
 * `.update()` argument types collapse to `never`, so any write against the
 * typed client is a compile error.
 *
 * Adding `Relationships` to every table does fix the writes, but it also flips
 * the whole client into strict mode: `.from()` then demands a literal table
 * name, which breaks the dynamic `.from(table: string)` call sites in
 * combined-strategy-content, run-details-content, report-content and
 * use-realtime-data. That is a real cleanup, but a much larger one.
 *
 * Until the schema type is regenerated properly, writes go through here.
 * Reads are unaffected and stay fully typed — do not route them through this.
 */
export function untypedWrites(client: unknown): SupabaseClient {
  return client as SupabaseClient;
}
