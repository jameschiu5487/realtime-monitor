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
              {/* cmdk 的 onSelect 參數會被轉小寫，必須用 closure 的 symbol */}
              {symbols.map((symbol) => (
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
