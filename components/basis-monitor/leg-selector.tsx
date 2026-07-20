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
      // 前一組合的 fetch 可能仍在途中（其 finally 被 cancelled guard 擋掉），這裡要清 loading
      setLoading(false);
      return;
    }
    setLoading(true);
    fetch(`/api/symbols?exchange=${value.exchange}&market=${value.market}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`symbols ${res.status}`))))
      .then((list: string[]) => {
        // 只快取成功結果，失敗留給下次進入時重試
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
          onValueChange={(v) =>
            onChange({
              exchange: v as BasisExchange,
              // Alpaca（美股）只有現貨；Hyperliquid 只有永續
              market: v === "Alpaca" ? "spot" : v === "Hyperliquid" ? "perp" : value.market,
              symbol: "",
            })
          }
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
          disabled={value.exchange === "Alpaca" || value.exchange === "Hyperliquid"}
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
