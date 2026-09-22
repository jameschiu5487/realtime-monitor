-- 2026-09-22  新增 xs_momentum_c1 策略的 user_strategy_access（使用者明示同意）
--
-- xs_momentum_c1 由 multistrat（neokuo1216/multistrat）的 `multistrat supabase-sync`
-- 寫入，2026-09-21 建立，zoomex 實盤 1x（allocated 2000 USDT）。策略頁只列出
-- user_strategy_access 有該使用者的策略，所以需要授權才看得到。
--
-- 使用者指定只授權以下兩位；兩人現有的所有授權都是 share_ratio 1.0，這裡比照。
-- 實際透過 PostgREST 執行（on_conflict=user_id,strategy_id, ignore-duplicates），
-- 等價 SQL 如下。

insert into public.user_strategy_access (user_id, strategy_id, share_ratio)
values
  ('3da56e12-f045-4a06-bd8f-f835a87d8a15', 'e9cbe49f-3cd1-5eef-a646-bd24c8ed3575', 1.0),
  ('ab796983-39b7-49de-a043-1eb222bec31c', 'e9cbe49f-3cd1-5eef-a646-bd24c8ed3575', 1.0)
on conflict do nothing;
