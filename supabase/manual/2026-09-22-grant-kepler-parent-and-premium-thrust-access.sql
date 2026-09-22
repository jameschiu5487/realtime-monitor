-- 2026-09-22  新增 Kepler 母策略與 Kepler · Premium Thrust 的 user_strategy_access（使用者明示同意）
--
-- Kepler 是 multistrat 在同一個 zoomex 帳戶上的多策略母策略（parent_strategy_id 見
-- 2026-09-22-strategy-parent.sql），底下的子策略各自是獨立帳本：
--   Kepler · XS Momentum     e9cbe49f-3cd1-5eef-a646-bd24c8ed3575（2026-09-22 已授權）
--   Kepler · Premium Thrust  66618f72-48e2-55a1-8f12-0de903b948aa
-- 兩者的 strategies 列由 multistrat 的 supabase-sync 以 uuid5 產生並 upsert。
--
-- 使用者指定只授權以下兩位，share_ratio 比照兩人既有授權的 1.0。
-- 實際透過 PostgREST 執行（on_conflict=user_id,strategy_id, ignore-duplicates），等價 SQL 如下。

insert into public.user_strategy_access (user_id, strategy_id, share_ratio)
values
  ('3da56e12-f045-4a06-bd8f-f835a87d8a15', 'c0b9c6bb-29e9-55cf-8d7f-1c337697d61c', 1.0),
  ('ab796983-39b7-49de-a043-1eb222bec31c', 'c0b9c6bb-29e9-55cf-8d7f-1c337697d61c', 1.0),
  ('3da56e12-f045-4a06-bd8f-f835a87d8a15', '66618f72-48e2-55a1-8f12-0de903b948aa', 1.0),
  ('ab796983-39b7-49de-a043-1eb222bec31c', '66618f72-48e2-55a1-8f12-0de903b948aa', 1.0)
on conflict do nothing;
