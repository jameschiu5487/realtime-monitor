-- 2026-08-06  Overview 效能：equity_curve 分桶聚合 RPC
--
-- 問題：overview 主要績效圖表每次載入都讀 7 天、每分鐘一筆的原始資料
--       （實測 10,145 列 / 3.20 MB / 3 個 run）。每列約 330 bytes——
--       11 個數值欄位都是完整浮點精度（如 253.36422269）。
--       超過 Next Data Cache 2MB 上限 → 無法快取。
--
-- 解法：與 fund_account_equity 同一套做法（見 2026-08-06-fund-equity-bucketed-rpc.sql）。
--       分層解析度：近 24 小時 2 分鐘一桶，更早 15 分鐘一桶。
--       每桶取「最後一筆」（equity 是存量不是流量，不能用 avg）。
--
-- ⚠️ 為什麼回傳 jsonb 而不是 setof record：
--    PostgREST 對「多列」回應有 1000 筆上限（本專案實測確認為 1000）。
--    fund equity 那支第一版寫成 returns table(...) 就是因此被靜默截斷，
--    只回傳排序最前面的少數 run/帳號，導致圖表加總不完整。
--    回傳單一個 JSON 值即不受此限制。
--
-- 不含 drawdown_pct：前端 buildCombinedEquityCurve 會自行由合併後的序列重算，
-- 不讀取資料庫存的值。
--
-- 實測結果（2026-08-06）：
--   原始         10,145 列   3.20 MB
--   24h@2分+15分  1,331 列   0.44 MB   ← 採用（約縮小 7 倍）
--
-- 驗證：抽樣比對 181 個桶，與手算的「桶內最後一筆」完全一致（0 筆不符），
--       桶邊界全部對齊；回傳 run 數 3 = 原始資料 run 數 3（未被截斷）。
--
-- security invoker：沿用 equity_curve 既有 RLS，不繞過權限檢查。

create or replace function public.get_equity_curve_bucketed(
  p_run_ids         uuid[],
  p_since           timestamptz,
  p_fine_since      timestamptz,
  p_fine_minutes    integer default 2,
  p_coarse_minutes  integer default 15
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with bucketed as (
    select distinct on (f.run_id, f.bucket)
      f.run_id,
      f.bucket,
      f.total_equity,
      f.total_pnl,
      f.total_position_value,
      f.binance_equity,
      f.binance_pnl,
      f.binance_position_value,
      f.bybit_equity,
      f.bybit_pnl,
      f.bybit_position_value
    from (
      select
        e.run_id,
        e.ts,
        e.total_equity,
        e.total_pnl,
        e.total_position_value,
        e.binance_equity,
        e.binance_pnl,
        e.binance_position_value,
        e.bybit_equity,
        e.bybit_pnl,
        e.bybit_position_value,
        to_timestamp(
          floor(extract(epoch from e.ts) / s.secs) * s.secs
        ) as bucket
      from public.equity_curve e
      cross join lateral (
        select (
          (case
             when e.ts >= p_fine_since then greatest(p_fine_minutes, 1)
             else greatest(p_coarse_minutes, 1)
           end)::double precision * 60
        ) as secs
      ) s
      where e.run_id = any(p_run_ids)
        and e.ts >= p_since
    ) f
    -- 每個 (run, 時間桶) 取桶內最後一筆
    order by f.run_id, f.bucket, f.ts desc
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'run_id',                 b.run_id,
        'ts',                     b.bucket,
        'total_equity',           b.total_equity,
        'total_pnl',              b.total_pnl,
        'total_position_value',   b.total_position_value,
        'binance_equity',         b.binance_equity,
        'binance_pnl',            b.binance_pnl,
        'binance_position_value', b.binance_position_value,
        'bybit_equity',           b.bybit_equity,
        'bybit_pnl',              b.bybit_pnl,
        'bybit_position_value',   b.bybit_position_value
      )
      order by b.bucket, b.run_id
    ),
    '[]'::jsonb
  )
  from bucketed b;
$$;

comment on function public.get_equity_curve_bucketed is
  'Overview: bucketed equity_curve as a single JSON array (fine buckets for the recent window, coarse before), last reading per bucket.';

grant execute on function public.get_equity_curve_bucketed(
  uuid[], timestamptz, timestamptz, integer, integer
) to authenticated;
