-- 2026-10-05  Grant user_strategy_access for Kepler · Vol Trend (user-approved: same two users as Kepler)
--
-- Kepler · Vol Trend (multistrat book "vt", config/vol_trend_paper.toml, strategy vol_trend on the
-- weekly volume ranks 3-20; PAPER) is a sub-strategy of Kepler (parent
-- c0b9c6bb-29e9-55cf-8d7f-1c337697d61c); its strategies row 95623a28-556f-5f16-89f7-f044c2433dc9 was
-- upserted by multistrat supabase-sync at its first paper start (2026-10-05 05:05 UTC).
-- share_ratio 1.0, as the users' existing grants. Executed via PostgREST
-- (on_conflict=user_id,strategy_id, ignore-duplicates; HTTP 201, both rows verified); equivalent SQL:

insert into public.user_strategy_access (user_id, strategy_id, share_ratio)
values
  ('3da56e12-f045-4a06-bd8f-f835a87d8a15', '95623a28-556f-5f16-89f7-f044c2433dc9', 1.0),
  ('ab796983-39b7-49de-a043-1eb222bec31c', '95623a28-556f-5f16-89f7-f044c2433dc9', 1.0)
on conflict do nothing;
