# Basis Monitor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增 `/basis-monitor` 頁面：任選兩個標的（Binance/Bybit × perp/spot × symbol）畫歷史 basis 走勢圖，並可儲存 pair 清單附即時快照。

**Architecture:** 方案 A（on-demand）：前端打 `/api/klines`（擴充 spot 支援）拉兩腳 K 線、client 對齊計算 basis；Supabase 只存 pair 定義（`basis_pairs` 表 + RLS）。新增 `/api/symbols`（combobox 選項）與 `/api/tickers`（清單快照）兩個 route。

**Tech Stack:** Next.js 15 App Router（route handlers 用 edge runtime）、React 19、Recharts + shadcn ChartContainer、shadcn Popover+Command combobox、Supabase（`@/lib/supabase/client|server`）、sonner toast。

**Spec:** `docs/superpowers/specs/2026-07-11-basis-monitor-design.md`（含實作修訂節）

**測試策略說明:** 本 repo 無測試框架（無 vitest/jest/playwright），依既有慣例不引入。每個 task 的驗證改為：TypeScript 編譯（`pnpm build`）、route 用 curl 實測、UI 用 dev server 手動端到端（最後一個 task 有完整清單）。

**慣例提醒:**
- 路徑別名 `@/*` → repo root。
- Client component 用 `createClient` from `@/lib/supabase/client`（同步）；server 用 `@/lib/supabase/server`（要 `await`）。
- Supabase DDL 必須用 MCP `apply_migration`（專案硬規則）。project id：`kszydawqmcpsvozzjpyh`。
- 每個 task 結尾 commit；commit message 尾加 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`。

---

### Task 1: Supabase migration — `basis_pairs` 表 + RLS

**Files:** 無 repo 檔案（DDL 經 `apply_migration` 存於 Supabase migrations）

- [ ] **Step 1: 用 MCP `apply_migration` 建表**

工具：`mcp__plugin_supabase_supabase__apply_migration`
參數：`project_id: "kszydawqmcpsvozzjpyh"`, `name: "create_basis_pairs"`，SQL：

```sql
create table public.basis_pairs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  leg1_exchange text not null check (leg1_exchange in ('Binance','Bybit')),
  leg1_market   text not null check (leg1_market in ('perp','spot')),
  leg1_symbol   text not null,
  leg2_exchange text not null check (leg2_exchange in ('Binance','Bybit')),
  leg2_market   text not null check (leg2_market in ('perp','spot')),
  leg2_symbol   text not null,
  alert_enabled boolean not null default false,
  alert_threshold_pct numeric,
  created_at timestamptz not null default now(),
  unique (user_id, leg1_exchange, leg1_market, leg1_symbol,
          leg2_exchange, leg2_market, leg2_symbol)
);

alter table public.basis_pairs enable row level security;

create policy "basis_pairs_select_own" on public.basis_pairs
  for select using (auth.uid() = user_id);
create policy "basis_pairs_insert_own" on public.basis_pairs
  for insert with check (auth.uid() = user_id);
create policy "basis_pairs_delete_own" on public.basis_pairs
  for delete using (auth.uid() = user_id);
```

設計要點：`user_id default auth.uid()` 讓 client insert 不必手動帶 user_id；check constraints 與前端型別一致（大寫交易所名，同 app 的 `Exchange` 型別）；Phase 1 無 update 需求所以不開 update policy。

- [ ] **Step 2: 驗證表存在且 RLS 開啟**

工具：`mcp__plugin_supabase_supabase__execute_sql`，SQL：

```sql
select relname, relrowsecurity from pg_class where relname = 'basis_pairs';
```

預期：一列，`relrowsecurity = true`。再查 policies：

```sql
select policyname, cmd from pg_policies where tablename = 'basis_pairs';
```

預期：三列（select / insert / delete）。

（本 task 無 repo 檔案變更，不需 commit；migration 本身即紀錄。）

---

### Task 2: Database 型別 — `basis_pairs` 加入 `lib/types/database.ts`

**Files:**
- Modify: `lib/types/database.ts`

- [ ] **Step 1: 在 `Database.public.Tables` 中新增 `basis_pairs`**

先 Read 該檔找到 Tables 內按字母序或現有順序的合適插入點（照檔內既有排列慣例放），插入：

```typescript
      basis_pairs: {
        Row: {
          id: string;
          user_id: string;
          leg1_exchange: string;
          leg1_market: string;
          leg1_symbol: string;
          leg2_exchange: string;
          leg2_market: string;
          leg2_symbol: string;
          alert_enabled: boolean;
          alert_threshold_pct: number | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string;
          leg1_exchange: string;
          leg1_market: string;
          leg1_symbol: string;
          leg2_exchange: string;
          leg2_market: string;
          leg2_symbol: string;
          alert_enabled?: boolean;
          alert_threshold_pct?: number | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          leg1_exchange?: string;
          leg1_market?: string;
          leg1_symbol?: string;
          leg2_exchange?: string;
          leg2_market?: string;
          leg2_symbol?: string;
          alert_enabled?: boolean;
          alert_threshold_pct?: number | null;
          created_at?: string;
        };
      };
```

- [ ] **Step 2: 新增 convenience alias**

在檔案的既有 alias 區（`export type Strategy = ...` 之類的地方；若該檔沒有 alias 區就加在檔尾）加：

```typescript
export type BasisPair = Database["public"]["Tables"]["basis_pairs"]["Row"];
```

- [ ] **Step 3: 型別檢查**

Run: `npx tsc --noEmit`
預期：無錯誤（或僅有與本次改動無關的既有錯誤——若有既有錯誤，記下數量，後續 task 以不增加為準）。

- [ ] **Step 4: Commit**

```bash
git add lib/types/database.ts
git commit -m "feat: Add basis_pairs table types"
```

---

### Task 3: basis 計算模組 — `lib/basis.ts`

**Files:**
- Create: `lib/basis.ts`

- [ ] **Step 1: 建立檔案，完整內容：**

```typescript
export type Market = "perp" | "spot";
export type BasisExchange = "Binance" | "Bybit";

export const BASIS_EXCHANGES: BasisExchange[] = ["Binance", "Bybit"];
export const MARKETS: Market[] = ["perp", "spot"];

export interface BasisLeg {
  exchange: BasisExchange;
  market: Market;
  symbol: string;
}

export interface BasisPoint {
  time: number; // ms timestamp（K 線 open time）
  leg1: number;
  leg2: number;
  basisPct: number; // (leg1 - leg2) / leg2 * 100
  basisAbs: number; // leg1 - leg2（USDT）
}

// 兩腳 K 線以 open time join，任一腳缺的蠟燭直接丟棄（跨交易所偶有缺 K）
export function computeBasisSeries(
  leg1Klines: [number, number][],
  leg2Klines: [number, number][]
): BasisPoint[] {
  const leg2Map = new Map(leg2Klines);
  const points: BasisPoint[] = [];
  for (const [time, p1] of leg1Klines) {
    const p2 = leg2Map.get(time);
    if (p2 === undefined || p2 === 0) continue;
    points.push({
      time,
      leg1: p1,
      leg2: p2,
      basisPct: ((p1 - p2) / p2) * 100,
      basisAbs: p1 - p2,
    });
  }
  return points.sort((a, b) => a.time - b.time);
}

export function legLabel(leg: BasisLeg): string {
  return `${leg.symbol} ${leg.exchange} ${leg.market}`;
}

export function pairLabel(leg1: BasisLeg, leg2: BasisLeg): string {
  return `${legLabel(leg1)} / ${legLabel(leg2)}`;
}
```

- [ ] **Step 2: 型別檢查**

Run: `npx tsc --noEmit`
預期：無新增錯誤。

- [ ] **Step 3: Commit**

```bash
git add lib/basis.ts
git commit -m "feat: Add basis computation helpers"
```

---

### Task 4: 擴充 `/api/klines` — `market=perp|spot` 參數

**Files:**
- Modify: `app/api/klines/route.ts`

改動範圍：`fetchBinanceKlines`、`fetchBybitKlines` 加 `market` 參數；GET handler 解析與驗證 `market`。其他五家交易所不動（維持 perp-only）。既有呼叫方不帶 `market` → 預設 `"perp"`，行為完全不變。

- [ ] **Step 1: 修改 `fetchBinanceKlines`（完整替換該函式）**

```typescript
async function fetchBinanceKlines(
  symbol: string,
  interval: string,
  maxKlines: number,
  market: "perp" | "spot"
): Promise<[number, number][]> {
  // spot 端點單次上限 1000，futures 為 1500
  const LIMIT = market === "perp" ? 1500 : 1000;
  const baseUrl =
    market === "perp"
      ? "https://fapi.binance.com/fapi/v1/klines"
      : "https://api.binance.com/api/v3/klines";
  const maxRequests = Math.ceil(maxKlines / LIMIT);
  const allKlines: [number, number][] = [];
  let oldestTime = Date.now();
  for (let i = 0; i < maxRequests && allKlines.length < maxKlines; i++) {
    const url =
      i === 0
        ? `${baseUrl}?symbol=${symbol.toUpperCase()}&interval=${interval}&limit=${LIMIT}`
        : `${baseUrl}?symbol=${symbol.toUpperCase()}&interval=${interval}&limit=${LIMIT}&endTime=${oldestTime - 1}`;
    const response = await fetch(url);
    if (!response.ok) break;
    const data = await response.json();
    const klines: [number, number][] = data.map((k: (string | number)[]) => [Number(k[0]), parseFloat(k[4] as string)]);
    if (klines.length === 0) break;
    allKlines.unshift(...klines);
    oldestTime = klines[0][0];
    if (klines.length < LIMIT) break;
  }
  return allKlines;
}
```

（spot 與 futures 的 kline 回傳陣列格式相同：`k[0]` open time、`k[4]` close。）

- [ ] **Step 2: 修改 `fetchBybitKlines`（完整替換該函式）**

```typescript
async function fetchBybitKlines(
  symbol: string,
  interval: string,
  maxKlines: number,
  market: "perp" | "spot"
): Promise<[number, number][]> {
  const category = market === "perp" ? "linear" : "spot";
  const LIMIT = 1000;
  const maxRequests = Math.ceil(maxKlines / LIMIT);
  const allKlines: [number, number][] = [];
  let endTime = Date.now();
  for (let i = 0; i < maxRequests && allKlines.length < maxKlines; i++) {
    const url = `https://api.bybit.com/v5/market/kline?category=${category}&symbol=${symbol.toUpperCase()}&interval=${interval}&limit=${LIMIT}&end=${endTime}`;
    const response = await fetch(url);
    if (!response.ok) break;
    const data = await response.json();
    if (data.retCode !== 0 || !data.result?.list?.length) break;
    const klines: [number, number][] = data.result.list.map((k: string[]) => [parseInt(k[0]), parseFloat(k[4])]);
    allKlines.push(...klines);
    const oldest = Math.min(...klines.map((k) => k[0]));
    endTime = oldest - 1;
    if (klines.length < LIMIT) break;
  }
  return allKlines.sort((a, b) => a[0] - b[0]);
}
```

（v5 kline 端點 linear/spot 共用，interval 字串格式相同，只差 `category`。）

- [ ] **Step 3: 修改 GET handler**

在 `const days = ...` 之後加入 market 解析與驗證：

```typescript
  const market = (searchParams.get("market") ?? "perp") as "perp" | "spot";

  if (!exchange || !symbol || !VALID_EXCHANGES.includes(exchange)) {
    return NextResponse.json({ error: "Missing or invalid exchange/symbol" }, { status: 400 });
  }
  if (market !== "perp" && market !== "spot") {
    return NextResponse.json({ error: "Invalid market" }, { status: 400 });
  }
  if (market === "spot" && exchange !== "Binance" && exchange !== "Bybit") {
    return NextResponse.json({ error: "spot only supported for Binance/Bybit" }, { status: 400 });
  }
```

（原本的 `if (!exchange || !symbol || ...)` 驗證保留，上面只是展示插入位置。）

switch 內兩個 case 改為傳入 market：

```typescript
      case "Binance":
        klines = await fetchBinanceKlines(symbol, interval, config.fetchKlines, market);
        break;
      case "Bybit":
        klines = await fetchBybitKlines(symbol, interval, config.fetchKlines, market);
        break;
```

結尾 log 加上 market 方便除錯：

```typescript
    console.log(`[klines] ${exchange}/${symbol} ${market} ${config.label} (${interval}): ${klines.length} candles`);
```

- [ ] **Step 4: curl 驗證（需 dev server：`pnpm dev` 背景執行）**

```bash
# 既有行為不變（perp 預設）
curl -s 'http://localhost:3000/api/klines?exchange=Binance&symbol=BTCUSDT&days=1' | head -c 120
# 預期：[[17...,1...],... JSON 陣列

# 新增 spot
curl -s 'http://localhost:3000/api/klines?exchange=Binance&symbol=BTCUSDT&days=1&market=spot' | head -c 120
curl -s 'http://localhost:3000/api/klines?exchange=Bybit&symbol=BTCUSDT&days=1&market=spot' | head -c 120
# 預期：皆為非空 JSON 陣列，且 spot 與 perp 的價格略有差異

# 驗證拒絕非法組合
curl -s 'http://localhost:3000/api/klines?exchange=Gate&symbol=BTCUSDT&days=1&market=spot'
# 預期：{"error":"spot only supported for Binance/Bybit"}（HTTP 400）
```

- [ ] **Step 5: Commit**

```bash
git add app/api/klines/route.ts
git commit -m "feat: Add spot market support to klines API for Binance/Bybit"
```

---

### Task 5: 新增 `/api/symbols`

**Files:**
- Create: `app/api/symbols/route.ts`

- [ ] **Step 1: 建立檔案，完整內容：**

```typescript
import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";
export const preferredRegion = ["sin1", "hkg1", "kix1"];

// 交易所 symbol 清單變動極少，underlying fetch cache 1 小時
const CACHE_1H = { next: { revalidate: 3600 } };

type Market = "perp" | "spot";

async function fetchBinanceSymbols(market: Market): Promise<string[]> {
  const url =
    market === "perp"
      ? "https://fapi.binance.com/fapi/v1/exchangeInfo"
      : "https://api.binance.com/api/v3/exchangeInfo";
  const response = await fetch(url, CACHE_1H);
  if (!response.ok) return [];
  const data = await response.json();
  return ((data.symbols ?? []) as { symbol: string; status: string; quoteAsset: string; contractType?: string }[])
    .filter(
      (s) =>
        s.status === "TRADING" &&
        s.quoteAsset === "USDT" &&
        (market === "spot" || s.contractType === "PERPETUAL")
    )
    .map((s) => s.symbol)
    .sort();
}

async function fetchBybitSymbols(market: Market): Promise<string[]> {
  const category = market === "perp" ? "linear" : "spot";
  const symbols: string[] = [];
  let cursor = "";
  do {
    const url = `https://api.bybit.com/v5/market/instruments-info?category=${category}&limit=1000${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const response = await fetch(url, CACHE_1H);
    if (!response.ok) break;
    const data = await response.json();
    if (data.retCode !== 0) break;
    for (const item of (data.result?.list ?? []) as {
      symbol: string;
      status: string;
      quoteCoin: string;
      contractType?: string;
    }[]) {
      if (
        item.status === "Trading" &&
        item.quoteCoin === "USDT" &&
        (market === "spot" || item.contractType === "LinearPerpetual")
      ) {
        symbols.push(item.symbol);
      }
    }
    cursor = data.result?.nextPageCursor ?? "";
  } while (cursor);
  return symbols.sort();
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const exchange = searchParams.get("exchange");
  const market = (searchParams.get("market") ?? "perp") as Market;

  if (
    (exchange !== "Binance" && exchange !== "Bybit") ||
    (market !== "perp" && market !== "spot")
  ) {
    return NextResponse.json({ error: "Invalid exchange/market" }, { status: 400 });
  }

  try {
    const symbols =
      exchange === "Binance" ? await fetchBinanceSymbols(market) : await fetchBybitSymbols(market);
    return NextResponse.json(symbols);
  } catch (e) {
    console.error(`[symbols] ${exchange}/${market} error:`, e);
    return NextResponse.json([], { status: 200 });
  }
}
```

- [ ] **Step 2: curl 驗證（4 種組合）**

```bash
for ex in Binance Bybit; do for mk in perp spot; do
  echo "$ex $mk: $(curl -s "http://localhost:3000/api/symbols?exchange=$ex&market=$mk" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(len(d), "symbols, BTCUSDT" if "BTCUSDT" in d else "NO BTCUSDT")')"
done; done
```

預期：4 行皆數百個 symbols 且含 BTCUSDT。

- [ ] **Step 3: Commit**

```bash
git add app/api/symbols/route.ts
git commit -m "feat: Add symbols API for basis monitor combobox"
```

---

### Task 6: 新增 `/api/tickers`

**Files:**
- Create: `app/api/tickers/route.ts`

- [ ] **Step 1: 建立檔案，完整內容：**

```typescript
import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";
export const preferredRegion = ["sin1", "hkg1", "kix1"];

type Market = "perp" | "spot";

async function fetchBinanceTickers(market: Market): Promise<Record<string, number>> {
  const url =
    market === "perp"
      ? "https://fapi.binance.com/fapi/v1/ticker/price"
      : "https://api.binance.com/api/v3/ticker/price";
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) return {};
  const data = (await response.json()) as { symbol: string; price: string }[];
  const map: Record<string, number> = {};
  for (const t of data) map[t.symbol] = parseFloat(t.price);
  return map;
}

async function fetchBybitTickers(market: Market): Promise<Record<string, number>> {
  const category = market === "perp" ? "linear" : "spot";
  const url = `https://api.bybit.com/v5/market/tickers?category=${category}`;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) return {};
  const data = await response.json();
  if (data.retCode !== 0) return {};
  const map: Record<string, number> = {};
  for (const t of (data.result?.list ?? []) as { symbol: string; lastPrice: string }[]) {
    map[t.symbol] = parseFloat(t.lastPrice);
  }
  return map;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const exchange = searchParams.get("exchange");
  const market = (searchParams.get("market") ?? "perp") as Market;

  if (
    (exchange !== "Binance" && exchange !== "Bybit") ||
    (market !== "perp" && market !== "spot")
  ) {
    return NextResponse.json({ error: "Invalid exchange/market" }, { status: 400 });
  }

  try {
    const tickers =
      exchange === "Binance" ? await fetchBinanceTickers(market) : await fetchBybitTickers(market);
    return NextResponse.json(tickers);
  } catch (e) {
    console.error(`[tickers] ${exchange}/${market} error:`, e);
    return NextResponse.json({}, { status: 200 });
  }
}
```

- [ ] **Step 2: curl 驗證**

```bash
curl -s 'http://localhost:3000/api/tickers?exchange=Binance&market=spot' | python3 -c 'import json,sys; d=json.load(sys.stdin); print(len(d), d.get("BTCUSDT"))'
curl -s 'http://localhost:3000/api/tickers?exchange=Bybit&market=perp' | python3 -c 'import json,sys; d=json.load(sys.stdin); print(len(d), d.get("BTCUSDT"))'
```

預期：各數百個 symbols，BTCUSDT 有合理價格（非 None）。

- [ ] **Step 3: Commit**

```bash
git add app/api/tickers/route.ts
git commit -m "feat: Add tickers API for basis snapshot"
```

---

### Task 7: 安裝 shadcn `command` 元件

**Files:**
- Create: `components/ui/command.tsx`（shadcn CLI 產生）
- Modify: `package.json`, `pnpm-lock.yaml`（新增 cmdk 依賴）

- [ ] **Step 1: 安裝**

Run: `npx shadcn@latest add command`
預期：`components/ui/command.tsx` 出現，`package.json` dependencies 多了 `cmdk`。

- [ ] **Step 2: 確認編譯**

Run: `npx tsc --noEmit`
預期：無新增錯誤。

- [ ] **Step 3: Commit**

```bash
git add components/ui/command.tsx package.json pnpm-lock.yaml
git commit -m "chore: Add shadcn command component for combobox"
```

---

### Task 8: `SymbolCombobox` 與 `LegSelector` 元件

**Files:**
- Create: `components/basis-monitor/symbol-combobox.tsx`
- Create: `components/basis-monitor/leg-selector.tsx`

- [ ] **Step 1: 建立 `components/basis-monitor/symbol-combobox.tsx`，完整內容：**

```typescript
"use client";

import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

interface SymbolComboboxProps {
  symbols: string[];
  value: string;
  onChange: (symbol: string) => void;
  loading?: boolean;
}

export function SymbolCombobox({ symbols, value, onChange, loading }: SymbolComboboxProps) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-[180px] justify-between font-mono"
          disabled={loading}
        >
          {loading ? "載入中…" : value || "選擇 symbol"}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[220px] p-0">
        <Command>
          <CommandInput placeholder="搜尋 symbol…" />
          <CommandList className="max-h-64">
            <CommandEmpty>找不到 symbol</CommandEmpty>
            <CommandGroup>
              {symbols.map((symbol) => (
                {/* cmdk 的 onSelect 參數會被轉小寫，必須用 closure 的 symbol */}
                <CommandItem
                  key={symbol}
                  value={symbol}
                  onSelect={() => {
                    onChange(symbol);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn("mr-2 h-4 w-4", value === symbol ? "opacity-100" : "opacity-0")}
                  />
                  {symbol}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 2: 建立 `components/basis-monitor/leg-selector.tsx`，完整內容：**

```typescript
"use client";

import { useEffect, useState } from "react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SymbolCombobox } from "./symbol-combobox";
import { BASIS_EXCHANGES, MARKETS, type BasisExchange, type BasisLeg, type Market } from "@/lib/basis";

// module-level cache：同一組 exchange+market 的 symbol 清單只抓一次
const symbolCache = new Map<string, string[]>();

interface LegSelectorProps {
  label: string;
  value: BasisLeg;
  onChange: (leg: BasisLeg) => void;
}

export function LegSelector({ label, value, onChange }: LegSelectorProps) {
  const [symbols, setSymbols] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const cacheKey = `${value.exchange}|${value.market}`;

  useEffect(() => {
    let cancelled = false;
    const cached = symbolCache.get(cacheKey);
    if (cached) {
      setSymbols(cached);
      return;
    }
    setLoading(true);
    fetch(`/api/symbols?exchange=${value.exchange}&market=${value.market}`)
      .then((res) => (res.ok ? res.json() : []))
      .then((list: string[]) => {
        symbolCache.set(cacheKey, list);
        if (!cancelled) setSymbols(list);
      })
      .catch(() => {
        if (!cancelled) setSymbols([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [cacheKey, value.exchange, value.market]);

  return (
    <div className="flex flex-col gap-2">
      <Label className="text-muted-foreground">{label}</Label>
      <div className="flex flex-wrap gap-2">
        <Select
          value={value.exchange}
          onValueChange={(v) => onChange({ ...value, exchange: v as BasisExchange, symbol: "" })}
        >
          <SelectTrigger className="w-[120px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {BASIS_EXCHANGES.map((ex) => (
              <SelectItem key={ex} value={ex}>
                {ex}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={value.market}
          onValueChange={(v) => onChange({ ...value, market: v as Market, symbol: "" })}
        >
          <SelectTrigger className="w-[100px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MARKETS.map((mk) => (
              <SelectItem key={mk} value={mk}>
                {mk}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <SymbolCombobox
          symbols={symbols}
          value={value.symbol}
          loading={loading}
          onChange={(symbol) => onChange({ ...value, symbol })}
        />
      </div>
    </div>
  );
}
```

注意：換交易所或市場時 `symbol` 重設為 `""`（原 symbol 未必存在於新市場）。

- [ ] **Step 3: 型別檢查**

Run: `npx tsc --noEmit`
預期：無新增錯誤。

- [ ] **Step 4: Commit**

```bash
git add components/basis-monitor/symbol-combobox.tsx components/basis-monitor/leg-selector.tsx
git commit -m "feat: Add leg selector and symbol combobox for basis monitor"
```

---

### Task 9: `BasisChart` 元件

**Files:**
- Create: `components/basis-monitor/basis-chart.tsx`

- [ ] **Step 1: 建立檔案，完整內容：**

```typescript
"use client";

import { CartesianGrid, Line, LineChart, ReferenceLine, XAxis, YAxis } from "recharts";
import { format } from "date-fns";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import type { BasisPoint } from "@/lib/basis";

const chartConfig = {
  basis: {
    label: "Basis",
    color: "hsl(var(--chart-1))",
  },
} satisfies ChartConfig;

interface BasisChartProps {
  points: BasisPoint[];
  mode: "pct" | "abs";
  title: string;
}

export function BasisChart({ points, mode, title }: BasisChartProps) {
  const data = points.map((p) => ({
    time: p.time,
    basis: mode === "pct" ? p.basisPct : p.basisAbs,
  }));
  const current = data.length > 0 ? data[data.length - 1].basis : null;
  const fmt = (v: number) => (mode === "pct" ? `${v.toFixed(3)}%` : v.toFixed(4));

  return (
    <Card>
      <CardHeader className="flex flex-col items-stretch border-b p-0 sm:flex-row">
        <div className="flex flex-1 flex-col justify-center gap-1 px-6 py-5 sm:py-6">
          <CardTitle className="font-mono text-base">{title}</CardTitle>
          <CardDescription>
            {mode === "pct" ? "Basis %（(leg1 − leg2) / leg2）" : "價差（leg1 − leg2，USDT）"}
          </CardDescription>
        </div>
        <div className="flex">
          <div className="flex flex-1 flex-col justify-center gap-1 border-t px-6 py-4 text-left sm:border-t-0 sm:border-l sm:px-8 sm:py-6">
            <span className="text-xs text-muted-foreground">目前 Basis</span>
            <span
              className={
                "text-lg font-bold leading-none sm:text-2xl " +
                (current !== null && current >= 0
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-red-600 dark:text-red-400")
              }
            >
              {current !== null ? fmt(current) : "—"}
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-2 sm:p-6">
        <ChartContainer config={chartConfig} className="aspect-auto h-[250px] w-full sm:h-[320px]">
          <LineChart accessibilityLayer data={data} margin={{ left: 12, right: 12 }}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="time"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={48}
              tickFormatter={(value) => format(new Date(value), "MM/dd HH:mm")}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={76}
              domain={["auto", "auto"]}
              tickFormatter={(value) => fmt(Number(value))}
            />
            <ReferenceLine y={0} strokeDasharray="3 3" stroke="hsl(var(--muted-foreground))" />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  labelFormatter={(value) => format(new Date(Number(value)), "MM/dd HH:mm")}
                  formatter={(value) => fmt(Number(value))}
                />
              }
            />
            <Line
              dataKey="basis"
              type="monotone"
              stroke="var(--color-basis)"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
```

實作時注意：`ChartTooltipContent` 的 `labelFormatter`/`formatter` props 簽名以 `components/ui/chart.tsx` 實際定義為準——若簽名不符（shadcn chart 的 labelFormatter 第一參數可能是 ReactNode），改成先 Read `components/ui/chart.tsx` 再對齊；最低要求是 tooltip 顯示格式化後的 basis 值與時間。

- [ ] **Step 2: 型別檢查**

Run: `npx tsc --noEmit`
預期：無新增錯誤。

- [ ] **Step 3: Commit**

```bash
git add components/basis-monitor/basis-chart.tsx
git commit -m "feat: Add basis chart component"
```

---

### Task 10: `SavedPairsList` 元件

**Files:**
- Create: `components/basis-monitor/saved-pairs-list.tsx`

- [ ] **Step 1: 建立檔案，完整內容：**

```typescript
"use client";

import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { BasisPair } from "@/lib/types/database";
import { cn } from "@/lib/utils";

interface SavedPairsListProps {
  pairs: BasisPair[];
  // key: `${exchange}|${market}` → { symbol: lastPrice }
  tickers: Record<string, Record<string, number>>;
  onSelect: (pair: BasisPair) => void;
  onDelete: (id: string) => void;
}

function snapshot(
  pair: BasisPair,
  tickers: SavedPairsListProps["tickers"]
): { pct: number; abs: number } | null {
  const p1 = tickers[`${pair.leg1_exchange}|${pair.leg1_market}`]?.[pair.leg1_symbol];
  const p2 = tickers[`${pair.leg2_exchange}|${pair.leg2_market}`]?.[pair.leg2_symbol];
  if (p1 === undefined || p2 === undefined || p2 === 0) return null;
  return { pct: ((p1 - p2) / p2) * 100, abs: p1 - p2 };
}

export function SavedPairsList({ pairs, tickers, onSelect, onDelete }: SavedPairsListProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Monitor 清單</CardTitle>
      </CardHeader>
      <CardContent>
        {pairs.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">
            尚未儲存任何 pair。選好兩隻腳後按「加入 Monitor」。
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Leg 1</TableHead>
                <TableHead>Leg 2</TableHead>
                <TableHead className="text-right">Basis %</TableHead>
                <TableHead className="text-right">價差 (USDT)</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {pairs.map((pair) => {
                const snap = snapshot(pair, tickers);
                return (
                  <TableRow
                    key={pair.id}
                    className="cursor-pointer"
                    onClick={() => onSelect(pair)}
                  >
                    <TableCell className="font-mono">
                      {pair.leg1_symbol}
                      <span className="ml-2 text-xs text-muted-foreground">
                        {pair.leg1_exchange} {pair.leg1_market}
                      </span>
                    </TableCell>
                    <TableCell className="font-mono">
                      {pair.leg2_symbol}
                      <span className="ml-2 text-xs text-muted-foreground">
                        {pair.leg2_exchange} {pair.leg2_market}
                      </span>
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-right font-mono",
                        snap !== null &&
                          (snap.pct >= 0
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-red-600 dark:text-red-400")
                      )}
                    >
                      {snap !== null ? `${snap.pct.toFixed(3)}%` : "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {snap !== null ? snap.abs.toFixed(4) : "—"}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-red-500"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDelete(pair.id);
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: 型別檢查**

Run: `npx tsc --noEmit`
預期：無新增錯誤。

- [ ] **Step 3: Commit**

```bash
git add components/basis-monitor/saved-pairs-list.tsx
git commit -m "feat: Add saved pairs list with live basis snapshot"
```

---

### Task 11: 主元件、頁面與側邊欄

**Files:**
- Create: `components/basis-monitor/basis-monitor-content.tsx`
- Create: `app/(dashboard)/basis-monitor/page.tsx`
- Modify: `components/layout/sidebar.tsx`（navItems + icon import）

- [ ] **Step 1: 建立 `components/basis-monitor/basis-monitor-content.tsx`，完整內容：**

```typescript
"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LegSelector } from "./leg-selector";
import { BasisChart } from "./basis-chart";
import { SavedPairsList } from "./saved-pairs-list";
import {
  computeBasisSeries,
  legLabel,
  pairLabel,
  type BasisExchange,
  type BasisLeg,
  type BasisPoint,
  type Market,
} from "@/lib/basis";
import { getKlineConfig } from "@/lib/kline-config";
import type { BasisPair } from "@/lib/types/database";

const RANGES = [
  { days: 1, label: "1D" },
  { days: 7, label: "7D" },
  { days: 30, label: "30D" },
] as const;

interface BasisMonitorContentProps {
  initialPairs: BasisPair[];
}

export function BasisMonitorContent({ initialPairs }: BasisMonitorContentProps) {
  const [leg1, setLeg1] = useState<BasisLeg>({ exchange: "Binance", market: "perp", symbol: "" });
  const [leg2, setLeg2] = useState<BasisLeg>({ exchange: "Bybit", market: "perp", symbol: "" });
  const [days, setDays] = useState<number>(7);
  const [mode, setMode] = useState<"pct" | "abs">("pct");
  const [points, setPoints] = useState<BasisPoint[]>([]);
  const [chartLoading, setChartLoading] = useState(false);
  const [chartError, setChartError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pairs, setPairs] = useState<BasisPair[]>(initialPairs);
  const [tickers, setTickers] = useState<Record<string, Record<string, number>>>({});

  const ready = leg1.symbol !== "" && leg2.symbol !== "";

  // 兩腳選齊（或改時間範圍）就重拉 K 線
  const loadChart = useCallback(async () => {
    if (!ready) return;
    setChartLoading(true);
    setChartError(null);
    try {
      const fetchLeg = async (leg: BasisLeg): Promise<[number, number][]> => {
        const res = await fetch(
          `/api/klines?exchange=${leg.exchange}&symbol=${encodeURIComponent(leg.symbol)}&days=${days}&market=${leg.market}`
        );
        if (!res.ok) throw new Error(`${legLabel(leg)} K 線載入失敗`);
        return res.json();
      };
      const [klines1, klines2] = await Promise.all([fetchLeg(leg1), fetchLeg(leg2)]);
      if (klines1.length === 0 || klines2.length === 0) {
        throw new Error("其中一腳沒有 K 線資料（symbol 可能不存在於該市場）");
      }
      const series = computeBasisSeries(klines1, klines2);
      const config = getKlineConfig(days);
      setPoints(series.slice(-config.displayKlines));
    } catch (e) {
      setPoints([]);
      setChartError(e instanceof Error ? e.message : "載入失敗");
    } finally {
      setChartLoading(false);
    }
  }, [ready, leg1, leg2, days]);

  useEffect(() => {
    loadChart();
  }, [loadChart]);

  // 清單快照：對清單涉及的每個 exchange+market 組合各拉一次 tickers
  useEffect(() => {
    const combos = new Set<string>();
    for (const p of pairs) {
      combos.add(`${p.leg1_exchange}|${p.leg1_market}`);
      combos.add(`${p.leg2_exchange}|${p.leg2_market}`);
    }
    for (const combo of combos) {
      if (tickers[combo]) continue;
      const [exchange, market] = combo.split("|");
      fetch(`/api/tickers?exchange=${exchange}&market=${market}`)
        .then((res) => (res.ok ? res.json() : {}))
        .then((map: Record<string, number>) => {
          setTickers((prev) => ({ ...prev, [combo]: map }));
        })
        .catch(() => {});
    }
    // tickers 故意不進依賴：只在 pairs 變動時補抓缺的組合
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairs]);

  const savePair = async () => {
    if (!ready) return;
    setSaving(true);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("basis_pairs")
      .insert({
        leg1_exchange: leg1.exchange,
        leg1_market: leg1.market,
        leg1_symbol: leg1.symbol,
        leg2_exchange: leg2.exchange,
        leg2_market: leg2.market,
        leg2_symbol: leg2.symbol,
      })
      .select()
      .single();
    setSaving(false);
    if (error) {
      if (error.code === "23505") {
        toast.info("這個 pair 已在清單中");
      } else {
        toast.error(`儲存失敗：${error.message}`);
      }
      return;
    }
    setPairs((prev) => [...prev, data as BasisPair]);
    toast.success("已加入 Monitor");
  };

  const deletePair = async (id: string) => {
    const supabase = createClient();
    const { error } = await supabase.from("basis_pairs").delete().eq("id", id);
    if (error) {
      toast.error(`刪除失敗：${error.message}`);
      return;
    }
    setPairs((prev) => prev.filter((p) => p.id !== id));
  };

  const selectPair = (pair: BasisPair) => {
    setLeg1({
      exchange: pair.leg1_exchange as BasisExchange,
      market: pair.leg1_market as Market,
      symbol: pair.leg1_symbol,
    });
    setLeg2({
      exchange: pair.leg2_exchange as BasisExchange,
      market: pair.leg2_market as Market,
      symbol: pair.leg2_symbol,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="flex flex-col gap-4 p-4 sm:gap-6 sm:p-6">
      <h1 className="text-2xl font-bold">Basis Monitor</h1>

      <Card>
        <CardContent className="flex flex-col gap-4 pt-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:gap-8">
            <LegSelector label="Leg 1（分子）" value={leg1} onChange={setLeg1} />
            <LegSelector label="Leg 2（分母）" value={leg2} onChange={setLeg2} />
            <Button onClick={savePair} disabled={!ready || saving}>
              {saving ? "儲存中…" : "加入 Monitor"}
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <Tabs value={String(days)} onValueChange={(v) => setDays(Number(v))}>
              <TabsList>
                {RANGES.map((r) => (
                  <TabsTrigger key={r.days} value={String(r.days)}>
                    {r.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <Tabs value={mode} onValueChange={(v) => setMode(v as "pct" | "abs")}>
              <TabsList>
                <TabsTrigger value="pct">%</TabsTrigger>
                <TabsTrigger value="abs">USDT</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </CardContent>
      </Card>

      {!ready ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            選好兩隻腳後自動載入 basis 走勢圖。
          </CardContent>
        </Card>
      ) : chartError ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-red-500">{chartError}</CardContent>
        </Card>
      ) : chartLoading && points.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            載入中…
          </CardContent>
        </Card>
      ) : (
        <BasisChart points={points} mode={mode} title={pairLabel(leg1, leg2)} />
      )}

      <SavedPairsList
        pairs={pairs}
        tickers={tickers}
        onSelect={selectPair}
        onDelete={deletePair}
      />
    </div>
  );
}
```

實作時注意：頁面外層 padding/heading 樣式以其他 dashboard 頁（如 report）實際結構為準，保持一致——若 layout 已提供 padding，移除此處重複的 `p-4 sm:p-6`。

- [ ] **Step 2: 建立 `app/(dashboard)/basis-monitor/page.tsx`，完整內容：**

```typescript
import { createClient } from "@/lib/supabase/server";
import { BasisMonitorContent } from "@/components/basis-monitor/basis-monitor-content";
import type { BasisPair } from "@/lib/types/database";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function BasisMonitorPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("basis_pairs")
    .select("*")
    .order("created_at", { ascending: true });

  return <BasisMonitorContent initialPairs={(data ?? []) as BasisPair[]} />;
}
```

（RLS 已保證只回本人的 rows，server 端不需再過濾。）

- [ ] **Step 3: 修改 `components/layout/sidebar.tsx`**

icon imports 加 `ArrowRightLeft`（lucide-react），navItems 在 Opportunity 之後插入：

```typescript
  { title: "Basis", href: "/basis-monitor", icon: ArrowRightLeft },
```

- [ ] **Step 4: Build**

Run: `pnpm build`
預期：成功，無 type error；輸出中出現 `/basis-monitor` 路由。

- [ ] **Step 5: Commit**

```bash
git add components/basis-monitor/basis-monitor-content.tsx "app/(dashboard)/basis-monitor/page.tsx" components/layout/sidebar.tsx
git commit -m "feat: Add basis monitor page with pair builder, chart and saved list"
```

---

### Task 12: 端到端驗證與收尾

**Files:**
- Modify: `.claude/WIP.md`（打勾）、最後刪除
- Modify: `docs/superpowers/specs/2026-07-11-basis-monitor-design.md`（若實作中有再偏離，同步）

- [ ] **Step 1: `pnpm build` 最終確認通過**

- [ ] **Step 2: dev server 端到端手動驗證（`pnpm dev`，瀏覽器登入後操作）**

依 spec「完成定義」逐項：

1. 側邊欄出現 Basis，點擊進入 `/basis-monitor`。
2. 跨交易所：Leg1 = Binance perp BTCUSDT、Leg2 = Bybit spot BTCUSDT → 圖表出現。
3. 切 1D / 7D / 30D，圖表重載且 X 軸範圍正確。
4. 切 % / USDT，Y 軸與目前值格式跟著變。
5. 同交易所 perp-spot：Binance perp / Binance spot 同 symbol → 圖表正常。
6. 按「加入 Monitor」→ toast 成功、清單出現該 pair 且 Basis % 快照有值。
7. 再按一次「加入 Monitor」→ toast 顯示已存在（unique constraint 生效）。
8. 重新整理頁面 → 清單仍在（DB 落地）、快照重新載入。
9. 點清單列 → 上方選擇器與圖表載入該 pair。
10. 刪除 pair → 列消失；重新整理確認 DB 已刪。
11. 錯誤路徑：直接改 URL 打 `/api/klines?exchange=Gate&symbol=BTCUSDT&market=spot` → 400。

任何一項失敗：修復後重跑該項與相鄰項。**全部通過前不得宣稱完成**（專案硬規則 2 精神）。

- [ ] **Step 3: 收尾**

```bash
git push
rm .claude/WIP.md   # WIP 全部打勾後
git add -A && git commit -m "chore: Remove WIP checklist" && git push
```

（push 授權：使用者歷次明示「build 通過後 commit 並 push」。）

---

## 已知風險與備註

- **Bybit spot kline 起始時間**：部分 spot 交易對上市時間短，30D 資料可能不足 720 根，join 後點數變少屬正常，不是 bug。
- **Binance spot exchangeInfo 體積大（~3MB）**：有 1 小時 fetch cache，edge runtime 下首次請求較慢屬正常。
- **`ChartTooltipContent` props 簽名**：以 `components/ui/chart.tsx` 實際定義為準（Task 9 已註明對齊方式）。
- **cmdk 渲染 1000+ 項目**：`CommandList` 有 max-height 且 cmdk 過濾即時，效能可接受；若實測卡頓，改為輸入 ≥1 字元才渲染清單（後續優化，不在本計畫）。
