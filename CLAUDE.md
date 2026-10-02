# CLAUDE.md

Guidance for Claude Code in this repository.

## 全域守則路由（先看這裡）

跨專案的工作方法放在 `~/.claude/playbooks/`，遇到對應情境時**先讀對應檔案再動工**：

| 情境 | 讀這個 |
|------|--------|
| 要派 subagent、選 model、大量讀檔或掃 repo | `~/.claude/playbooks/10-dispatch.md` |
| 不確定該不該升級模型 / 算不算完成 / 該不該問使用者 | `~/.claude/playbooks/20-judgment.md` |
| 要寫派工 prompt | `~/.claude/playbooks/30-delegation-templates.md` |
| 要修改 playbooks 或本檔 | `~/.claude/playbooks/40-maintenance.md` |
| Session 剛開始、想了解這個環境的坑 | `~/.claude/playbooks/00-diagnosis.md` 與 `90-letter.md` |

## 本專案硬規則（違反過、所以寫下來）

1. **Supabase DDL 必留紀錄**：CREATE/ALTER/DROP（含 trigger function 重建）優先用
   `apply_migration`；若用 `execute_sql`，同回合把 SQL 落檔到
   `supabase/manual/<日期>-<描述>.sql` 並 commit（密鑰換成佔位符）。
2. **通知鏈路改動必須端到端驗證**：build 通過 ≠ 完成。依
   `docs/notifications.md` 的「端到端驗證方法」執行；做不到就明說「未經端到端驗證」。
3. **通知系統動工前先讀 `docs/notifications.md`**：hedge 配對、share_ratio 縮放、
   策略篩選的語意都在裡面，別憑印象改。
4. **多步任務先寫 `.claude/WIP.md` checklist**，每步完成就打勾，全部做完刪檔。
   Session 開始時若此檔存在，先接續它。
5. 使用者偏好：以繁體中文溝通；改完 code 經確認 build 通過後 commit 並 push
   （歷次明示授權）；但 DB schema 變更、刪資料、對外發送類操作先確認。

## 開發流程鐵律

1. **改完 code 一律跑 `pnpm verify`**（= `lint` → `typecheck` → `build`，任一關失敗
   就中止）。三關全綠才算「build 通過」，才能 commit。只跑 `pnpm build` 不算 ——
   `next build` 不會擋 type error 以外的 lint 問題。
2. **lint warning 是棘輪**：`pnpm lint` 帶 `--max-warnings 18`（2026-08-13 的 baseline）。
   這個數字只能往下調。新程式碼不該產生新 warning；真的要放寬必須先問使用者。
3. **每次 commit 後審查 CLAUDE.md**：`.claude/hooks/post-commit-claude-md-review.sh`
   是 PostToolUse hook，偵測到 HEAD 真的前進才觸發，會要求依
   `.claude/rules/claude-md-review.md` 判斷 CLAUDE.md 要不要更新。
   **預設答案是「不用改」** —— 只有「踩過且會再踩的坑 / 新硬規則 / 新子系統 /
   schema 結構變動 / 技術棧與指令變更」值得寫進去。git history 查得到的不要寫。
4. **型別逃生口要具名**：需要繞過 Supabase 產生型別時走 `lib/supabase/untyped.ts`
   的 `untypedWrites()`，不要就地寫 `as any`。那支檔案裡記了為什麼不能直接補
   `Relationships`（補了會把全 repo 的動態 `.from(table: string)` 全部弄壞）。

## Stack

Next.js 16 (App Router, Turbopack；middleware 已改名為根目錄的 `proxy.ts`) /
React 19 / TypeScript strict / Tailwind v4 (CSS-based config, no tailwind.config.js) /
shadcn/ui (new-york, lucide-react) / pnpm / Supabase (auth + DB + storage) /
Vercel 部署 / PWA + Web Push。**沒有測試框架**，驗證靠 `pnpm verify` + 手動實測。

```bash
pnpm dev
pnpm verify                         # lint + typecheck + build，commit 前跑這個
pnpm lint / pnpm typecheck / pnpm build   # 個別執行
npx shadcn@latest add <component>   # UI 元件加到 @/components/ui
```

路徑別名：`@/*` → repo root（`@/components`, `@/lib`, `@/hooks`）。

## 導航結構

```
/login                                 登入
/strategies                            策略列表
/strategies/[strategyId]               策略詳情 + runs
/strategies/[strategyId]/runs/[runId]  run 詳情（圖表、trades、指標）
/report                                報表產生（日期區間 + 策略多選）
/model                                 shadow 模型預測監控（ypred vs 實際 y）
/settings                              通知設定等
```

## Supabase Schema（project: kszydawqmcpsvozzjpyh）

Auth：email/password，根目錄 `proxy.ts` 保護路由（Next 16 把 middleware 改成這個
檔名），session 存 cookies。

核心表（欄位細節不確定時用 `list_tables` 查，別猜）：

- **strategies**: strategy_id (PK), user_id, name, version, description, parent_strategy_id
  （nullable 自我參照、一層；`supabase/manual/2026-09-22-strategy-parent.sql`）。有子策略的
  「母策略」（如 Kepler）自己沒有 run，`/strategies/[id]` 會改顯示子策略目前 live run 的加總
  （`components/strategies/parent-strategy-view.tsx`）。讀這個欄位一律走
  `lib/strategy-hierarchy.ts`：它容忍欄位不存在（42703），SQL 未套用前 UI 退回扁平列表。
  子策略的 run 淨值是**模擬帳本**，Overview 不把它們算進任何 run 層級指標。母策略另有
  獨立卡片，勾選後 Active Equity Curve 會畫它的**帳戶真實權益**（`externalSeries`，取自
  資金面板已解出的資料）—— 它沒有 run_id，所以刻意不走曲線的歷史補抓、即時訂閱與
  run-mode 過濾，那些路徑全以 run_id 驅動、會把它靜默丟掉。
  **Kepler 引擎只把成交寫進 `trades`，`combined_trades` 只有零星幾筆**：任何從
  combined_trades 算的指標（turnover、positions 數、勝率）對它都近乎 0。turnover 已改走
  `getFillNotional` + PerformanceStats 的 `turnover` prop，其他指標還沒有。
  它寫的 `positions.liq_price` 也全是 null（產生型別卻標 `number`），對它 `.toLocaleString()`
  曾讓 `/positions` 整頁崩掉 —— positions 的數值欄位顯示前一律先判 null。
- **strategy_runs**: run_id (PK), strategy_id (FK), mode ('backtest'|'paper'|'live'|'realtime'|
  'test-realtime'), status, start_time, end_time, initial_capital, params (jsonb), code_ref, notes。
  **Overview 只認 `realtime` / `test-realtime`**（`app/(dashboard)/page.tsx` 與
  `overview-content.tsx` 各一份判斷）；母策略頁則認 `live` + `realtime`（`lib/parent-strategy.ts`）。
  非子策略的策略若改用 `live`，會在 Overview 靜默消失。
  **`start_time` 實際可能是 null**（引擎會先建 run 再補時間），產生型別卻標 `string`；
  直接 `.slice()` / `new Date()` 會讓整頁 SSR 崩成 error boundary。
- **trades**: trade_id (PK), run_id (FK), ts, symbol, exchange, action, side ('buy'|'sell'),
  quantity_nominal, quantity_actual, price, fee_amount_usdt, fee_rate_bps,
  funding_rate, interval_hours, status
- **positions**（持倉快照）：引擎平倉時**不寫 position = 0 的列，只是停止寫入**，
  所以「多久沒寫就算平倉」要看各 run 的寫入頻率（Newtonz 每 ~2 s、Kepler 每 ~15 min）。
  統一用固定秒數會讓慢的引擎持倉閃一下就消失；`/positions` 依每個 run 自己的寫入間隔判斷。
- **combined_trades**（持倉級 P&L）: combined_trade_id (PK), run_id, ts, symbol, exchange,
  side ('long'|'short'), quantity, entry_price, exit_price, holding_period_hours,
  price_pnl, funding_fee_realized, commission_fee, total_pnl
- **pnl_series**（每小時，PK = run_id+ts）: total_pnl, total_funding_pnl, total_price_pnl,
  total_fee, 以及 binance_*/bybit_* 各自拆分
- **equity_curve**（PK = run_id+ts）: total_equity, total_pnl, binance_equity, binance_pnl,
  bybit_equity, bybit_pnl, drawdown_pct。
  **`binance_*` / `bybit_*` 是沿用舊的兩所命名，不代表真的是那兩家** —— 欄位其實是
  「第一腿 / 第二腿」。例如 basis-funding 交易的是 binance + zoomex，zoomex 腿存在
  `bybit_equity`。要知道某個 run 真正的交易所，查 `trades.exchange`，別看欄位名。
  另外 `total_equity = binance_equity + bybit_equity`、`total_pnl` 同理，精確成立，
  改動任一腿都要一起維持這個關係。
- **shadow model 表**（`/model` 用；外部 shadow 程式寫入）：頁面只讀 view **`shadow_prediction_all`**
  —— 每 (event, model_version) 一列，`source` = live 或 replay（replay 只在 reproduced 且 live 無列時出現），
  已 join 好結果欄（y_bp、funding_bp、status）。它是 security_invoker，底下
  `shadow_prediction` / `shadow_prediction_replay` / `shadow_event_ledger` / `md_funding_settled`
  **每張都要有 authenticated 唯讀 policy**（`supabase/manual/2026-09-28-*-read-policy.sql`），
  少一張就會靜默少掉那部分的列（replay 曾經整批是 0）。多模型並存時頁面一次只看一個 model_version。
  `source` 不只 live / replay（還有 `replay_historical`，之後可能更多）—— 判斷一律用
  `isLiveSource()`，別比對字串 `'replay'`。這個 view 每次請求都重算整個 join，**別用 OFFSET 分頁**
  （30 天每頁 ~1.3 s）；照 `page.tsx` 按時段切塊並行讀。
  **實際損益 = `y_bp + funding_bp − fee`，`funding_bp` 是 `shadow_event_net` 用已結算 rate 算的；
  `exp_funding_bp` 只能用於進場決策**（使用者 2026-09-28 定案，`lib/model-eval.ts`）。拿 exp 算損益會把
  高 exp 的 event 高估，足以讓總損益翻號。`shadow_event_net` 是
  security_invoker，底層 `md_funding_settled` 沒有讀取 policy 時 funding_bp 會**靜默全為 null**。
  ledger 的 `open_volume_*` 也**不是**研究端的 qv_240，別拿來當流動性門檻。
- **user_strategy_access**: user_id, strategy_id, share_ratio —— 用戶對策略的份額，
  所有對用戶顯示/推播的金額都要乘 share_ratio
- **push_subscriptions / notification_preferences**：見 `docs/notifications.md`

**`fund_account_equity` 有一張觸發器維護的衍生表 `fund_account_equity_hourly`**
（Overview 的 30 天資金曲線靠它，直接讀原始表要 2.8 秒會撞 8 秒 statement_timeout）。
觸發器只涵蓋 INSERT/UPDATE，**沒有 DELETE** —— 刪原始表資料時彙總表不會跟著變，
Overview 會靜默顯示錯的金額。要刪就同時處理兩張表，或事後重跑
`supabase/manual/2026-08-29-fund-equity-hourly-rollup.sql` 的回填段。

## 子系統文件

- 推播通知全系統（trigger、hedge 配對、share_ratio、驗證方法）：`docs/notifications.md`
- **改 `lib/overview-queries.ts` 任何查詢的輸出欄位時，要把它的 cache keyParts 升版**
  （如 `overview:strategies-and-runs:v2`）。`cachedQuery` 交給 `unstable_cache` 的永遠是同一個
  包裝函式，改 `select` 不會改變 key，而 Vercel data cache 會跨部署保留 —— 新程式碼會一直
  拿到舊形狀的資料且不報錯。
- **跨交易所行情解析前先讀 `lib/services/volume-fetcher.ts` 的檔頭**：七家的 K 線
  欄位順序、排序方向、成交量單位都不一樣（BingX 只給 base、BitMart 給合約張數），
  解析錯不會噴錯、只會讓數字差 1000 倍。那裡記了每一家已實測驗證的對照與交叉驗算法。
  canonical↔native 符號轉換一律用 `lib/exchange-symbols.ts`，不要各自重寫。
- **時間一律 UTC+8（Asia/Taipei），走 `lib/time.ts`**（使用者 2026-09-28 定案）：顯示用
  `formatDateTime/formatDate/formatTime`，切日／週／月用 `taipeiDayKey` 等。**不要**直接
  `toLocaleString()` 不帶 timeZone —— 它在瀏覽器是 UTC+8、在 Vercel server 渲染是 UTC，同一列會出現兩種時間；
  也不要 `ts.slice(0, 10)` 當日期（那是 UTC 日，台北早上 8 點才換日）。刻意保留 UTC 的只有交易所 funding
  結算時點（`lib/services/funding-fetcher.ts`）與純 join key。
- **兩腿價差一律算 `(B − A) / A`**（opportunity 家族：spread modal 的歷史與即時兩條
  路徑、positions 的 entry spread、opportunity 表的 basis 欄）。直覺容易寫成
  `(A − B) / B`，寫反了不會壞、只會讓同一筆資料在表格與圖表差一個負號。
  例外：`lib/basis.ts` 是 basis-monitor 子系統，legs 由使用者自選，用 `(leg1 − leg2) / leg2`。

<!-- code-review-graph MCP tools -->
## MCP Tools: code-review-graph

This repo has a code-review-graph knowledge graph (`mcp__code-review-graph__*`; hooks keep it
updated on file changes). It answers structural questions — callers/callees, importers, impact
radius, affected flows, test coverage — for far fewer tokens than reading the files, so use it
when the question is about how code relates. Locating a string or reading a known file is still
Grep/Read.
