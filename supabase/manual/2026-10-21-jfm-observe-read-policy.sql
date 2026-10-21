-- Read access for the Paper tab (/paper).
-- jfm_observe had RLS enabled with no policies, so the app's authenticated
-- client read nothing. SELECT only: the jfm-checkpoint writer uses a role that
-- bypasses RLS.
-- Applied 2026-10-21 via apply_migration (jfm_observe_read_policy).

create policy "authenticated can read jfm_observe"
  on public.jfm_observe for select to authenticated using (true);
