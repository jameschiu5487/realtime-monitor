-- 2026-09-27  Grant user_strategy_access for Kepler · Crude Breakout (user-approved: same two users as Kepler)
--
-- Kepler · Crude Breakout (multistrat book "cb", config/crude_breakout_live.toml, strategy
-- channel_breakout on CLUSDT / BZUSDT) is a sub-strategy of Kepler (parent
-- c0b9c6bb-29e9-55cf-8d7f-1c337697d61c); its strategies row 38c7a25b-c589-5ca9-9437-296ec074e30e
-- was upserted by multistrat supabase-sync at its first live start (2026-09-27 10:59 UTC).
-- share_ratio 1.0, as the users' existing grants. Executed via PostgREST
-- (on_conflict=user_id,strategy_id, ignore-duplicates; HTTP 201, both rows verified); equivalent SQL:

insert into public.user_strategy_access (user_id, strategy_id, share_ratio)
values
  ('3da56e12-f045-4a06-bd8f-f835a87d8a15', '38c7a25b-c589-5ca9-9437-296ec074e30e', 1.0),
  ('ab796983-39b7-49de-a043-1eb222bec31c', '38c7a25b-c589-5ca9-9437-296ec074e30e', 1.0)
on conflict do nothing;
