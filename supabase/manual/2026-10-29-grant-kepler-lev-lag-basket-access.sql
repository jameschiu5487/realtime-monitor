-- 2026-10-29  Grant user_strategy_access for the Kepler leveraged-ETF lag basket (user-approved: same two users as every Kepler book)
--
-- Kepler · Lev Lag Basket (multistrat book "lvbz", config/lvb_zoomex_live.toml, strategy eq_decay;
--   short MVLL / MUU / SKUU against MRVL / MU / SKHY, 1000 per pair)
--   strategies row c1de6e5d-ff1a-594c-9337-d5c515ed4061
-- Child of Kepler (c0b9c6bb-29e9-55cf-8d7f-1c337697d61c); row upserted by multistrat supabase-sync at
-- the book's first live start (2026-10-29 03:43 UTC). share_ratio 1.0, as the users' grants on
-- Kepler and its other books. Kepler · Premium Thrust was retired the same day; its grants are kept
-- (operator). Executed via PostgREST (on_conflict=user_id,strategy_id, ignore-duplicates; HTTP 201,
-- both rows verified); equivalent SQL:

insert into public.user_strategy_access (user_id, strategy_id, share_ratio)
values
  ('3da56e12-f045-4a06-bd8f-f835a87d8a15', 'c1de6e5d-ff1a-594c-9337-d5c515ed4061', 1.0),
  ('ab796983-39b7-49de-a043-1eb222bec31c', 'c1de6e5d-ff1a-594c-9337-d5c515ed4061', 1.0)
on conflict do nothing;
