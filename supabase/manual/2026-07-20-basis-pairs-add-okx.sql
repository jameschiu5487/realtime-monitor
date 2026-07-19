-- basis_pairs 的 exchange check constraint 加入 'OKX'（公開 API，spot + perp/swap）
-- 對應功能：basis monitor 接 OKX 數據
alter table public.basis_pairs drop constraint if exists basis_pairs_leg1_exchange_check;
alter table public.basis_pairs drop constraint if exists basis_pairs_leg2_exchange_check;
alter table public.basis_pairs
  add constraint basis_pairs_leg1_exchange_check
  check (leg1_exchange in ('Binance', 'Bybit', 'Alpaca', 'OKX'));
alter table public.basis_pairs
  add constraint basis_pairs_leg2_exchange_check
  check (leg2_exchange in ('Binance', 'Bybit', 'Alpaca', 'OKX'));
