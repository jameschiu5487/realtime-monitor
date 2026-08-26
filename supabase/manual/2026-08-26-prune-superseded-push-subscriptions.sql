-- 2026-08-26  清除同一裝置被取代的推播訂閱（使用者明示同意）
--
-- 背景：iOS 每 2.7～4 天丟一次推播訂閱（實測 8/16→8/20→8/23→8/26）。
-- 重新訂閱會拿到新的 endpoint，而 upsert 的衝突鍵是 (user_id, endpoint)，
-- 所以每次復原都是新增一列而非取代 —— 同一支 iPhone 累積到 4 列。
-- Apple 對死掉的 endpoint 仍回 201 而不是能觸發清理的 410，因此舊列永不過期，
-- 導致 /api/notifications/send 回報的 sent 數字包含根本沒送達任何裝置的成功。
--
-- 每個 (user_id, device_name) 只保留 created_at 最新的一列。
-- 本次刪除 3 列：2026-08-16、2026-08-20、2026-08-23（皆為同一支 iPhone）。
-- 保留：該 iPhone 8/26 那列、同帳號的 Mac (FCM) 列、另一位使用者的 iPhone 列。
--
-- 往後由 app/api/notifications/subscribe/route.ts 在每次新訂閱時自動修剪，
-- 這支腳本只處理修剪上線前既有的堆積。

with ranked as (
  select id, row_number() over (partition by user_id, device_name
                                order by created_at desc) as rn
  from public.push_subscriptions
)
delete from public.push_subscriptions
where id in (select id from ranked where rn > 1)
returning created_at;
