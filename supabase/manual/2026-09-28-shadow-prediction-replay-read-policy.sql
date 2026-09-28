-- Read access for the Model tab's model comparison.
-- shadow_prediction_all (security_invoker) unions live predictions with
-- reproduced replay rows; with RLS on and no policy on the replay table, the
-- app's authenticated client saw only the live half (0 replay rows).
-- SELECT only; writes stay blocked.
-- Applied 2026-09-28 via apply_migration (shadow_prediction_replay_read_policy).

create policy "authenticated can read shadow_prediction_replay"
  on public.shadow_prediction_replay for select to authenticated using (true);
