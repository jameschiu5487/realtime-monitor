-- 2026-11-09  Grant user_strategy_access for RWA Maker (operator only, like Kepler DX)
--
-- RWA Maker (parent, c6be05ee-3227-5a62-a661-715a47282478) and its child
-- RWA Maker · Zoomex (ab037d3c-97f4-5dbb-b8b4-08e543c5bd45): multistrat branch rwa-maker, crates/rwa,
-- far post-only quotes on Zoomex leveraged-ETF perps hedged on the underlying, on the Zoomex account of
-- keyset 4 (ZOOMEX_API_KEY_4 -> fund account zoomex_4). Rows are upserted by
-- tools/rwa_supabase_sync.py on sig (deploy/rwa_live.sh sync-start). share_ratio 1.0. Executed via
-- PostgREST (on_conflict=user_id,strategy_id, ignore-duplicates; HTTP 201, both rows verified);
-- equivalent SQL:

insert into public.user_strategy_access (user_id, strategy_id, share_ratio)
values
  ('3da56e12-f045-4a06-bd8f-f835a87d8a15', 'c6be05ee-3227-5a62-a661-715a47282478', 1.0),
  ('3da56e12-f045-4a06-bd8f-f835a87d8a15', 'ab037d3c-97f4-5dbb-b8b4-08e543c5bd45', 1.0)
on conflict do nothing;
