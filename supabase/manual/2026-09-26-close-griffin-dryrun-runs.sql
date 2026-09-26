-- 2026-09-26  Close Griffin (kore/xaos smallcap16 dry-run fleet) runs on the realtime monitor
--
-- User asked to turn the Griffin realtime monitor off. The 15 xaos dry-run processes on the
-- fleet box (sig, ~/kore_fleet, running since 2026-09-17) were stopped with stop_dryrun.sh
-- (SIGINT); kore's shutdown_supabase() marked those 15 strategy_runs rows
-- status='completed' with end_time itself.
--
-- A further 104 Griffin rows (2026-05-13 .. 2026-09-17, notes kore-*-dryrun*) were orphans:
-- runs killed or crashed before shutdown, no live process, still status='running', so the
-- dashboard kept counting Griffin as running. They were set to status='stopped' via PostgREST
-- (one PATCH per run_id, guarded by status=eq.running); end_time = the run's last
-- equity_curve.ts when it had any data, otherwise its start_time. No rows deleted.
-- Pre-change copies of the 104 rows: sig:~/kore_fleet/griffin_stale_runs_backup_20260926.json
-- (and the per-run patch log griffin_stale_runs_patched_20260926.json next to it).
--
-- Equivalent SQL (as executed, after the 15 live runs had already completed):

update public.strategy_runs r
set status   = 'stopped',
    end_time = coalesce(
      (select max(e.ts) from public.equity_curve e where e.run_id = r.run_id),
      r.start_time)
where r.strategy_id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'  -- Griffin
  and r.status = 'running';

-- Result: Griffin strategy_runs = 118 completed, 104 stopped, 0 running.
