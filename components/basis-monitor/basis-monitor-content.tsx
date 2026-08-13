"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { untypedWrites } from "@/lib/supabase/untyped";
import { ArrowLeftRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LegSelector } from "./leg-selector";
import { BasisChart, type PairFunding } from "./basis-chart";
import { SavedPairsList } from "./saved-pairs-list";
import {
  computeBasisSeries,
  legLabel,
  pairLabel,
  type BasisLeg,
  type BasisPoint,
  type TickerQuote,
} from "@/lib/basis";
import { getKlineConfig } from "@/lib/kline-config";
import type { BasisPair } from "@/lib/types/database";

const RANGES = [
  { days: 1, label: "1D" },
  { days: 7, label: "7D" },
  { days: 30, label: "30D" },
] as const;

// 即時輪詢間隔（ms）：每秒抓一次 ticker 現價
const LIVE_INTERVAL_MS = 1000;

// 抓某個 exchange+market 的即時價格 map（symbol -> price）。
// Alpaca 無全量端點，需帶該組合用到的 symbols；其餘交易所回全量 map。
async function fetchComboTickers(
  exchange: string,
  market: string,
  symbols: string[]
): Promise<Record<string, TickerQuote> | null> {
  // Alpaca 無全量端點，需帶該組合用到的 symbols；其餘交易所回全量 map，不需 symbols
  const url =
    exchange === "Alpaca"
      ? `/api/tickers?exchange=Alpaca&market=${market}&symbols=${encodeURIComponent(symbols.join(","))}`
      : `/api/tickers?exchange=${exchange}&market=${market}`;
  try {
    const res = await fetch(url);
    return res.ok ? ((await res.json()) as Record<string, TickerQuote>) : null;
  } catch {
    return null;
  }
}

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
  const [tickers, setTickers] = useState<Record<string, Record<string, TickerQuote>>>({});
  const [funding, setFunding] = useState<PairFunding | null>(null);
  // 每秒用 ticker 現價算出的即時 basis 點（不進 K 線序列）
  const [livePoint, setLivePoint] = useState<BasisPoint | null>(null);
  const [bbEnabled, setBbEnabled] = useState(false);
  // 輸入框用字串 state，避免 controlled number input 把空字串/中間態強制正規化成 0
  const [bbWindowInput, setBbWindowInput] = useState("240");
  const [bbWidthMode, setBbWidthMode] = useState<"std" | "abs">("std");
  const [bbWidthsInput, setBbWidthsInput] = useState("2");
  const bbWindowMin = parseFloat(bbWindowInput);

  // "1,2,3" → [1, 2, 3]；非法輸入直接濾掉
  const bbWidths = useMemo(
    () =>
      bbWidthsInput
        .split(",")
        .map((s) => parseFloat(s.trim()))
        .filter((n) => Number.isFinite(n) && n > 0),
    [bbWidthsInput]
  );
  // window 輸入單位是分鐘，依當前範圍的 K 線粒度換算成根數（至少 2 根）
  const bb = useMemo(() => {
    if (!bbEnabled || bbWidths.length === 0 || !Number.isFinite(bbWindowMin) || bbWindowMin <= 0) {
      return null;
    }
    const intervalMinutes = getKlineConfig(days).intervalMinutes;
    const window = Math.max(2, Math.round(bbWindowMin / intervalMinutes));
    return { window, windowLabel: `${bbWindowMin}m`, widthMode: bbWidthMode, widths: bbWidths };
  }, [bbEnabled, bbWindowMin, bbWidthMode, bbWidths, days]);

  const ready = leg1.symbol !== "" && leg2.symbol !== "";
  // 快速切換 leg/range 時，較晚 resolve 的舊請求不得覆蓋新資料
  const loadGeneration = useRef(0);

  // 抓取根數 = 顯示根數 + indicator warmup。warmup 依 BB window 決定，
  // 無條件進位到整天（1440m 的倍數），打字調 window 時不會每個字元都觸發重抓
  const klineLimit = useMemo(() => {
    const config = getKlineConfig(days);
    const warmupDays = bb ? Math.ceil(bbWindowMin / 1440) : 1;
    const warmupCandles = Math.round((warmupDays * 1440) / config.intervalMinutes);
    return config.displayKlines + warmupCandles;
  }, [days, bb, bbWindowMin]);

  // 兩腳選齊（或改時間範圍 / 需要更多 warmup）就重拉 K 線
  const loadChart = useCallback(async () => {
    if (!ready) return;
    const generation = ++loadGeneration.current;
    setChartLoading(true);
    setChartError(null);
    try {
      const fetchLeg = async (leg: BasisLeg): Promise<[number, number][]> => {
        const res = await fetch(
          `/api/klines?exchange=${leg.exchange}&symbol=${encodeURIComponent(leg.symbol)}&days=${days}&market=${leg.market}&limit=${klineLimit}`
        );
        if (!res.ok) throw new Error(`${legLabel(leg)} K 線載入失敗`);
        return res.json();
      };
      const [klines1, klines2] = await Promise.all([fetchLeg(leg1), fetchLeg(leg2)]);
      if (generation !== loadGeneration.current) return;
      if (klines1.length === 0 || klines2.length === 0) {
        throw new Error("其中一腳沒有 K 線資料（symbol 可能不存在於該市場）");
      }
      // 不在這裡裁切：完整序列（含 1 天 warmup）交給圖表先算 indicator 再裁切顯示
      setPoints(computeBasisSeries(klines1, klines2));
    } catch (e) {
      if (generation !== loadGeneration.current) return;
      setPoints([]);
      setChartError(e instanceof Error ? e.message : "載入失敗");
    } finally {
      if (generation === loadGeneration.current) setChartLoading(false);
    }
  }, [ready, leg1, leg2, days, klineLimit]);

  // pair 本身變了（非 days/mode 切換）就先清掉舊序列，避免舊圖掛新標題
  const pairKey = ready ? `${legLabel(leg1)}|${legLabel(leg2)}` : "";
  const prevPairKey = useRef(pairKey);
  useEffect(() => {
    if (prevPairKey.current !== pairKey) {
      prevPairKey.current = pairKey;
      setPoints([]);
    }
  }, [pairKey]);

  useEffect(() => {
    loadChart();
  }, [loadChart]);

  // funding 歷史：每條 perp 腿各打一次 funding-history（兩腿 symbol 可能不同），
  // API 的 exchangeA/exchangeB 皆必填，同一腿就重複帶同交易所、只讀 exchangeA 側
  useEffect(() => {
    if (!ready) {
      setFunding(null);
      return;
    }
    let cancelled = false;
    // 抓滿整個顯示範圍（route 端會依 startTime 往回分頁）
    const startTime = Date.now() - days * 86400_000;
    const fetchLegFunding = async (leg: BasisLeg) => {
      if (leg.market !== "perp") return null;
      try {
        const res = await fetch(
          `/api/funding-history?symbol=${encodeURIComponent(leg.symbol)}&exchangeA=${leg.exchange}&exchangeB=${leg.exchange}&startTime=${startTime}`
        );
        if (!res.ok) return null;
        const data = await res.json();
        const events = ((data.exchangeA ?? []) as { timestamp: number; rate: number }[]).map(
          (e) => ({ timestamp: e.timestamp, rateBp: e.rate * 10000 })
        );
        return { label: legLabel(leg), events };
      } catch {
        return null;
      }
    };
    Promise.all([fetchLegFunding(leg1), fetchLegFunding(leg2)]).then(([f1, f2]) => {
      if (!cancelled) setFunding(f1 || f2 ? { leg1: f1, leg2: f2 } : null);
    });
    return () => {
      cancelled = true;
    };
  }, [ready, leg1, leg2, days]);

  // 即時 basis：每秒對兩腳用到的 exchange+market 各抓一次 ticker 現價，算出當下 basis。
  // 分頁在背景 / 上一輪還沒回來就跳過（省流量、避免限流）；換 pair / 離開時清 interval。
  useEffect(() => {
    if (!ready) {
      setLivePoint(null);
      return;
    }
    // 換 pair 先清掉舊即時值，避免顯示上一組的殘留
    setLivePoint(null);
    let cancelled = false;
    let inFlight = false;
    const legs = [leg1, leg2];
    const tick = async () => {
      if (cancelled || inFlight || document.hidden) return;
      inFlight = true;
      try {
        // 兩腳可能共用同一 exchange+market，去重後各抓一次
        const combos = new Map<string, { exchange: string; market: string; symbols: Set<string> }>();
        for (const leg of legs) {
          const key = `${leg.exchange}|${leg.market}`;
          if (!combos.has(key)) {
            combos.set(key, { exchange: leg.exchange, market: leg.market, symbols: new Set() });
          }
          combos.get(key)!.symbols.add(leg.symbol);
        }
        const entries = await Promise.all(
          [...combos.entries()].map(async ([key, c]) => {
            const map = await fetchComboTickers(c.exchange, c.market, [...c.symbols]);
            return [key, map] as const;
          })
        );
        if (cancelled) return;
        const byCombo = new Map(entries);
        const priceOf = (leg: BasisLeg) =>
          byCombo.get(`${leg.exchange}|${leg.market}`)?.[leg.symbol]?.last;
        const p1 = priceOf(leg1);
        const p2 = priceOf(leg2);
        // 任一腳缺價或分母為 0 就跳過這輪，保留上一個有效值
        if (p1 === undefined || p2 === undefined || p2 === 0) return;
        setLivePoint({
          time: Date.now(),
          leg1: p1,
          leg2: p2,
          basisPct: ((p1 - p2) / p2) * 100,
          basisAbs: p1 - p2,
          fresh: true,
        });
      } finally {
        inFlight = false;
      }
    };
    tick(); // 立即抓一次，不等第一個 interval
    const id = setInterval(tick, LIVE_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [ready, leg1, leg2]);

  // 清單即時報價：每秒對清單涉及的每個 exchange+market 組合各拉一次 tickers。
  // 交易所回全量 map；Alpaca 沒有全量端點，要帶該組合實際用到的 symbols。
  // 分頁在背景 / 上一輪未回就跳過；pairs 變動時重建 interval。
  useEffect(() => {
    if (pairs.length === 0) return;
    const comboSymbols = new Map<string, Set<string>>();
    const add = (exchange: string, market: string, symbol: string) => {
      // Hyperliquid 清單報價改走 websocket（見下方 effect），不進 REST 輪詢，省 /info 限流
      if (exchange === "Hyperliquid") return;
      const combo = `${exchange}|${market}`;
      if (!comboSymbols.has(combo)) comboSymbols.set(combo, new Set());
      comboSymbols.get(combo)!.add(symbol);
    };
    for (const p of pairs) {
      add(p.leg1_exchange, p.leg1_market, p.leg1_symbol);
      add(p.leg2_exchange, p.leg2_market, p.leg2_symbol);
    }
    let cancelled = false;
    let inFlight = false;
    const refresh = async () => {
      if (cancelled || inFlight || document.hidden) return;
      inFlight = true;
      try {
        await Promise.all(
          [...comboSymbols.entries()].map(async ([combo, symbols]) => {
            const [exchange, market] = combo.split("|");
            const map = await fetchComboTickers(exchange, market, [...symbols]);
            // 失敗不落 cache，下一輪會重試；成功則與既有 map 合併
            if (map && !cancelled) {
              setTickers((prev) => ({ ...prev, [combo]: { ...(prev[combo] ?? {}), ...map } }));
            }
          })
        );
      } finally {
        inFlight = false;
      }
    };
    refresh(); // 立即抓一次
    const id = setInterval(refresh, LIVE_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [pairs]);

  // 清單裡的 Hyperliquid coins（排序後 join，作為 ws effect 的穩定依賴；
  // 只在 HL 標的集合真的變動時才重連，加減其他交易所的 pair 不會重連）
  const hlCoinsKey = useMemo(() => {
    const set = new Set<string>();
    for (const p of pairs) {
      if (p.leg1_exchange === "Hyperliquid") set.add(p.leg1_symbol);
      if (p.leg2_exchange === "Hyperliquid") set.add(p.leg2_symbol);
    }
    return [...set].sort().join(",");
  }, [pairs]);

  // Hyperliquid 清單報價走 websocket（public，免金鑰）：對每個 HL coin 訂閱 l2Book，
  // 推送最佳買賣一檔（a1/b1），並以中價 (b1+a1)/2 當 last。取代每秒 REST 輪詢，
  // 徹底避免 /info 限流（也讓點 pair 的 candleSnapshot 不再跟輪詢搶額度）。
  useEffect(() => {
    if (!hlCoinsKey) return;
    const coins = hlCoinsKey.split(",");
    const HL_COMBO = "Hyperliquid|perp";
    let ws: WebSocket | null = null;
    let closed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let pingTimer: ReturnType<typeof setInterval> | null = null;

    const connect = () => {
      if (closed) return;
      ws = new WebSocket("wss://api.hyperliquid.xyz/ws");
      ws.onopen = () => {
        for (const coin of coins) {
          ws!.send(JSON.stringify({ method: "subscribe", subscription: { type: "l2Book", coin } }));
        }
        // 心跳，避免閒置被斷線
        pingTimer = setInterval(() => {
          if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ method: "ping" }));
        }, 30_000);
      };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data as string);
          if (msg.channel !== "l2Book" || !msg.data) return;
          const { coin, levels } = msg.data as {
            coin: string;
            levels: [{ px: string }[], { px: string }[]];
          };
          const bid = levels?.[0]?.[0] ? parseFloat(levels[0][0].px) : undefined;
          const ask = levels?.[1]?.[0] ? parseFloat(levels[1][0].px) : undefined;
          const last =
            bid !== undefined && ask !== undefined ? (bid + ask) / 2 : bid ?? ask;
          if (last === undefined) return;
          setTickers((prev) => ({
            ...prev,
            [HL_COMBO]: { ...(prev[HL_COMBO] ?? {}), [coin]: { last, bid, ask } },
          }));
        } catch {
          /* 忽略非 JSON / 未預期訊息 */
        }
      };
      ws.onclose = () => {
        if (pingTimer) {
          clearInterval(pingTimer);
          pingTimer = null;
        }
        if (!closed) reconnectTimer = setTimeout(connect, 2000); // 斷線退避重連
      };
      ws.onerror = () => ws?.close();
    };
    connect();

    return () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (pingTimer) clearInterval(pingTimer);
      ws?.close();
    };
  }, [hlCoinsKey]);

  const savePair = async () => {
    if (!ready) return;
    setSaving(true);
    try {
      const supabase = createClient();
      const { data, error } = await untypedWrites(supabase)
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
    } catch (e) {
      toast.error(`儲存失敗：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const deletePair = async (id: string) => {
    try {
      const supabase = createClient();
      const { error } = await supabase.from("basis_pairs").delete().eq("id", id);
      if (error) {
        toast.error(`刪除失敗：${error.message}`);
        return;
      }
      setPairs((prev) => prev.filter((p) => p.id !== id));
    } catch (e) {
      toast.error(`刪除失敗：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const selectPair = (pair: BasisPair) => {
    setLeg1({
      exchange: pair.leg1_exchange,
      market: pair.leg1_market,
      symbol: pair.leg1_symbol,
    });
    setLeg2({
      exchange: pair.leg2_exchange,
      market: pair.leg2_market,
      symbol: pair.leg2_symbol,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // 整組對調兩隻腳（basis =(leg1−leg2)/leg2 方向隨之反轉）
  const swapLegs = () => {
    setLeg1(leg2);
    setLeg2(leg1);
  };

  return (
    <div className="flex flex-col gap-4 sm:gap-6">
      <h1 className="text-2xl font-bold">Basis Monitor</h1>

      <Card>
        <CardContent className="flex flex-col gap-4 pt-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:gap-8">
            <LegSelector label="Leg 1（分子）" value={leg1} onChange={setLeg1} />
            <Button
              variant="outline"
              size="icon"
              onClick={swapLegs}
              title="對調 Leg 1／Leg 2"
              aria-label="對調 Leg 1／Leg 2"
              className="self-center lg:mb-0.5 lg:self-end"
            >
              <ArrowLeftRight className="h-4 w-4" />
            </Button>
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
                <TabsTrigger value="pct">bp</TabsTrigger>
                <TabsTrigger value="abs">USDT</TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="flex items-center gap-2">
              <Switch id="bb-switch" checked={bbEnabled} onCheckedChange={setBbEnabled} />
              <Label htmlFor="bb-switch">BB</Label>
              {bbEnabled && (
                <>
                  <Label htmlFor="bb-window" className="text-xs text-muted-foreground">
                    window (m)
                  </Label>
                  <Input
                    id="bb-window"
                    type="number"
                    min={1}
                    step={30}
                    value={bbWindowInput}
                    onChange={(e) => setBbWindowInput(e.target.value)}
                    className="h-8 w-24"
                  />
                  <Tabs
                    value={bbWidthMode}
                    onValueChange={(v) => setBbWidthMode(v as "std" | "abs")}
                  >
                    <TabsList className="h-8">
                      <TabsTrigger value="std" className="text-xs">
                        σ
                      </TabsTrigger>
                      <TabsTrigger value="abs" className="text-xs">
                        {mode === "pct" ? "bp" : "USDT"}
                      </TabsTrigger>
                    </TabsList>
                  </Tabs>
                  <Input
                    id="bb-widths"
                    value={bbWidthsInput}
                    onChange={(e) => setBbWidthsInput(e.target.value)}
                    placeholder={bbWidthMode === "std" ? "1,2,3" : "5,10"}
                    className="h-8 w-24"
                  />
                </>
              )}
            </div>
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
        <BasisChart
          points={points}
          mode={mode}
          title={pairLabel(leg1, leg2)}
          bb={bb}
          displayCount={getKlineConfig(days).displayKlines}
          funding={funding}
          legLabels={{ leg1: legLabel(leg1), leg2: legLabel(leg2) }}
          livePoint={livePoint}
        />
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
