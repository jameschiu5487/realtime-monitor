"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LegSelector } from "./leg-selector";
import { BasisChart } from "./basis-chart";
import { SavedPairsList } from "./saved-pairs-list";
import {
  computeBasisSeries,
  legLabel,
  pairLabel,
  type BasisLeg,
  type BasisPoint,
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
  const [bbEnabled, setBbEnabled] = useState(false);
  const [bbWindow, setBbWindow] = useState(20);
  const [bbStdsInput, setBbStdsInput] = useState("2");

  // "1,2,3" → [1, 2, 3]；非法輸入直接濾掉
  const bbStds = useMemo(
    () =>
      bbStdsInput
        .split(",")
        .map((s) => parseFloat(s.trim()))
        .filter((n) => Number.isFinite(n) && n > 0),
    [bbStdsInput]
  );
  const bb = useMemo(
    () => (bbEnabled && bbWindow >= 2 && bbStds.length > 0 ? { window: bbWindow, stds: bbStds } : null),
    [bbEnabled, bbWindow, bbStds]
  );

  const ready = leg1.symbol !== "" && leg2.symbol !== "";
  // 快速切換 leg/range 時，較晚 resolve 的舊請求不得覆蓋新資料
  const loadGeneration = useRef(0);

  // 兩腳選齊（或改時間範圍）就重拉 K 線
  const loadChart = useCallback(async () => {
    if (!ready) return;
    const generation = ++loadGeneration.current;
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
      if (generation !== loadGeneration.current) return;
      if (klines1.length === 0 || klines2.length === 0) {
        throw new Error("其中一腳沒有 K 線資料（symbol 可能不存在於該市場）");
      }
      const series = computeBasisSeries(klines1, klines2);
      const config = getKlineConfig(days);
      setPoints(series.slice(-config.displayKlines));
    } catch (e) {
      if (generation !== loadGeneration.current) return;
      setPoints([]);
      setChartError(e instanceof Error ? e.message : "載入失敗");
    } finally {
      if (generation === loadGeneration.current) setChartLoading(false);
    }
  }, [ready, leg1, leg2, days]);

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
        .then((res) => (res.ok ? res.json() : null))
        .then((map: Record<string, number> | null) => {
          // 失敗不落 cache，pairs 下次變動時會重試
          if (map) setTickers((prev) => ({ ...prev, [combo]: map }));
        })
        .catch(() => {});
    }
    // tickers 故意不進依賴：只在 pairs 變動時補抓缺的組合
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairs]);

  const savePair = async () => {
    if (!ready) return;
    setSaving(true);
    try {
      const supabase = createClient();
      const { data, error } = await (supabase as any)
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
      const { error } = await (supabase as any).from("basis_pairs").delete().eq("id", id);
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

  return (
    <div className="flex flex-col gap-4 sm:gap-6">
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
                    window
                  </Label>
                  <Input
                    id="bb-window"
                    type="number"
                    min={2}
                    value={bbWindow}
                    onChange={(e) => setBbWindow(Number(e.target.value))}
                    className="h-8 w-20"
                  />
                  <Label htmlFor="bb-stds" className="text-xs text-muted-foreground">
                    σ
                  </Label>
                  <Input
                    id="bb-stds"
                    value={bbStdsInput}
                    onChange={(e) => setBbStdsInput(e.target.value)}
                    placeholder="1,2,3"
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
        <BasisChart points={points} mode={mode} title={pairLabel(leg1, leg2)} bb={bb} />
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
