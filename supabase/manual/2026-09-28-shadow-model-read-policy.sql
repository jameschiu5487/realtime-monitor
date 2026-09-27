-- Read access for the Model monitor tab (/model).
-- Both tables had RLS enabled with no policies, so the app's authenticated
-- client read nothing. SELECT only: writes stay blocked for anon/authenticated
-- (the shadow writer uses a role that bypasses RLS).
-- Applied 2026-09-28 via apply_migration (shadow_model_read_policy).

create policy "authenticated can read shadow_prediction"
  on public.shadow_prediction for select to authenticated using (true);

create policy "authenticated can read shadow_event_ledger"
  on public.shadow_event_ledger for select to authenticated using (true);
