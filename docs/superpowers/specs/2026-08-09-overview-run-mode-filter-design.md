# Overview: Active Equity Curve 的 run 模式篩選

日期：2026-08-09

## 目的

Overview 的 "Active Equity Curve" 目前把一個策略底下**所有** live 模式的 run
（`realtime` 與 `test-realtime`）混在一起畫。realtime 是真錢、test-realtime 是測試，
混在同一條曲線上讓人無法單看真實績效。

讓使用者選擇曲線要採用哪些 run：`All` / `Realtime` / `Test`。

## 範圍

**只影響 Active Equity Curve 圖表**（含圖表內部的統計面板）。

上方的指標列（Total Balance、Total P&L、Active Strategies、Today's Trades）
與左側策略勾選清單**維持現狀，不受此篩選影響**——這是使用者明確的選擇。
代價是圖表與指標列在非 `All` 模式下數字會不一致，屬已知且接受的取捨。

**不需要**改 DB、改 server、或重新查詢：模式資訊已存在於前端的 `allRuns` prop，
equity 與 trades 資料也早已全部下載到前端。

## 現況

`components/overview/overview-content.tsx` 有一個 `filtered` memo（約 L193-249），
依使用者勾選的策略推導出圖表與指標列共用的所有資料。圖表以 props 取得全部輸入，
並帶有 `key={selectionKey}`，在選擇改變時重新掛載。

`OverviewPerformanceChart` 的 props（`overview-performance-chart.tsx` L31-41）：
`initialEquityData`、`initialCombinedTrades`、`runningRunIds`、`strategyRunIds`、
`runToStrategyMap`、`shareRatioMap`、`strategyNameMap`。

## 設計

### 狀態

```ts
type RunModeFilter = "all" | "realtime" | "test-realtime";
```

存在 `OverviewContent`，以 localStorage key `overview-run-mode` 記住
（比照既有的 `overview-selected-strategies`）。預設 `"all"`，即維持現行行為。

讀取時驗證存入值屬於三個合法選項之一，否則退回 `"all"`。

### 資料流

1. 由既有的 `allRuns` prop 建 `run_id -> mode` 對照表。
2. 新增 `chartFiltered` memo，從既有的 `filtered` 再篩一層：
   剔除 mode 不符的 run，產出圖表專用的
   `equityData` / `combinedTradesData` / `runningRunIds` / `strategyRunIds`。
3. 圖表改吃 `chartFiltered.*`；指標列繼續吃 `filtered.*`。

`strategyNameMap` 沿用 `filtered` 的版本——圖表用它顯示各策略名稱，
即使該策略在此模式下無資料，保留名稱不會造成問題。

### 為什麼不用改圖表元件

圖表內部的即時訂閱與「載入全部歷史」都是依它收到的 run id props 運作。
傳入篩選後的清單，這兩條路徑自動繼承篩選，不會有被排除的 run 之後才把資料塞進來。
因此 `overview-performance-chart.tsx` **完全不需要修改**。

### 重新掛載

把模式併入 `selectionKey`，切換模式時圖表重新掛載，
乾淨重置其內部時間範圍與已載入的歷史資料。

### UI

三段式切換，置於圖表卡片標題列 `Active Equity Curve` 的右側：

```
Active Equity Curve            [ All | Realtime | Test ]
```

沿用專案既有的樣式慣例（Tailwind + 現有 badge/button 風格），不引入新元件庫。

### 空狀態

若所選模式下沒有任何符合的 run，圖表收到空陣列，顯示其既有的空狀態。
例如：只有 test-realtime run 的策略，在 `Realtime` 模式下線會消失——這是預期行為。

## 測試 / 驗證

1. `pnpm build`、`tsc --noEmit`、eslint 通過。
2. 手動驗證（需登入）：
   - 預設為 `All`，曲線與改動前一致。
   - 切到 `Realtime`：只剩 realtime run 的資料；切到 `Test` 同理。
   - 重新整理後，選擇被記住。
   - 指標列在三種模式下數字不變（確認篩選未外溢）。
   - 切換模式時圖表時間範圍正常重置、不殘留前一模式的資料。

## 明確排除

- 不改指標列、不改策略勾選清單的篩選行為。
- 不新增 server 端查詢或 DB 變更。
- 不處理 `backtest` / `paper` 等非 live 模式——Overview 本來就只納入
  `realtime` 與 `test-realtime`（`isOverviewLiveMode`）。
