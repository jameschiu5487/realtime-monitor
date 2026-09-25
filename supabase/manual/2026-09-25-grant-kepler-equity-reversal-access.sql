-- 2026-09-25  Grant user_strategy_access for Kepler · Equity Reversal (user-approved: same two users as Kepler)
--
-- Kepler · Equity Reversal (multistrat book "eq", config/equity_rev_live.toml) is a sub-strategy of
-- Kepler (parent c0b9c6bb-29e9-55cf-8d7f-1c337697d61c); its strategies row is upserted by
-- multistrat supabase-sync (uuid5 id, strategy:equity_rev_eq:equity_rev_live). share_ratio 1.0,
-- as the users' existing grants. Executed via PostgREST (on_conflict=user_id,strategy_id,
-- ignore-duplicates); equivalent SQL:

insert into public.user_strategy_access (user_id, strategy_id, share_ratio)
values
  ('3da56e12-f045-4a06-bd8f-f835a87d8a15', 'cb05c891-ec92-5a0a-968e-899962b202cf', 1.0),
  ('ab796983-39b7-49de-a043-1eb222bec31c', 'cb05c891-ec92-5a0a-968e-899962b202cf', 1.0)
on conflict do nothing;
