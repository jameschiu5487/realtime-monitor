-- 2026-10-05  Revoke user_strategy_access for Kepler · Equity Reversal (user request: remove it from the monitor)
--
-- Kepler · Equity Reversal (multistrat book "eq", strategy cb05c891-ec92-5a0a-968e-899962b202cf, child of
-- Kepler c0b9c6bb-29e9-55cf-8d7f-1c337697d61c) was retired on 2026-10-05: book stopped flat (no fill ever),
-- registry entry released, all four runs 'completed', no producer process left. Visibility on the
-- dashboard (strategy list, Kepler parent / combined views, overview) is driven by user_strategy_access,
-- so removing the two grants of 2026-09-25-grant-kepler-equity-reversal-access.sql hides it everywhere.
-- The strategies / strategy_runs rows are kept (history). Executed via PostgREST DELETE (HTTP 200,
-- both rows returned, none left); equivalent SQL:

delete from public.user_strategy_access
where strategy_id = 'cb05c891-ec92-5a0a-968e-899962b202cf'
  and user_id in ('3da56e12-f045-4a06-bd8f-f835a87d8a15', 'ab796983-39b7-49de-a043-1eb222bec31c');

-- To restore: re-run 2026-09-25-grant-kepler-equity-reversal-access.sql.
