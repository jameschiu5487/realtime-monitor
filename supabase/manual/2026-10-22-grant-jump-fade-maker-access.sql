-- 2026-10-22  Grant user_strategy_access for Jump Fade Maker (user-approved)
--
-- Jump Fade Maker  77c46d95-1fb0-438d-aa35-086dfa5704ae  had no access rows, so no one
-- saw it on /strategies. Same four users and share_ratio as Newtonz
-- (b2c3d4e5-f6a7-8901-bcde-f12345678901), as the user asked:
--   3da56e12 1.0 · ab796983 1.0 · da11819c 0.5 · 015490b0 0.5
-- Executed via execute_sql; 4 rows inserted.

insert into public.user_strategy_access (user_id, strategy_id, share_ratio)
select a.user_id, '77c46d95-1fb0-438d-aa35-086dfa5704ae', a.share_ratio
from public.user_strategy_access a
where a.strategy_id = 'b2c3d4e5-f6a7-8901-bcde-f12345678901'
on conflict do nothing;
