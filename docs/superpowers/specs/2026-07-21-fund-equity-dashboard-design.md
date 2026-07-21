# Fund Equity Balance Dashboard 設計文件

日期：2026-07-21
狀態：已與使用者確認（方案 3：SSR 預取 + Supabase Realtime）

## 目標

在 Overview 頁（`/`）最上方新增 **Fund Equity Balance** dashboard，資料來源為既有表 `fund_account_equity`：

- 摘要卡片：全帳戶總餘額 + 依交易所小卡（可展開看各帳戶）
- 時間序列圖：全帳戶 equity 加總成一條線
- 時間範圍可切換：24h / 7d / 30d
- 新列寫入時透過 Realtime 即時更新卡片與曲線

既有策略 metrics / performance chart 區塊維持不變，僅整體下移。

## 名詞定義

- **account**：`account_id`（如 `binance_1`、`bybit_2`、`zoomex_1`）
- **exchange 合計**：同一 `exchange` 下各帳戶最新 `total_equity` 加總
- **總餘額**：所有帳戶最新 `total_equity` 加總
- **加總曲線點**：某一時間戳上，所有帳戶 equity（缺值則 forward-fill）加總後的單一數值

## 架構決策

採**方案 3：SSR 預取 + Client Realtime 訂閱**。

- Server Component（`app/(dashboard)/page.tsx`）預取最近 30 天資料作為首屏
- Client 組件訂閱 `fund_account_equity` 的 `INSERT`（每分鐘新 snapshot 為新列；若日後改 upsert 再補 `UPDATE`），merge 進狀態
- 時間範圍切換在 client 過濾，不另開 API

已否決的替代方案：

- 方案 1（僅 SSR + 60s revalidate）：無即時感；使用者明確要求 Realtime
- 方案 2（專用 API route）：多一層 round-trip，對目前資料量無必要

## 資料表：`fund_account_equity`（已存在）

```
account_id   text        -- PK 組成
exchange     text        -- binance | bybit | zoomex
ts           timestamptz -- PK 組成
total_equity numeric
PK (account_id, ts)
```

現況（2026-07-21）：約 9 帳戶（Binance×5、Bybit×2、Zoomex×2），約每分鐘一筆。

### 實作前必補的 DB 事項（需使用者確認後再套用）

1. **RLS policy**：表已 `ENABLE ROW LEVEL SECURITY`，但目前**無任何 policy**（等同 authenticated client 讀不到）。需新增 authenticated `SELECT` policy。寫入仍由既有 backend/service role 負責，本功能不新增寫入路徑。
2. **Realtime publication**：目前**未**加入 `supabase_realtime`。需 `ALTER PUBLICATION supabase_realtime ADD TABLE fund_account_equity;`（或等效 migration）。
3. DDL 依專案硬規則走 `apply_migration`，並視需要落檔 `supabase/manual/`。

本功能**不**套用 `user_strategy_access.share_ratio`（帳戶權益是 fund 層級，非策略份額）。

## 資料流

### SSR 預取

在 `DashboardPage` 新增對 `fund_account_equity` 的分頁拉取（沿用現有 1000/page pattern），條件：

- `ts >= now() - 30 days`
- `order by ts ascending`

傳入 Overview 頂部新組件作為 `initialData`。

### Client 狀態

- `rows: FundAccountEquity[]`：以 SSR 資料初始化
- Realtime 收到新列：依 `(account_id, ts)` upsert，再重算摘要與曲線
- `range: '24h' | '7d' | '30d'`：僅影響曲線與「相對起點 Δ」計算，不影響「最新餘額」卡片

### 加總規則（曲線）

1. 收集選定範圍內所有出現過的 `ts`（可對各帳戶取樣時間取聯集，或依實際寫入節奏對齊）
2. 對每個 `ts`，每個帳戶取「該帳戶最近一筆 `ts' <= ts`」的 `total_equity`（forward-fill）
3. 加總得到該點的 total equity
4. 若某帳戶在範圍開始前完全無資料，該帳戶在出現第一筆之前不參與加總（不補 0）

### 摘要 Δ 計算

相對選取範圍起點：

- 起點總額 = 範圍內第一個可加總點（或各帳戶在範圍起點的 forward-fill 加總）
- 終點總額 = 當下最新總餘額
- 顯示 Δ$ 與 Δ%

## UI 與元件

頁面由上到下：

1. **Fund Equity Balance**（新）
2. 既有策略 overview（metrics、策略勾選、performance chart）

| 元件 | 職責 |
|------|------|
| `components/overview/fund-equity-dashboard.tsx` | 容器：初始資料、Realtime、range state |
| `FundEquitySummary`（同檔或子元件） | 總餘額 + Δ$ / Δ% |
| `FundEquityExchangeCards` | 交易所小卡；展開顯示帳戶明細 |
| `FundEquityChart` | 加總曲線 + 24h/7d/30d 切換 |

視覺沿用現有 Card / 數字格式 / chart 風格，不另開設計系統。區塊標題：「Fund Equity」。

### 卡片行為

- 預設收合：交易所合計 + 帳戶數
- 展開：該交易所下各 `account_id` 最新餘額
- 總餘額永遠 = 所有帳戶最新值加總

## Realtime

- 比照 `overview-performance-chart` / `use-realtime-data`：`postgres_changes` on `public.fund_account_equity`
- 訂閱失敗或斷線：保留最後資料，可選顯示「即時更新暫停」
- 重複鍵：以最新值覆寫，避免雙計

可抽 `lib/hooks/use-realtime-fund-equity.ts`，或直接寫在 dashboard 組件內；若邏輯簡短優先同檔，避免過度抽象。

## 型別

在 `lib/types/database.ts`（或 regenerate）補上：

```ts
export type FundAccountEquity = {
  account_id: string;
  exchange: string;
  ts: string;
  total_equity: number;
};
```

## 錯誤處理

| 情況 | 行為 |
|------|------|
| 無資料 | 空狀態文案，不顯示假數字 |
| SSR 查詢失敗 | 僅此區塊錯誤提示，不拖垮下方策略 overview |
| Realtime 斷線 | 保留最後資料 + 可選暫停提示 |
| 選 30d 但實際資料更短 | 只畫有資料區間，不補零 |
| 帳戶取樣時間不齊 | forward-fill |

## 效能

- 30d × ~1min × 9 accounts ≈ 四萬列量級；SSR 分頁拉取可接受
- Client 切 range 只過濾 / 重算，不重打 API
- 曲線點若過密，可沿用 overview chart 既有 downsample 策略（實作時對齊現有 helper）

## 測試計畫

- [ ] 有資料時：總餘額 = 各帳戶最新加總；交易所小卡加總正確
- [ ] 展開/收合交易所卡可看到正確帳戶明細
- [ ] 切換 24h / 7d / 30d，曲線區間與 Δ 正確
- [ ] 新列寫入 DB 後，無需整頁重整即可看到餘額與曲線更新
- [ ] 無資料 / SSR 失敗時不影響下方策略區塊
- [ ] RLS + Realtime migration 套用後，authenticated 使用者可讀可訂閱

## 明確不在本次範圍

- 寫入 / 同步帳戶權益的爬蟲或 cron（假設外部已寫入）
- 依使用者過濾可見帳戶
- share_ratio 縮放
- 多幣種 / 非 USDT 換算
- 獨立路由頁（僅 Overview 頂部區塊）
