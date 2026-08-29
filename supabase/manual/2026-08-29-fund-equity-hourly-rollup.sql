-- 2026-08-29  Overview 資金淨值查詢：改用小時級彙總表
--
-- 已由 apply_migration 套用（fund_account_equity_hourly_rollup、
-- fund_equity_bucketed_use_hourly_rollup、fund_equity_bucketed_rollup_fix_union_scope），
-- 此檔為 repo 端快照。
--
-- 問題：get_fund_account_equity_bucketed 每次請求都要讀 30 天約 641k 列才能產出
-- 14.7k 個桶。快取全命中仍需 2.2~2.9 秒，冷快取或有負載時會撞破 authenticated
-- 角色的 8 秒 statement_timeout（2026-08-29 11:11:23 UTC 實際發生，sqlstate 57014，
-- 由 postgres_logs 的 context 欄位確認）。
--
-- 六種查詢改寫都無效（GROUP BY+array_agg、CTE MATERIALIZED、關索引掃描、
-- 把 ORDER BY 移出 jsonb_agg、涵蓋索引、loose index scan），因為外層
-- jsonb_agg(... ORDER BY ...) 無法平行化，planner 只能走逐列回 heap 的索引掃描。
-- 結論：不要在請求時重算。
--
-- 結果：2830ms -> 163ms（17x），shared buffers 315666 -> 14705，temp 溢寫消失，
-- 輸出與原版逐位元組相同（14822 列 / 1739138 bytes）。

create table if not exists public.fund_account_equity_hourly (
  account_id   text        not null,
  bucket_ts    timestamptz not null,
  exchange     text        not null,
  total_equity numeric     not null,
  -- 這一列取自原始表的哪個時間點；後到但較舊的資料不得覆蓋。
  src_ts       timestamptz not null,
  primary key (account_id, bucket_ts)
);

create index if not exists fund_account_equity_hourly_bucket_ts_idx
  on public.fund_account_equity_hourly (bucket_ts);

-- 回填（已驗證與原始資料零不符）
insert into public.fund_account_equity_hourly (account_id, bucket_ts, exchange, total_equity, src_ts)
select distinct on (e.account_id, date_trunc('hour', e.ts))
       e.account_id, date_trunc('hour', e.ts), e.exchange, e.total_equity, e.ts
from public.fund_account_equity e
order by e.account_id, date_trunc('hour', e.ts), e.ts desc
on conflict (account_id, bucket_ts) do nothing;

create or replace function public.fund_account_equity_hourly_sync()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  insert into public.fund_account_equity_hourly
    (account_id, bucket_ts, exchange, total_equity, src_ts)
  values
    (new.account_id, date_trunc('hour', new.ts), new.exchange, new.total_equity, new.ts)
  on conflict (account_id, bucket_ts) do update
    set exchange     = excluded.exchange,
        total_equity = excluded.total_equity,
        src_ts       = excluded.src_ts
    where excluded.src_ts >= public.fund_account_equity_hourly.src_ts;
  return new;
end;
$$;

drop trigger if exists fund_account_equity_hourly_sync_trg on public.fund_account_equity;
create trigger fund_account_equity_hourly_sync_trg
  after insert or update on public.fund_account_equity
  for each row execute function public.fund_account_equity_hourly_sync();

alter table public.fund_account_equity_hourly enable row level security;
create policy "Authenticated can read hourly fund equity"
  on public.fund_account_equity_hourly for select to authenticated using (true);

-- RPC 改寫（coarse 讀彙總表、fine 讀原始表）的完整定義見 Supabase migration
-- fund_equity_bucketed_rollup_fix_union_scope，或用
--   select pg_get_functiondef(oid) from pg_proc
--    where proname = 'get_fund_account_equity_bucketed';
-- 只有 p_coarse_minutes = 60 且兩個邊界都對齊整點時才走彙總表，否則退回原路徑。
