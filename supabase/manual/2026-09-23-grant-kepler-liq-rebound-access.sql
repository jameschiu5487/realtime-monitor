-- 2026-09-23  Grant user_strategy_access for Kepler · Liq Rebound (user-approved: same two users as Kepler)
--
-- Kepler · Liq Rebound (multistrat book "lr", config/liq_rebound_live.toml) is a sub-strategy of
-- Kepler (parent c0b9c6bb-29e9-55cf-8d7f-1c337697d61c); its strategies row is upserted by
-- multistrat supabase-sync (uuid5 id). share_ratio 1.0, as the users' existing grants.
-- Executed via PostgREST (on_conflict=user_id,strategy_id, ignore-duplicates); equivalent SQL:

insert into public.user_strategy_access (user_id, strategy_id, share_ratio)
values
  ('3da56e12-f045-4a06-bd8f-f835a87d8a15', 'eadee599-9178-5cc0-8505-083079d01689', 1.0),
  ('ab796983-39b7-49de-a043-1eb222bec31c', 'eadee599-9178-5cc0-8505-083079d01689', 1.0)
on conflict do nothing;
