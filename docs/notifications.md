# Push Notification 系統架構

最後更新：2026-08-26。改動任何一段後請更新本檔（見底部「維護規則」）。

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
| `app/api/notifications/trade-delayed/route.ts` | combined trade 的 hedge 配對；先回 202，配對走 `after()` |
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
6. **訂閱自動復原**：瀏覽器會自己丟掉訂閱。iOS 實測每 **2.7～4 天**丟一次
   （8/16→8/20→8/23→8/26）。復原靠 `use-push-notification.ts` 的 `ensureSubscription()`，
   在「permission 仍為 granted 但沒有訂閱」時靜默重訂，觸發時機有兩個：
   掛載時、以及 **`visibilitychange` 回到前景時**。
   後者不可省：iOS PWA 從 App 切換器叫回前景不會讓 React 重新掛載，
   只在掛載時檢查等於要等冷啟動，中間發出的通知全部靜默遺失。
   `sw.js` 也有 `pushsubscriptionchange` handler，但**實測在 iOS 從未生效**（見除錯陷阱 4），
   別把它當成防線。
   **靜默重訂必須檢查 localStorage 的 `push-opt-out` 旗標** —— 使用者手動關閉通知時
   permission 仍然是 granted，少了這個旗標會在下次開頁面把他剛關掉的通知又打開。
7. **同裝置只留一筆訂閱**：`subscribe` route 在寫入新訂閱後，會刪掉同 `user_id`
   + 同 `device_name` 的其他列。因為重訂閱會拿到新 endpoint，而 upsert 的衝突鍵是
   `(user_id, endpoint)`，不修剪就會無限累積。

## 除錯陷阱（都真的白繞過，別再繞第二次）

1. **設定頁的推播開關讀的是瀏覽器本地 `pushManager.getSubscription()`，不是 DB。**
   開關自己變灰 ≠ `push_subscriptions` 被刪，也跟 `notification_preferences` 無關
   （那是另外三個開關）。查「開關變灰」要往瀏覽器端查，不是往 DB 查。
2. **`/api/notifications/trade-delayed` 回 202 是正常的，不是「還沒做完」。**
   它要等 10 秒讓對手腿進來，但 pg_net 的逾時是 5 秒。原本 inline 等待導致
   **每一筆** combined_trade 都在 `net._http_response` 留下逾時紀錄
   （2026-08-13 實測比例 20:40，對上 combined_trades:trades 的 62:126）。
   通知其實有送出，但 trigger 分不出成功失敗，真故障被埋在雜訊裡。
   現在改成先回 202、用 Next 的 `after()` 在回應之後做等待與配對。
   **所以現在 `net._http_response` 若再出現這支的逾時，那就是真的有問題，要追。**
   背景工作的結果只在 Vercel logs（`[notifications/trade-delayed] done/failed`），
   pg_net 只看得到那個 202。
3. **同一支裝置累積多筆訂閱不再正常** —— 2026-08-26 起 subscribe route 會自動修剪。
   若又看到某裝置有多筆，代表修剪失效，要查（route 內修剪失敗只記 log 不擋請求）。
4. **`Apple 回 201` 不代表使用者收到。** 死掉的 endpoint Apple 照樣回 201 而非 410，
   所以 `sent` 這個數字會把「送進黑洞」算成成功，`cleaned` 也一直是 0。
   **不要用 `sent` 判斷使用者是否真的收到通知。**
5. **iOS 收不到通知時，先確認訂閱新舊而不是查發送端。** 典型情境：iOS 丟掉訂閱後、
   使用者下次把 App 叫回前景之前，這段期間的通知全部遺失，而 DB、pg_net、
   Vercel logs **沒有任何一層會報錯**。判準：看 `push_subscriptions.created_at`
   是不是又冒出新的一列 —— 有，就代表期間發生過一次丟失。
6. **`pushsubscriptionchange` 在 iOS 上實測從未生效。**
   `sw.js` 的 handler 會把 `device_name` 寫成 `auto-renewed (pushsubscriptionchange)`，
   但 production 累積的訂閱列裡這個字串從未出現過，全部來自前景檢查。
   handler 留著（其他瀏覽器可能有用），但**不要把它當成 iOS 的防線**。

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
