-- 2026-11-13  Close Jump Fade Maker's last run (user-requested)
--
-- The engine stopped without marking the run finished; it was the only
-- Lagrange run still 'running'. end_time = its last equity_curve row
-- (last trade 2026-11-12 09:03 UTC). Applied 2026-11-13 via execute_sql.

update strategy_runs set status = 'completed', end_time = '2026-11-12 11:21:00.373+00'
where run_id = '34bca74c-8fe0-49f3-8158-78581a778b1f' and status = 'running';
