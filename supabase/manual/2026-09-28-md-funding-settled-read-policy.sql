-- Read access for the Model tab's realised-funding net return.
-- shadow_event_net is security_invoker, so it reads md_funding_settled with the
-- caller's rights; with RLS on and no policy, every settled rate (and so
-- funding_bp) came back null for the app's authenticated client.
-- SELECT only; writes stay blocked.
-- Applied 2026-09-28 via apply_migration (md_funding_settled_read_policy).

create policy "authenticated can read md_funding_settled"
  on public.md_funding_settled for select to authenticated using (true);
