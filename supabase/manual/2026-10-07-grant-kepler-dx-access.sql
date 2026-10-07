-- 2026-10-07  Grant user_strategy_access for Kepler DX (user-approved: ONLY the owner, 3da56e12)
--
-- Kepler DX = multistrat books on the DEXLESS (Orderly) account dexless_1, configs
-- config/dexless/*.toml. Rows upserted by multistrat supabase-sync at the books' first
-- live start (2026-10-07 09:51 UTC):
--   Kepler DX (parent)          e16a6353-2836-56b3-869f-7f912d0a2cf2
--   Kepler DX · XS Momentum     d641d74c-9d75-566e-91b7-a6bde103c90c  (book c1x)
--   Kepler DX · Liq Rebound     4dcad933-d380-5d08-affc-efcfeef6d0ba  (book lrx)
--   Kepler DX · Vol Trend       0ceffe0a-faef-5ff9-9f1c-2ff5472a736f  (book vtx)
-- ptx / wax / whx refused to start (rate limit) before their rows existed: granted later.
-- Deliberately NOT granted to ab796983 (the front end hides parent families without access).
-- share_ratio 1.0. Executed via PostgREST (on_conflict=user_id,strategy_id,
-- ignore-duplicates; HTTP 201, rows verified); equivalent SQL:

insert into public.user_strategy_access (user_id, strategy_id, share_ratio)
values
  ('3da56e12-f045-4a06-bd8f-f835a87d8a15', 'e16a6353-2836-56b3-869f-7f912d0a2cf2', 1.0),
  ('3da56e12-f045-4a06-bd8f-f835a87d8a15', 'd641d74c-9d75-566e-91b7-a6bde103c90c', 1.0),
  ('3da56e12-f045-4a06-bd8f-f835a87d8a15', '4dcad933-d380-5d08-affc-efcfeef6d0ba', 1.0),
  ('3da56e12-f045-4a06-bd8f-f835a87d8a15', '0ceffe0a-faef-5ff9-9f1c-2ff5472a736f', 1.0)
on conflict do nothing;
