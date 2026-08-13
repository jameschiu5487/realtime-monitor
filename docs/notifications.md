# Push Notification 系統架構

最後更新：2026-08-13。改動任何一段後請更新本檔（見底部「維護規則」）。

## 全貌

```
trades INSERT ──(pg_net trigger)──> POST /api/notifications/send        (type: trade_every)
combined_trades INSERT ─(trigger)─> POST /api/notifications/trade-delayed (等10秒配對hedge)
report 分享 ──(前端 fetch)────────> POST /api/notifications/report-shared
NAV 劇變 ──────────────────────────> 尚未接線（設定 UI 已存在）

各 API route 查 notification_preferences 篩選訂閱者
→ 依 user_strategy_access.share_ratio 縮放數字（每個用戶看到自己的份額）
→ web-push 發送到 push_subscriptions 內的裝置
→ Service Worker (public/sw.js) 顯示通知，點擊導向 payload.url
```

## 關鍵檔案

| 檔案 | 職責 |
|------|------|
| `lib/web-push.ts` | VAPID lazy init（不能在 module level init，會炸 Vercel build）|
| `hooks/use-push-notification.ts` | 前端訂閱/取消訂閱 |
| `components/settings/notification-settings.tsx` | 設定 UI |
| `app/api/notifications/send/route.ts` | 通用發送端點（trade_every / nav_change / report）|
| `app/api/notifications/trade-delayed/route.ts` | combined trade 的 hedge 配對邏輯 |
| `app/api/notifications/report-shared/route.ts` | report 分享通知 |
| `app/api/notifications/vapid-key/route.ts` | 把 VAPID 公鑰給 Service Worker（SW 讀不到 build-time env）|
| `public/sw.js` | Service Worker：push、notificationclick、pushsubscriptionchange |

## 業務規則（改 code 前必讀）

1. **Hedge 配對**：combined_trades insert 後等 10 秒，找同 run、同 symbol、
   不同 exchange、時間差 1 分鐘內的另一腿。找到 → 只有 `combined_trade_id`
   較大的那筆發「Hedge Closed」彙總通知（避免重複）；沒找到 → 發單腿「Position Closed」。
2. **share_ratio 縮放**：所有數字（quantity、PnL、Fee、Funding）乘上該用戶在
   `user_strategy_access` 的 `share_ratio` 才發送。查不到 access 記錄 → ratio = 1。
3. **策略篩選**：`notification_preferences.trade_strategy_ids` 為空陣列 = 訂閱全部策略；
   非空 = 只收清單內策略的通知。`nav_strategy_ids` 同理。
4. **點擊導向**：trade 與 combined trade 通知點擊後導向
   `/strategies/{strategyId}/runs/{runId}`。
5. **失效訂閱清理**：push 發送收到 404/410 → 從 push_subscriptions 刪除該筆。
   其他錯誤不刪，但會 `console.error`（以前是整個吞掉，導致「每次都發不出去的訂閱」
   跟「根本沒被嘗試的訂閱」在任何地方都看起來一樣）。
6. **訂閱自動復原**：瀏覽器會自己丟掉訂閱（金鑰輪換、iOS 回收久未開啟的 PWA 儲存）。
   兩道防線：`sw.js` 的 `pushsubscriptionchange` 重新訂閱並回報；
   `use-push-notification.ts` 在「permission 仍為 granted 但沒有訂閱」時靜默重訂。
   **靜默重訂必須檢查 localStorage 的 `push-opt-out` 旗標** —— 使用者手動關閉通知時
   permission 仍然是 granted，少了這個旗標會在下次開頁面把他剛關掉的通知又打開。

## 除錯陷阱（都真的白繞過，別再繞第二次）

1. **設定頁的推播開關讀的是瀏覽器本地 `pushManager.getSubscription()`，不是 DB。**
   開關自己變灰 ≠ `push_subscriptions` 被刪，也跟 `notification_preferences` 無關
   （那是另外三個開關）。查「開關變灰」要往瀏覽器端查，不是往 DB 查。
2. **`combined_trades` 的 webhook 在 `net._http_response` 裡必然顯示 5 秒逾時，這是設計如此。**
   `/api/notifications/trade-delayed` 要等 10 秒配對 hedge，而 pg_net 的逾時是 5 秒。
   pg_net 放棄等待不代表 Vercel 沒跑完，通知仍會送出。
   判準：逾時筆數 / 200 筆數的比例會貼近 combined_trades / trades 的比例
   （2026-08-13 實測 20:40 對 62:126）。**看到這批逾時不要當成故障去追。**
   代價是 trigger 分不出成功失敗，真的故障會被埋在這些雜訊裡。
3. **同一支裝置在 `push_subscriptions` 累積多筆是正常的。**
   upsert 的衝突鍵是 `(user_id, endpoint)`，而重新訂閱會拿到新的 endpoint，
   所以每次復原都是新增一筆。舊筆要等 Apple 回 410 才會被清掉。

## DB 端（Supabase project: kszydawqmcpsvozzjpyh）

### 相關表
- `push_subscriptions`：user_id, endpoint, p256dh, auth
- `notification_preferences`：trade_notifications, trade_every, trade_combined,
  trade_strategy_ids (jsonb), nav_change_notifications, nav_change_threshold,
  nav_strategy_ids (jsonb), report_notifications
- `user_strategy_access`：user_id, strategy_id, share_ratio

### Trigger functions（快照，2026-07-03 當時的 production 狀態）

⚠️ 這是快照不是 source of truth。要確認現況：
`SELECT prosrc FROM pg_proc WHERE proname = 'notify_trade_insert';`
⚠️ production 內嵌了明文 API key 與 Vercel URL，此處以佔位符表示。
改 NOTIFICATION_API_KEY 或換域名時，必須同步重建這兩個 function。

```sql
-- trigger: trades AFTER INSERT
CREATE OR REPLACE FUNCTION notify_trade_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  webhook_url text := '<VERCEL_URL>/api/notifications/send';
  api_key text := '<NOTIFICATION_API_KEY>';
  payload jsonb;
  strategy_name text;
  strategy_id_val text;
BEGIN
  SELECT s.name, s.strategy_id INTO strategy_name, strategy_id_val
  FROM strategy_runs sr JOIN strategies s ON s.strategy_id = sr.strategy_id
  WHERE sr.run_id = NEW.run_id;

  payload := jsonb_build_object(
    'type', 'trade_every',
    'strategy_id', COALESCE(strategy_id_val, ''),
    'trade_data', jsonb_build_object(
      'strategy_name', COALESCE(strategy_name, 'Unknown'),
      'action', NEW.action, 'side', NEW.side, 'symbol', NEW.symbol,
      'quantity_actual', NEW.quantity_actual, 'price', NEW.price,
      'exchange', NEW.exchange, 'trade_id', NEW.trade_id,
      'run_id', NEW.run_id, 'fee_amount_usdt', NEW.fee_amount_usdt
    ),
    'payload', jsonb_build_object(
      'title', 'Trade Executed',
      'tag', 'trade-' || NEW.trade_id,
      'url', '/strategies/' || COALESCE(strategy_id_val, '') || '/runs/' || NEW.run_id
    )
  );

  PERFORM net.http_post(
    url := webhook_url, body := payload,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || api_key));
  RETURN NEW;
END; $$;

-- trigger: combined_trades AFTER INSERT
CREATE OR REPLACE FUNCTION notify_combined_trade_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  webhook_url text := '<VERCEL_URL>/api/notifications/trade-delayed';
  api_key text := '<NOTIFICATION_API_KEY>';
  payload jsonb;
BEGIN
  payload := jsonb_build_object(
    'combined_trade_id', NEW.combined_trade_id,
    'run_id', NEW.run_id, 'symbol', NEW.symbol,
    'exchange', NEW.exchange, 'ts', NEW.ts);
  PERFORM net.http_post(
    url := webhook_url, body := payload,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || api_key));
  RETURN NEW;
END; $$;
```

其他 DB function：`get_user_push_info_by_email(target_email text)` — SECURITY DEFINER，
report-shared 用來找目標用戶的訂閱。

## 端到端驗證方法（改完必跑）

1. 用 `execute_sql` insert 一筆測試 trade（或 combined_trades 一對 hedge）到測試 run。
2. 問使用者手機有沒有收到通知，內容數字是否正確（記得 share_ratio 縮放）。
3. 刪掉測試資料。
4. 收不到時的排查順序：Vercel function logs → `net._http_response` 表
   （pg_net 的回應紀錄）→ push_subscriptions 是否有該用戶的訂閱。

## 環境變數（Vercel）

`NEXT_PUBLIC_VAPID_PUBLIC_KEY`、`VAPID_PRIVATE_KEY`、`NOTIFICATION_API_KEY`、
`SUPABASE_SERVICE_ROLE_KEY`、`NEXT_PUBLIC_SUPABASE_URL`

## 維護規則

改了 trigger → 更新上面的快照與日期。改了業務規則（配對窗口、縮放邏輯、篩選語意）
→ 更新「業務規則」段。新增通知類型 → 更新「全貌」圖。
