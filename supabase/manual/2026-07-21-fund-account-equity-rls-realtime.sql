-- fund_account_equity: authenticated SELECT + supabase_realtime publication（Fund Equity Dashboard）
-- Authenticated users can read all fund account equity rows (fund-level, no per-user column)
create policy "fund_account_equity_select_authenticated"
  on public.fund_account_equity
  for select
  to authenticated
  using (true);

-- Enable realtime INSERT notifications for the dashboard
alter publication supabase_realtime add table public.fund_account_equity;
