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

## Stack

Next.js 15 (App Router, Turbopack) / React 19 / TypeScript strict / Tailwind v4
(CSS-based config, no tailwind.config.js) / shadcn/ui (new-york, lucide-react) /
pnpm / Supabase (auth + DB + storage) / Vercel 部署 / PWA + Web Push。

```bash
pnpm dev / pnpm build / pnpm lint
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
/settings                              通知設定等
```

## Supabase Schema（project: kszydawqmcpsvozzjpyh）

Auth：email/password，middleware.ts 保護路由，session 存 cookies。

核心表（欄位細節不確定時用 `list_tables` 查，別猜）：

- **strategies**: strategy_id (PK), user_id, name, version, description
- **strategy_runs**: run_id (PK), strategy_id (FK), mode ('backtest'|'paper'|'live'|'realtime'),
  status, start_time, end_time, initial_capital, params (jsonb), code_ref, notes
- **trades**: trade_id (PK), run_id (FK), ts, symbol, exchange, action, side ('buy'|'sell'),
  quantity_nominal, quantity_actual, price, fee_amount_usdt, fee_rate_bps,
  funding_rate, interval_hours, status
- **combined_trades**（持倉級 P&L）: combined_trade_id (PK), run_id, ts, symbol, exchange,
  side ('long'|'short'), quantity, entry_price, exit_price, holding_period_hours,
  price_pnl, funding_fee_realized, commission_fee, total_pnl
- **pnl_series**（每小時，PK = run_id+ts）: total_pnl, total_funding_pnl, total_price_pnl,
  total_fee, 以及 binance_*/bybit_* 各自拆分
- **equity_curve**（PK = run_id+ts）: total_equity, total_pnl, binance_equity, binance_pnl,
  bybit_equity, bybit_pnl, drawdown_pct
- **user_strategy_access**: user_id, strategy_id, share_ratio —— 用戶對策略的份額，
  所有對用戶顯示/推播的金額都要乘 share_ratio
- **push_subscriptions / notification_preferences**：見 `docs/notifications.md`

## 子系統文件

- 推播通知全系統（trigger、hedge 配對、share_ratio、驗證方法）：`docs/notifications.md`
