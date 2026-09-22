-- 2026-09-22  strategies 加上 parent/child 階層（parent_strategy_id）
--
-- 目的：一個「母策略」底下掛多個「子策略」。第一個用例是 Kepler：
--   - 母策略「Kepler」(v1.0, market crypto-futures) 由交易系統 upsert，自己沒有 run。
--   - 子策略「Kepler · XS Momentum」(e9cbe49f-3cd1-5eef-a646-bd24c8ed3575) 與
--     「Kepler · Premium Thrust」（之後上線）。
--   子策略是同一個 Zoomex 帳戶上各自獨立的 book，各自寫自己的 strategy_runs /
--   equity_curve / pnl_series / positions / trades / combined_trades。
--   Dashboard 的母策略頁把子策略「目前運行中的 live run」加總顯示。
--
-- 設計：
--   - 自我參照 FK，nullable；null = 頂層策略（既有所有策略都是 null，行為不變）。
--   - on delete set null：刪母策略時子策略退回頂層，不連帶刪除子策略與其資料。
--   - 只做一層（母→子）；UI 不處理孫策略。
--   - index 給「列出某母策略的子策略」查詢用（/strategies/[parentId]）。
--
-- RLS / 權限：
--   新增欄位不需要新的 policy —— strategies 既有的 table-level RLS policy 與
--   authenticated/anon 的 table grant 自動涵蓋新欄位（Supabase 預設是整表 grant，
--   沒有 column-level grant）。可見性仍由 user_strategy_access 在前端篩選：
--   使用者對母策略或任一子策略有 access 就看得到母策略；子策略仍需要各自的 access。
--   本檔不改任何 policy / grant。
--
-- 部署順序：前端程式碼可以先於本 SQL 部署 —— 欄位不存在時，查詢子策略的
-- filter 會回 42703（column does not exist），前端視為「沒有子策略」，
-- 策略列表與策略頁維持原本的扁平顯示。
--
-- 執行後，由交易系統（或手動）設定子策略的 parent，例如：
--   update public.strategies
--      set parent_strategy_id = '<Kepler 的 strategy_id>'
--    where strategy_id = 'e9cbe49f-3cd1-5eef-a646-bd24c8ed3575';

alter table public.strategies
  add column if not exists parent_strategy_id uuid null
    references public.strategies(strategy_id) on delete set null;

create index if not exists strategies_parent_strategy_id_idx
  on public.strategies (parent_strategy_id)
  where parent_strategy_id is not null;

comment on column public.strategies.parent_strategy_id is
  'Parent strategy (one level). Children are independent books aggregated on the parent page; the parent has no runs of its own. NULL = top-level.';

-- 讓 PostgREST 立即認得新欄位（否則 schema cache 刷新前 filter 仍會報不存在）。
notify pgrst, 'reload schema';
