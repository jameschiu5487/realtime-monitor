-- 2026-10-06  Grant user_strategy_access for the two Kepler weekend books (user-approved: same two users as Kepler)
--
-- Kepler · Weekend FV   (multistrat book "wa", config/weekend_fv_live.toml, strategy weekend_fv)
--   strategies row 673475ff-fd4d-5b53-bf1a-1ba7230ee932
-- Kepler · Weekend Fade (multistrat book "wh", config/weekend_fade_live.toml, strategy weekend_fade)
--   strategies row 218aeb41-8cda-5cd4-8efa-cc67df380740
-- Both children of Kepler (c0b9c6bb-29e9-55cf-8d7f-1c337697d61c); rows upserted by multistrat
-- supabase-sync at the books' first start (paper smoke 2026-10-06 04:10 UTC, live 05:03 UTC).
-- share_ratio 1.0, as the users' existing grants. Executed via PostgREST
-- (on_conflict=user_id,strategy_id, ignore-duplicates; HTTP 201, all four rows verified); equivalent SQL:

insert into public.user_strategy_access (user_id, strategy_id, share_ratio)
values
  ('3da56e12-f045-4a06-bd8f-f835a87d8a15', '673475ff-fd4d-5b53-bf1a-1ba7230ee932', 1.0),
  ('ab796983-39b7-49de-a043-1eb222bec31c', '673475ff-fd4d-5b53-bf1a-1ba7230ee932', 1.0),
  ('3da56e12-f045-4a06-bd8f-f835a87d8a15', '218aeb41-8cda-5cd4-8efa-cc67df380740', 1.0),
  ('ab796983-39b7-49de-a043-1eb222bec31c', '218aeb41-8cda-5cd4-8efa-cc67df380740', 1.0)
on conflict do nothing;
