# Basis Monitor 設計文件

日期：2026-07-11
狀態：已與使用者確認（方案 A：全部 on-demand 計算，不儲存價格資料）

## 目標

新增 `/basis-monitor` 頁面：使用者任選兩個標的（Binance/Bybit × perp/spot × symbol），
畫出歷史 basis 走勢圖，並可儲存 pair 成清單持續追蹤。

**Phase 1（本次範圍）**：選 pair、看圖、儲存清單、清單即時 basis 快照。
**Phase 2（不在本次範圍）**：basis 超過閾值時推播告警；schema 已預留欄位。

## 名詞定義

- **leg1 / leg2**：pair 的兩隻腳。leg1 是分子、leg2 是分母。
- **basis%** = (leg1_price − leg2_price) / leg2_price，圖表預設顯示。
- **basis 絕對值** = leg1_price − leg2_price（USDT）。
- 兩種顯示可在圖表上切換。

## 架構決策

採**方案 A：on-demand 計算**。交易所 K 線 API 即是歷史資料來源，
前端拉兩腳 K 線後在 client 對齊計算 basis。Supabase 只存 pair 定義。
不做 cron、不存價格歷史（Phase 2 告警只需抓最新價比對，屆時再加 cron）。

已否決的替代方案：
- 方案 B（cron 抓價存 `basis_history` 表）：新 pair 無歷史、工程量大，違反 YAGNI。
- 方案 C（沿用 opportunity 頁 SSE）：SSE 是即時報價，不解決歷史走勢需求。

## 資料表：`basis_pairs`（Supabase, project kszydawqmcpsvozzjpyh）

```sql
create table basis_pairs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  leg1_exchange text not null,   -- 'binance' | 'bybit'
  leg1_market   text not null,   -- 'perp' | 'spot'
  leg1_symbol   text not null,   -- 例 'BTCUSDT'
  leg2_exchange text not null,
  leg2_market   text not null,
  leg2_symbol   text not null,
  alert_enabled boolean not null default false,  -- Phase 2 預留
  alert_threshold_pct numeric,                   -- Phase 2 預留
  created_at timestamptz not null default now(),
  unique (user_id, leg1_exchange, leg1_market, leg1_symbol,
          leg2_exchange, leg2_market, leg2_symbol)
);
```

- RLS：啟用；使用者僅能 select/insert/delete 自己的 rows（Phase 1 無 update 需求）。
- DDL 依專案硬規則走 `apply_migration` 留紀錄。

## API 層

### 擴充 `app/api/klines/route.ts`

- 新增 query 參數 `market=perp|spot`，**預設 `perp`**，既有呼叫方行為不變。
- 新增/沿用 `interval` 與 `days` 參數（以實際現有簽名為準，實作時先讀該檔）。
- 端點對照：
  - Binance perp：`fapi.binance.com/fapi/v1/klines`（現有）
  - Binance spot：`api.binance.com/api/v3/klines`（新增）
  - Bybit perp：`api.bybit.com/v5/market/kline?category=linear`（現有）
  - Bybit spot：同端點 `category=spot`（新增）
- 回傳格式維持現狀（`[timestamp, close][]`）。

### 新增 `app/api/symbols/route.ts`

- `GET /api/symbols?exchange=binance|bybit&market=perp|spot`
- 回傳該市場全部可交易 symbol 字串陣列（僅 TRADING 狀態）。
- 來源：Binance exchangeInfo（fapi / api v3）、Bybit instruments-info（linear / spot）。
- Server 端 cache 1 小時（Next.js fetch revalidate）。

### 新增 `app/api/tickers/route.ts`

- `GET /api/tickers?exchange=binance|bybit&market=perp|spot`
- 回傳該市場全部 symbol 的最新價 map：`{ [symbol]: price }`。
- 來源：交易所全量 ticker 端點，一次拉完。
- 用途：清單頁快照。最多 4 次請求（2 交易所 × 2 市場，僅拉清單中用到的組合）
  即可算出所有已存 pair 的即時 basis。

## 頁面與元件

- `app/(dashboard)/basis-monitor/page.tsx`：server component 殼，沿用 dashboard layout。
- `components/basis-monitor/basis-monitor-content.tsx`：client 主元件。
- `components/layout/sidebar.tsx`：navItems 新增 Basis Monitor 項目。

### 上半部：Pair Builder + 走勢圖

- 兩組 leg 選擇器，各含：交易所 Select、perp/spot Select、symbol 可搜尋 Combobox
  （選項來自 `/api/symbols`，換交易所或市場時重新載入）。
- 兩腳都選齊後自動拉 K 線畫圖。
- 圖表：Recharts LineChart，沿用 `components/charts/` 既有樣式慣例。
- Toggle 1：時間範圍 **1D / 7D / 30D**（預設 7D），對應 K 線 interval：
  - 1D → 5m（約 288 點）
  - 7D → 1h（168 點）
  - 30D → 4h（180 點）
- Toggle 2：Y 軸 **basis% / 絕對價差**（預設 %）。
- 「加入 Monitor」按鈕：client 直接 insert Supabase（沿用 report-content 的
  `@/lib/supabase/client` 模式）；重複 pair 由 unique constraint 擋下，前端顯示已存在。

### 下半部：已存清單

- 進頁時查 `basis_pairs`（RLS 自動過濾本人），並依清單涉及的市場組合拉 tickers 快照。
- 每列顯示：pair 名稱（`BTCUSDT binance-perp / BTCUSDT bybit-spot`）、
  即時 basis%（含正負色）、絕對價差、刪除鈕。
- 點列 → 把該 pair 載入上方選擇器並畫圖。
- 快照拉不到該市場 ticker 或 symbol 不在 map 中 → 該列顯示 `—`。

## basis 計算與邊界處理

- 兩腳 K 線以 open time 時間戳 join；任一腳缺的蠟燭直接丟棄（跨交易所偶有缺 K）。
- 交易所 API 失敗、symbol 下架、回傳空陣列：圖表區顯示錯誤訊息，不擋整頁其他功能。
- 兩腳選成完全相同的標的：照常畫（basis 恆為 0），不特別擋。

## 實作修訂（plan 撰寫時依現有程式碼調整，2026-07-11）

1. **時間粒度沿用現有 `lib/kline-config.ts`**：1D→1m、7D→15m、30D→1h（非原訂
   5m/1h/4h）。`/api/klines` 以 `days` 查 `KLINE_CONFIGS` 是既有機制，沿用即可，
   零新增參數；前端以 `displayKlines` 截尾控制點數。
2. **exchange 值存大寫 `'Binance' | 'Bybit'`**（非小寫），與全 app 的
   `Exchange` 型別（`lib/types/opportunity.ts`）一致，DB 加 check constraint。
3. **`user_id` 設 `default auth.uid()`**，client insert 不必手動帶。
4. **symbol 清單只列 USDT 報價對**（basis 絕對值以 USDT 計，非 USDT 報價無法比較）。

## 驗證（完成定義）

1. `pnpm build` 通過。
2. dev server 端到端手動驗證：
   - 選 Binance perp BTCUSDT / Bybit spot BTCUSDT → 圖表出現，切 1D/7D/30D 與 %/絕對皆正常。
   - 儲存 pair → 清單出現且有即時快照；重新整理後仍在。
   - 刪除 pair → 清單移除；重新整理後確實消失。
   - 跨交易所、同交易所 perp-spot 各測一組。
3. 未經上述端到端驗證前不得宣稱完成。
