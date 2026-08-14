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
/settings                              通知設定等
```

## Supabase Schema（project: kszydawqmcpsvozzjpyh）

Auth：email/password，根目錄 `proxy.ts` 保護路由（Next 16 把 middleware 改成這個
檔名），session 存 cookies。

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
- **跨交易所行情解析前先讀 `lib/services/volume-fetcher.ts` 的檔頭**：七家的 K 線
  欄位順序、排序方向、成交量單位都不一樣（BingX 只給 base、BitMart 給合約張數），
  解析錯不會噴錯、只會讓數字差 1000 倍。那裡記了每一家已實測驗證的對照與交叉驗算法。
  canonical↔native 符號轉換一律用 `lib/exchange-symbols.ts`，不要各自重寫。
- **兩腿價差一律算 `(B − A) / A`**（opportunity 家族：spread modal 的歷史與即時兩條
  路徑、positions 的 entry spread、opportunity 表的 basis 欄）。直覺容易寫成
  `(A − B) / B`，寫反了不會壞、只會讓同一筆資料在表格與圖表差一個負號 —— 已經發生過。
  例外：`lib/basis.ts` 是 basis-monitor 子系統，legs 由使用者自選，用 `(leg1 − leg2) / leg2`。

<!-- code-review-graph MCP tools -->
## MCP Tools: code-review-graph

**IMPORTANT: This project has a knowledge graph. ALWAYS use the
code-review-graph MCP tools BEFORE using Grep/Glob/Read to explore
the codebase.** The graph is faster, cheaper (fewer tokens), and gives
you structural context (callers, dependents, test coverage) that file
scanning cannot.

### When to use graph tools FIRST

- **Exploring code**: `semantic_search_nodes_tool` or `query_graph_tool` instead of Grep
- **Understanding impact**: `get_impact_radius_tool` instead of manually tracing imports
- **Code review**: `detect_changes_tool` + `get_review_context_tool` instead of reading entire files
- **Finding relationships**: `query_graph_tool` with callers_of/callees_of/imports_of/tests_for
- **Architecture questions**: `get_architecture_overview_tool` + `list_communities_tool`

Fall back to Grep/Glob/Read **only** when the graph doesn't cover what you need.

### Key Tools

| Tool | Use when |
| ------ | ---------- |
| `detect_changes_tool` | Reviewing code changes — gives risk-scored analysis |
| `get_review_context_tool` | Need source snippets for review — token-efficient |
| `get_impact_radius_tool` | Understanding blast radius of a change |
| `get_affected_flows_tool` | Finding which execution paths are impacted |
| `query_graph_tool` | Tracing callers, callees, imports, tests, dependencies |
| `semantic_search_nodes_tool` | Finding functions/classes by name or keyword |
| `get_architecture_overview_tool` | Understanding high-level codebase structure |
| `refactor_tool` | Planning renames, finding dead code |

### Workflow

1. The graph auto-updates on file changes (via hooks).
2. Use `detect_changes_tool` for code review.
3. Use `get_affected_flows_tool` to understand impact.
4. Use `query_graph_tool` pattern="tests_for" to check coverage.
