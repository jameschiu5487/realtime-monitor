-- 2026-10-29  Grant user_strategy_access for the Kepler eq_decay semis book (user-approved: same two users as every Kepler book)
--
-- Kepler · EqDecay Semis (multistrat book "eqsz", config/eq_decay_soxx_live.toml, strategy eq_decay;
--   SOXL / SOXS against SOXX, SOXX bars from Zoomex)
--   strategies row 711f17b4-5f9b-500b-91c8-ff7394b6b530
-- Child of Kepler (c0b9c6bb-29e9-55cf-8d7f-1c337697d61c); row upserted by multistrat supabase-sync at
-- the book's first live start (2026-10-28 16:16 UTC). share_ratio 1.0, as the users' grants on
-- Kepler and its other books. Executed via PostgREST (on_conflict=user_id,strategy_id,
-- ignore-duplicates; HTTP 201, both rows verified); equivalent SQL:

insert into public.user_strategy_access (user_id, strategy_id, share_ratio)
values
  ('3da56e12-f045-4a06-bd8f-f835a87d8a15', '711f17b4-5f9b-500b-91c8-ff7394b6b530', 1.0),
  ('ab796983-39b7-49de-a043-1eb222bec31c', '711f17b4-5f9b-500b-91c8-ff7394b6b530', 1.0)
on conflict do nothing;
