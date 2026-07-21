# Fund Equity Balance Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Overview 頁最上方新增 Fund Equity Balance dashboard：總餘額 + 可展開交易所卡片、全帳戶加總曲線（24h/7d/30d）、Supabase Realtime 即時更新。

**Architecture:** SSR 預取最近 30 天 `fund_account_equity` → Client `FundEquityDashboard` 持有 rows state → Realtime `INSERT` merge → 純函式 forward-fill 加總出曲線與摘要。不開新 API route；不套用 share_ratio。

**Tech Stack:** Next.js 15 App Router、React 19、Recharts + shadcn ChartContainer、Supabase client/server、既有 Card/Button。

**Spec:** `docs/superpowers/specs/2026-07-21-fund-equity-dashboard-design.md`

**測試策略說明:** 本 repo 無 vitest/jest/playwright，不引入。每個 task 的驗證改為：TypeScript/`pnpm build`、Supabase SQL 查詢確認、最後 task 手動端到端清單。

## Global Constraints

- 路徑別名 `@/*` → repo root。
- Client：`createClient` from `@/lib/supabase/client`（同步）；Server：`createClient` from `@/lib/supabase/server`（`await`）。
- Supabase project id：`kszydawqmcpsvozzjpyh`。DDL 必須用 MCP `apply_migration`，並落檔 `supabase/manual/<日期>-<描述>.sql`。
- 不套用 `user_strategy_access.share_ratio`。
- 曲線只有一條「全帳戶加總」；時間切換僅 `24h | 7d | 30d`。
- 既有策略 overview 區塊邏輯不動，僅在其上方插入新區塊。
- 每個 task 結尾 commit（僅包含該 task 相關檔案）。

---

## File Structure

| 路徑 | 職責 |
|------|------|
| `supabase/manual/2026-07-21-fund-account-equity-rls-realtime.sql` | RLS SELECT + realtime publication 紀錄 |
| `lib/types/database.ts` | 新增 `fund_account_equity` Table 型別 + `FundAccountEquity` alias |
| `lib/utils/fund-equity.ts` | 純函式：latest per account、exchange 加總、forward-fill 曲線、range Δ |
| `components/overview/fund-equity-dashboard.tsx` | Client 容器：state、Realtime、Summary、ExchangeCards、Chart |
| `app/(dashboard)/page.tsx` | SSR 分頁預取 30d fund equity，傳入 OverviewContent |
| `components/overview/overview-content.tsx` | 在 Header 下方、既有 metrics 上方渲染 `FundEquityDashboard` |

---

### Task 1: Supabase migration — RLS SELECT + Realtime publication

**Files:**
- Create: `supabase/manual/2026-07-21-fund-account-equity-rls-realtime.sql`

**Interfaces:**
- Consumes: 既有表 `public.fund_account_equity`
- Produces: authenticated 可 SELECT；表加入 `supabase_realtime` publication

- [ ] **Step 1: 用 MCP `apply_migration` 套用 DDL**

工具：`mcp__plugin_supabase_supabase__apply_migration`  
參數：`project_id: "kszydawqmcpsvozzjpyh"`，`name: "fund_account_equity_rls_realtime"`，SQL：

```sql
-- Authenticated users can read all fund account equity rows (fund-level, no per-user column)
create policy "fund_account_equity_select_authenticated"
  on public.fund_account_equity
  for select
  to authenticated
  using (true);

-- Enable realtime INSERT notifications for the dashboard
alter publication supabase_realtime add table public.fund_account_equity;
```

- [ ] **Step 2: 驗證 policy 與 publication**

工具：`mcp__plugin_supabase_supabase__execute_sql`，SQL：

```sql
select policyname, cmd, roles::text
from pg_policies
where tablename = 'fund_account_equity';

select exists (
  select 1 from pg_publication_tables
  where pubname = 'supabase_realtime'
    and tablename = 'fund_account_equity'
) as in_realtime;
```

預期：至少一列 `fund_account_equity_select_authenticated` / `SELECT`；`in_realtime = true`。

- [ ] **Step 3: 落檔 manual SQL 並 commit**

寫入 `supabase/manual/2026-07-21-fund-account-equity-rls-realtime.sql`（內容與 Step 1 SQL 相同，可加一行註解說明用途）。

```bash
git add supabase/manual/2026-07-21-fund-account-equity-rls-realtime.sql
git commit -m "$(cat <<'EOF'
chore(db): enable RLS select and realtime for fund_account_equity

EOF
)"
```

---

### Task 2: Database 型別 — `fund_account_equity`

**Files:**
- Modify: `lib/types/database.ts`

**Interfaces:**
- Consumes: 無
- Produces: `Database["public"]["Tables"]["fund_account_equity"]`；`export type FundAccountEquity`

- [ ] **Step 1: 在 `Tables` 內、`basis_pairs` 之後插入表定義**

```typescript
      fund_account_equity: {
        Row: {
          account_id: string;
          exchange: string;
          ts: string;
          total_equity: number;
        };
        Insert: {
          account_id: string;
          exchange: string;
          ts: string;
          total_equity: number;
        };
        Update: {
          account_id?: string;
          exchange?: string;
          ts?: string;
          total_equity?: number;
        };
      };
```

- [ ] **Step 2: 在 convenience aliases 區（`BasisPair` 附近）新增**

```typescript
export type FundAccountEquity =
  Database["public"]["Tables"]["fund_account_equity"]["Row"];
```

- [ ] **Step 3: Commit**

```bash
git add lib/types/database.ts
git commit -m "$(cat <<'EOF'
feat: add FundAccountEquity database types

EOF
)"
```

---

### Task 3: 純函式 — `lib/utils/fund-equity.ts`

**Files:**
- Create: `lib/utils/fund-equity.ts`

**Interfaces:**
- Consumes: `FundAccountEquity` from `@/lib/types/database`；`ChartDataPoint` from `@/lib/utils/equity`（僅 `{ time: number; equity: number }`）
- Produces:
  - `export type FundEquityRange = "24h" | "7d" | "30d"`
  - `export function rangeToMs(range: FundEquityRange): number`
  - `export function latestByAccount(rows: FundAccountEquity[]): Map<string, FundAccountEquity>`
  - `export function summarizeByExchange(latest: Map<string, FundAccountEquity>): { exchange: string; total: number; accounts: { account_id: string; total_equity: number }[] }[]`
  - `export function totalEquityFromLatest(latest: Map<string, FundAccountEquity>): number`
  - `export function buildFundEquityCurve(rows: FundAccountEquity[], sinceMs: number): ChartDataPoint[]`
  - `export function computeRangeDelta(curve: ChartDataPoint[], currentTotal: number): { delta: number; deltaPct: number | null }`

- [ ] **Step 1: 建立檔案，實作下列完整內容**

```typescript
import type { FundAccountEquity } from "@/lib/types/database";
import type { ChartDataPoint } from "@/lib/utils/equity";

export type FundEquityRange = "24h" | "7d" | "30d";

export function rangeToMs(range: FundEquityRange): number {
  switch (range) {
    case "24h":
      return 24 * 60 * 60 * 1000;
    case "7d":
      return 7 * 24 * 60 * 60 * 1000;
    case "30d":
      return 30 * 24 * 60 * 60 * 1000;
  }
}

/** Latest row per account_id (max ts wins). */
export function latestByAccount(
  rows: FundAccountEquity[]
): Map<string, FundAccountEquity> {
  const map = new Map<string, FundAccountEquity>();
  for (const row of rows) {
    const prev = map.get(row.account_id);
    if (!prev || new Date(row.ts).getTime() > new Date(prev.ts).getTime()) {
      map.set(row.account_id, row);
    }
  }
  return map;
}

export function totalEquityFromLatest(
  latest: Map<string, FundAccountEquity>
): number {
  let sum = 0;
  for (const row of latest.values()) {
    sum += Number(row.total_equity);
  }
  return sum;
}

export function summarizeByExchange(
  latest: Map<string, FundAccountEquity>
): {
  exchange: string;
  total: number;
  accounts: { account_id: string; total_equity: number }[];
}[] {
  const byEx = new Map<
    string,
    { account_id: string; total_equity: number }[]
  >();
  for (const row of latest.values()) {
    const list = byEx.get(row.exchange) ?? [];
    list.push({
      account_id: row.account_id,
      total_equity: Number(row.total_equity),
    });
    byEx.set(row.exchange, list);
  }
  return Array.from(byEx.entries())
    .map(([exchange, accounts]) => {
      accounts.sort((a, b) => a.account_id.localeCompare(b.account_id));
      const total = accounts.reduce((s, a) => s + a.total_equity, 0);
      return { exchange, total, accounts };
    })
    .sort((a, b) => a.exchange.localeCompare(b.exchange));
}

/**
 * Forward-fill per account across the union of timestamps >= sinceMs,
 * then sum. Accounts with no row yet at a ts are skipped (not zero-filled).
 * Rows with ts < sinceMs are still used as seed for forward-fill.
 */
export function buildFundEquityCurve(
  rows: FundAccountEquity[],
  sinceMs: number
): ChartDataPoint[] {
  if (rows.length === 0) return [];

  const byAccount = new Map<string, { t: number; equity: number }[]>();
  for (const row of rows) {
    const t = new Date(row.ts).getTime();
    const list = byAccount.get(row.account_id) ?? [];
    list.push({ t, equity: Number(row.total_equity) });
    byAccount.set(row.account_id, list);
  }
  for (const list of byAccount.values()) {
    list.sort((a, b) => a.t - b.t);
  }

  const timestamps = new Set<number>();
  for (const list of byAccount.values()) {
    for (const p of list) {
      if (p.t >= sinceMs) timestamps.add(p.t);
    }
  }
  const sortedTs = Array.from(timestamps).sort((a, b) => a - b);
  if (sortedTs.length === 0) return [];

  const indices = new Map<string, number>();
  for (const id of byAccount.keys()) indices.set(id, -1);

  const curve: ChartDataPoint[] = [];
  for (const ts of sortedTs) {
    let sum = 0;
    let contributors = 0;
    for (const [accountId, list] of byAccount) {
      let idx = indices.get(accountId)!;
      while (idx + 1 < list.length && list[idx + 1].t <= ts) {
        idx += 1;
      }
      indices.set(accountId, idx);
      if (idx >= 0) {
        sum += list[idx].equity;
        contributors += 1;
      }
    }
    if (contributors > 0) {
      curve.push({ time: ts, equity: sum });
    }
  }
  return curve;
}

export function computeRangeDelta(
  curve: ChartDataPoint[],
  currentTotal: number
): { delta: number; deltaPct: number | null } {
  if (curve.length === 0) {
    return { delta: 0, deltaPct: null };
  }
  const start = curve[0].equity;
  const delta = currentTotal - start;
  const deltaPct = start !== 0 ? (delta / start) * 100 : null;
  return { delta, deltaPct };
}

/** Upsert a row into an array keyed by (account_id, ts). */
export function upsertFundEquityRow(
  rows: FundAccountEquity[],
  incoming: FundAccountEquity
): FundAccountEquity[] {
  const key = `${incoming.account_id}|${incoming.ts}`;
  let replaced = false;
  const next = rows.map((r) => {
    if (`${r.account_id}|${r.ts}` === key) {
      replaced = true;
      return incoming;
    }
    return r;
  });
  if (!replaced) next.push(incoming);
  return next.sort(
    (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime()
  );
}
```

- [ ] **Step 2: 用 node/tsx 或臨時 assert 做快速心智驗證（可選但建議）**

在 shell（repo root）用 `pnpm exec tsx -e '...'` 若專案有 tsx；否則跳過，改在 Task 6 build 驗證型別。

最小檢查（若可跑）：

```typescript
import {
  latestByAccount,
  buildFundEquityCurve,
  totalEquityFromLatest,
} from "./lib/utils/fund-equity.ts";

const rows = [
  { account_id: "a", exchange: "binance", ts: "2026-07-21T10:00:00Z", total_equity: 100 },
  { account_id: "b", exchange: "bybit", ts: "2026-07-21T10:00:00Z", total_equity: 50 },
  { account_id: "a", exchange: "binance", ts: "2026-07-21T10:01:00Z", total_equity: 110 },
];
const latest = latestByAccount(rows);
console.assert(totalEquityFromLatest(latest) === 160);
const curve = buildFundEquityCurve(rows, Date.parse("2026-07-21T10:00:00Z"));
console.assert(curve.length === 2);
console.assert(curve[0].equity === 150);
console.assert(curve[1].equity === 160); // b forward-filled
console.log("ok");
```

- [ ] **Step 3: Commit**

```bash
git add lib/utils/fund-equity.ts
git commit -m "$(cat <<'EOF'
feat: add fund equity aggregation helpers

EOF
)"
```

---

### Task 4: UI — `FundEquityDashboard`（摘要 + 交易所卡 + 曲線 + Realtime）

**Files:**
- Create: `components/overview/fund-equity-dashboard.tsx`

**Interfaces:**
- Consumes: `FundAccountEquity`；`lib/utils/fund-equity` 全部 exports；`downsample` from `@/lib/utils/equity`；`createClient` from `@/lib/supabase/client`；shadcn `Card`/`Button`；recharts via `@/components/ui/chart`；`ChevronDown`/`ChevronRight` from `lucide-react`
- Produces: `export function FundEquityDashboard({ initialData, fetchError? }: { initialData: FundAccountEquity[]; fetchError?: string | null })`

- [ ] **Step 1: 建立完整 client component**

實作要點（必須全部具備，勿省略）：

1. `"use client"`；`useState(initialData)` 持有 `rows`；`useState<FundEquityRange>("24h")`；`useState<Set<string>>` 追蹤展開的 exchange；`useState(true)` 追蹤 realtime 連線（`SUBSCRIBED` → true，`CHANNEL_ERROR`/`TIMED_OUT`/`CLOSED` → false）。
2. `useEffect` 訂閱：

```typescript
const supabase = createClient();
const channel = supabase
  .channel(`fund-equity-${Date.now()}`)
  .on(
    "postgres_changes",
    { event: "INSERT", schema: "public", table: "fund_account_equity" },
    (payload) => {
      const row = payload.new as FundAccountEquity;
      setRows((prev) => upsertFundEquityRow(prev, row));
    }
  )
  .subscribe((status) => {
    if (status === "SUBSCRIBED") setLive(true);
    if (
      status === "CHANNEL_ERROR" ||
      status === "TIMED_OUT" ||
      status === "CLOSED"
    ) {
      setLive(false);
    }
  });
return () => {
  supabase.removeChannel(channel);
};
```

3. `useMemo` 計算：`latest`、`total`、`exchanges`、`sinceMs = Date.now() - rangeToMs(range)`、`curve = downsample(buildFundEquityCurve(rows, sinceMs))`、`{ delta, deltaPct } = computeRangeDelta(curve, total)`。
4. **空狀態**：`rows.length === 0` 且無 `fetchError` → Card 內文「尚無帳戶權益資料」。
5. **錯誤狀態**：有 `fetchError` → Card 內文顯示錯誤，不渲染假數字。
6. **Layout（有資料時）**：
   - 標題列：`Fund Equity` + 可選小綠點 Live /「即時更新暫停」
   - Summary Card：總餘額 `$X,XXX.XX`；其下 Δ 依正負用 emerald/red；顯示選取 range 標籤
   - Exchange cards：grid（`sm:grid-cols-3`）；點卡片 header toggle 展開；展開後列出 `account_id` + equity
   - Chart Card：三顆 Button `24h` / `7d` / `30d`；`AreaChart` 單線 `equity`，色系對齊 overview（`hsl(142 76% 36%)`）；XAxis 用 time；YAxis domain 可略 padding；`ChartTooltip` 顯示時間與金額
7. Exchange 顯示名：首字大寫即可（`binance` → `Binance`），不要 hardcode 只有三家（未來帳戶可能增加）。

金額格式：

```typescript
value.toLocaleString(undefined, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
```

參考既有 `OverviewPerformanceChart` 的 `ChartContainer` / `Area` / `AreaChart` 用法，保持同樣 import 風格。

- [ ] **Step 2: Commit**

```bash
git add components/overview/fund-equity-dashboard.tsx
git commit -m "$(cat <<'EOF'
feat: add FundEquityDashboard with realtime updates

EOF
)"
```

---

### Task 5: 串接 Overview — SSR 預取 + 頁面插入

**Files:**
- Modify: `app/(dashboard)/page.tsx`
- Modify: `components/overview/overview-content.tsx`

**Interfaces:**
- Consumes: `FundAccountEquity`；`FundEquityDashboard`
- Produces: Overview 頂部渲染 dashboard；SSR 失敗時傳 `fundEquityError`，不中斷策略區塊

- [ ] **Step 1: 在 `page.tsx` 新增 fetch helper（放在既有 `fetchEquityDataWithLimit` 旁）**

```typescript
async function fetchFundAccountEquity(
  supabase: SupabaseClient,
  since: string
): Promise<{ data: FundAccountEquity[]; error: string | null }> {
  const PAGE_SIZE = 1000;
  const allData: FundAccountEquity[] = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabase
      .from("fund_account_equity")
      .select("account_id, exchange, ts, total_equity")
      .gte("ts", since)
      .order("ts", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) {
      console.error("Error fetching fund_account_equity:", error);
      return { data: allData, error: error.message };
    }

    if (data && data.length > 0) {
      allData.push(...(data as FundAccountEquity[]));
      offset += PAGE_SIZE;
      hasMore = data.length === PAGE_SIZE;
    } else {
      hasMore = false;
    }
  }

  return { data: allData, error: null };
}
```

記得 `import type { FundAccountEquity } from "@/lib/types/database"`。

- [ ] **Step 2: 在 `DashboardPage` 的 Promise.all 中加入預取**

```typescript
const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
```

與現有 equity/trades 並行呼叫 `fetchFundAccountEquity(supabase, since30d)`，將結果解構為 `fundEquityResult`。

傳給 `OverviewContent`：

```tsx
fundEquityData={fundEquityResult.data}
fundEquityError={fundEquityResult.error}
```

- [ ] **Step 3: 更新 `OverviewContent` props 與渲染位置**

在 props interface 新增：

```typescript
fundEquityData: FundAccountEquity[];
fundEquityError: string | null;
```

在 return 的 JSX 中，**Header 之後、既有 Metrics Strip 之前**插入：

```tsx
<FundEquityDashboard
  initialData={fundEquityData}
  fetchError={fundEquityError}
/>
```

並 `import { FundEquityDashboard } from "@/components/overview/fund-equity-dashboard"`。

- [ ] **Step 4: Commit**

```bash
git add app/(dashboard)/page.tsx components/overview/overview-content.tsx
git commit -m "$(cat <<'EOF'
feat: wire fund equity dashboard into overview page

EOF
)"
```

---

### Task 6: Build 驗證 + 手動端到端

**Files:** 無新檔（僅驗證）

- [ ] **Step 1: 跑 build**

```bash
pnpm build
```

預期：成功結束，無型別錯誤。若失敗，修到通過後另開 commit（`fix: ...`），不要 amend 已 push 的 commit。

- [ ] **Step 2: 手動端到端清單（`pnpm dev` + 登入）**

在瀏覽器開 `/`：

- [ ] 頁面最上方出現 **Fund Equity** 區塊，下方仍是既有策略 Total Equity / Active Strategies / Today’s Trades
- [ ] 總餘額 ≈ 各帳戶最新加總（可用 Supabase SQL 對照：

```sql
select distinct on (account_id) account_id, exchange, total_equity, ts
from fund_account_equity
order by account_id, ts desc;
```

）
- [ ] 點交易所小卡可展開/收合帳戶明細
- [ ] 切換 24h / 7d / 30d，曲線與 Δ 有變化（資料不足時曲線變短，不報錯）
- [ ] 對表插入一筆新列後（或等外部同步寫入），無需整頁重整，總餘額或曲線更新；Live 指示為連線狀態
- [ ] （可選）暫時撤銷 SELECT policy 再 reload：區塊應顯示錯誤或空，下方策略 overview 仍可用——驗證完立刻恢復 policy

- [ ] **Step 3: 若手動測試有修 bug，各自 commit；全部通過後無需空 commit**

---

## Spec coverage（self-review）

| Spec 要求 | Task |
|-----------|------|
| Overview 最上方 Fund Equity | Task 5 |
| 總餘額 + 交易所小卡可展開 | Task 4 |
| 加總一條曲線 | Task 3 + 4 |
| 24h/7d/30d | Task 3 + 4 |
| SSR 30d 預取 | Task 5 |
| Realtime INSERT | Task 1 + 4 |
| RLS SELECT + publication | Task 1 |
| 型別 | Task 2 |
| forward-fill / 不補 0 | Task 3 |
| 空狀態 / SSR 錯誤隔離 | Task 4 + 5 |
| 不套用 share_ratio | Global + Task 3/4 |
| 端到端驗證 | Task 6 |
