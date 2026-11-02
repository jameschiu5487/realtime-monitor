-- 2026-11-03  Shareholder ratio change after a deposit (user-requested)
--
-- binance_spot_4 received +33,000 U at 2026-11-03 02:32 Taipei (fund_account_equity;
-- total fund equity ~16.5k -> ~49.4k). From that day the two shareholders hold
-- 0.5708 instead of 0.5. effective_from is a Taipei day, so the new ratio starts at
-- 2026-11-03 00:00 Taipei, 2.5 h before the deposit itself.
-- Admins (ab796983, 3da56e12) stay at 1.0.
-- Executed via execute_sql; 2 rows inserted. Earlier rows are kept as history.

insert into public.shareholder_shares (user_id, effective_from, share_ratio, note)
values
  ('da11819c-3bbf-44b2-ae12-a92f0e665b25', date '2026-11-03', 0.5708, 'binance_spot_4 +33,000 U deposit, 2026-11-03 02:32 Taipei'),
  ('015490b0-e8b1-466f-a5f4-a409bf126e8d', date '2026-11-03', 0.5708, 'binance_spot_4 +33,000 U deposit, 2026-11-03 02:32 Taipei');
