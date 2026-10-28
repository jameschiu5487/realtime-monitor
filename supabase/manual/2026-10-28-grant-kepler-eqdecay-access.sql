-- 2026-10-28  Grant user_strategy_access for the two Kepler eq_decay books (user-approved: same two users as every Kepler book)
--
-- Kepler · EqDecay Nasdaq   (multistrat book "eqqz", config/eq_decay_qqq_live.toml, strategy eq_decay)
--   strategies row 219f3a77-7837-5192-81e0-c3c0291d95b3
-- Kepler · EqDecay SK hynix (multistrat book "eqkz", config/eq_decay_skhy_live.toml, strategy eq_decay)
--   strategies row 97833d47-3758-5dda-a853-f5828ebe81f5
-- Both children of Kepler (c0b9c6bb-29e9-55cf-8d7f-1c337697d61c); rows upserted by multistrat
-- supabase-sync at the books' first live start (2026-10-28 15:30 UTC).
-- share_ratio 1.0, as the users' grants on Kepler and on c1 / lr / pt / wa / wh. Executed via
-- PostgREST (on_conflict=user_id,strategy_id, ignore-duplicates; HTTP 201, all four rows verified);
-- equivalent SQL:

insert into public.user_strategy_access (user_id, strategy_id, share_ratio)
values
  ('3da56e12-f045-4a06-bd8f-f835a87d8a15', '219f3a77-7837-5192-81e0-c3c0291d95b3', 1.0),
  ('ab796983-39b7-49de-a043-1eb222bec31c', '219f3a77-7837-5192-81e0-c3c0291d95b3', 1.0),
  ('3da56e12-f045-4a06-bd8f-f835a87d8a15', '97833d47-3758-5dda-a853-f5828ebe81f5', 1.0),
  ('ab796983-39b7-49de-a043-1eb222bec31c', '97833d47-3758-5dda-a853-f5828ebe81f5', 1.0)
on conflict do nothing;
