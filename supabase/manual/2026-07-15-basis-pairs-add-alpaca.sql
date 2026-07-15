-- basis_pairs 的 exchange check constraint 加入 'Alpaca'（美股實盤數據，僅 spot）
-- 對應功能：basis monitor 接 Alpaca 數據
alter table public.basis_pairs drop constraint if exists basis_pairs_leg1_exchange_check;
alter table public.basis_pairs drop constraint if exists basis_pairs_leg2_exchange_check;
alter table public.basis_pairs
  add constraint basis_pairs_leg1_exchange_check
  check (leg1_exchange in ('Binance', 'Bybit', 'Alpaca'));
alter table public.basis_pairs
  add constraint basis_pairs_leg2_exchange_check
  check (leg2_exchange in ('Binance', 'Bybit', 'Alpaca'));
