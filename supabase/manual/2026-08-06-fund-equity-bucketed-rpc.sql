-- 2026-08-06  Overview 效能：fund_account_equity 分桶聚合 RPC
--
-- 問題：overview 頁面每次載入都讀 30 天、每帳號每分鐘一列的原始資料
--       （實測 18.93 MB / 約 18 萬列 / 15 個帳號），既超過 Next Data Cache
--       2MB 上限（會直接拋錯弄壞頁面），也整包序列化送到瀏覽器，
--       而圖表寬度只有幾百像素。
--
-- 解法：在 DB 端就分桶取樣，採分層解析度——近期細、遠期粗。
--       每桶取「最後一筆」（equity 是存量不是流量，不能用 avg）。
--
-- ⚠️ 為什麼回傳 jsonb 而不是 setof record：
--    PostgREST 對「多列」回應有 1000 筆上限（本專案實測確認為 1000）。
--    第一版寫成 returns table(...) 回傳 6,799 列，被靜默截斷成 1,000 列，
--    而結果是依 account_id 排序的 —— 於是前端只拿到最前面兩三個帳號，
--    畫出來的淨值曲線只加總了部分錢包，數字整條偏低。
--    改回傳「單一個 JSON 值」即不受列數上限限制，也不必分頁
--    （分頁要重跑 function 7 次，每次約 711ms，會逼近 authenticated 角色
--     的 8 秒 statement_timeout）。
--
-- 桶大小是實測選出來的，不是估的。2026-08-06 當時 production 狀況：
--   30 天內約 18.3 萬列 / 15 個帳號（注意：表內當時只有約 15 天資料，
--   長滿 30 天後粗粒度那段會再翻倍，選參數時已預留）。
--
--   參數               列數      JSON 體積
--   24h@1分 + 30分     25,636    2.74 MB   ← 超過 2MB，不可用
--   24h@2分 + 30分     15,571    1.66 MB
--   24h@5分 + 30分      9,523    1.02 MB
--   24h@5分 + 60分      6,799    0.76 MB   ← 採用（長滿約 1.0 MB）
--
-- 應用層（lib/overview-queries.ts）明確傳入 p_fine_minutes=5、
-- p_coarse_minutes=60。18.93 MB → 0.76 MB，約縮小 25 倍。
--
-- 驗證：抽樣比對 37 個桶，與手算的「桶內最後一筆」完全一致（0 筆不符），
--       桶邊界全部對齊；回傳帳號數 15 = 原始資料帳號數 15。
--
-- security invoker：沿用既有 RLS
--   （fund_account_equity_select_authenticated，見 2026-07-21 的 migration），
--   不繞過權限檢查。

drop function if exists public.get_fund_account_equity_bucketed(
  timestamptz, timestamptz, integer, integer);

create or replace function public.get_fund_account_equity_bucketed(
  p_since           timestamptz,
  p_fine_since      timestamptz,
  p_fine_minutes    integer default 5,
  p_coarse_minutes  integer default 60
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with bucketed as (
    select distinct on (f.account_id, f.bucket)
      f.account_id,
      f.exchange,
      f.bucket,
      f.total_equity
    from (
      select
        e.account_id::text      as account_id,
        e.exchange::text        as exchange,
        e.total_equity::numeric as total_equity,
        e.ts,
        to_timestamp(
          floor(extract(epoch from e.ts) / s.secs) * s.secs
        ) as bucket
      from public.fund_account_equity e
      cross join lateral (
        select (
          (case
             when e.ts >= p_fine_since then greatest(p_fine_minutes, 1)
             else greatest(p_coarse_minutes, 1)
           end)::double precision * 60
        ) as secs
      ) s
      where e.ts >= p_since
    ) f
    -- 每個 (帳號, 時間桶) 取桶內最後一筆
    order by f.account_id, f.bucket, f.ts desc
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'account_id',   b.account_id,
        'exchange',     b.exchange,
        'ts',           b.bucket,
        'total_equity', b.total_equity
      )
      order by b.account_id, b.bucket
    ),
    '[]'::jsonb
  )
  from bucketed b;
$$;

comment on function public.get_fund_account_equity_bucketed is
  'Overview: bucketed fund_account_equity as a single JSON array (fine buckets for the recent window, coarse before). Returns JSON rather than a row set because PostgREST caps row responses at 1000.';

grant execute on function public.get_fund_account_equity_bucketed(
  timestamptz, timestamptz, integer, integer
) to authenticated;
