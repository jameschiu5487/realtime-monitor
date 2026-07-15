"use client";

import { useMemo, useState } from "react";
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

// 手動過濾＋渲染上限：Alpaca 美股清單上萬檔，交給 cmdk 全量渲染會卡死
const MAX_RENDERED = 200;

interface SymbolComboboxProps {
  symbols: string[];
  value: string;
  onChange: (symbol: string) => void;
  loading?: boolean;
}

export function SymbolCombobox({ symbols, value, onChange, loading }: SymbolComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toUpperCase();
    const matched = q ? symbols.filter((s) => s.toUpperCase().includes(q)) : symbols;
    return { shown: matched.slice(0, MAX_RENDERED), truncated: matched.length - MAX_RENDERED };
  }, [symbols, query]);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
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
        <Command shouldFilter={false}>
          <CommandInput placeholder="搜尋 symbol…" value={query} onValueChange={setQuery} />
          <CommandList className="max-h-64">
            <CommandEmpty>找不到 symbol</CommandEmpty>
            <CommandGroup>
              {/* cmdk 的 onSelect 參數會被轉小寫，必須用 closure 的 symbol */}
              {filtered.shown.map((symbol) => (
                <CommandItem
                  key={symbol}
                  value={symbol}
                  onSelect={() => {
                    onChange(symbol);
                    setOpen(false);
                    setQuery("");
                  }}
                >
                  <Check
                    className={cn("mr-2 h-4 w-4", value === symbol ? "opacity-100" : "opacity-0")}
                  />
                  {symbol}
                </CommandItem>
              ))}
              {filtered.truncated > 0 && (
                <div className="px-2 py-1.5 text-xs text-muted-foreground">
                  還有 {filtered.truncated} 筆，輸入更多字元縮小範圍
                </div>
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
