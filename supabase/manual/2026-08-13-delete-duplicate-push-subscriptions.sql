-- 2026-08-13  清除單一 iPhone 累積的重複推播訂閱（使用者明示同意）
--
-- 背景：設定頁的推播開關讀瀏覽器本地的 pushManager.getSubscription()，
-- iOS 丟掉訂閱後開關就顯示未啟用，使用者手動重開 → 因為 upsert 的衝突鍵是
-- (user_id, endpoint) 而重訂閱會拿到新 endpoint，每次都新增一筆而非更新。
-- 同一支 iPhone 因此累積四筆，同一則通知可能重複收到。
-- 復原機制已於 commit 1bbf59a 補上（sw.js pushsubscriptionchange + hook 靜默重訂）。
--
-- 保留：該裝置最新的一筆 Apple 訂閱，以及 Mac 的 FCM 訂閱（不同裝置，非重複）。
-- 實際刪除 3 筆：2026-06-24、2026-08-09、2026-08-12。

with target as (
  select ps.id
  from public.push_subscriptions ps
  join auth.users u on u.id = ps.user_id
  where u.email = '<USER_EMAIL>'
    and ps.endpoint like '%apple.com%'
    and ps.created_at < (
      select max(ps2.created_at)
      from public.push_subscriptions ps2
      where ps2.user_id = ps.user_id and ps2.endpoint like '%apple.com%'
    )
)
delete from public.push_subscriptions
where id in (select id from target)
returning created_at;
