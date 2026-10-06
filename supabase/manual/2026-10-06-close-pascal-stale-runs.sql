-- 2026-10-06  Close Pascal (Polymarket Trader - Time Weighted) stale runs on the realtime monitor
--
-- User asked to mark Pascal's leftover runs as ended. 10 rows (5 live 2026-03-21 .. 03-22,
-- 5 paper 2026-03-24) were still status='running' with no data for 196-199 days: processes
-- killed before they could close their runs. They were set to status='stopped' via PostgREST
-- (one PATCH per run_id, guarded by status=eq.running; a run with data in the last 24 h would
-- have been skipped — none was); end_time = the run's last equity_curve.ts when it had any data,
-- otherwise its start_time. No rows deleted. Pre-change copies of the 10 rows:
-- sig:~/pascal_stale_runs_backup_20261006.json (patch log pascal_stale_runs_patched_20261006.json).
--
-- Equivalent SQL (as executed):

update public.strategy_runs r
set status   = 'stopped',
    end_time = coalesce(
      (select max(e.ts) from public.equity_curve e where e.run_id = r.run_id),
      r.start_time)
where r.strategy_id = 'ec82f9eb-6b84-419f-b51c-f800c1e6ad85'  -- Pascal
  and r.status = 'running';

-- Result: Pascal strategy_runs running = 0.
