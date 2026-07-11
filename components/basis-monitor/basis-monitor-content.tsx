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
    const { error } = await (supabase as any).from("basis_pairs").delete().eq("id", id);
    if (error) {
      toast.error(`刪除失敗：${error.message}`);
      return;
    }
    setPairs((prev) => prev.filter((p) => p.id !== id));
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
