"use client";

import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Search, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CombinedFundingRate, Exchange, FundingSnapshot } from "@/lib/types/opportunity";

interface FundingRatesTableProps {
  fundingRates: CombinedFundingRate[];
  selectedExchanges: Exchange[];
}

type SortKey = 'symbol' | 'binance' | 'bybit' | 'bingx' | 'gate' | 'bitget' | 'zoomex' | 'bitmart' | 'spread';
type SortDirection = 'asc' | 'desc';

const EXCHANGE_KEYS: { key: keyof CombinedFundingRate; exchange: Exchange }[] = [
  { key: 'binance', exchange: 'Binance' },
  { key: 'bybit', exchange: 'Bybit' },
  { key: 'bingx', exchange: 'BingX' },
  { key: 'gate', exchange: 'Gate' },
  { key: 'bitget', exchange: 'Bitget' },
  { key: 'zoomex', exchange: 'Zoomex' },
  { key: 'bitmart', exchange: 'BitMart' },
];

export function FundingRatesTable({ fundingRates, selectedExchanges }: FundingRatesTableProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('spread');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDirection('desc');
    }
  };

  const visibleExchanges = EXCHANGE_KEYS.filter(e => selectedExchanges.includes(e.exchange));

  // Calculate spread for each symbol
  const ratesWithSpread = useMemo(() => {
    return fundingRates.map(rate => {
      const rates: number[] = [];
      visibleExchanges.forEach(({ key }) => {
        const snapshot = rate[key] as FundingSnapshot | null;
        if (snapshot) {
          rates.push(snapshot.funding_rate * 10000); // Convert to bps
        }
      });

      const spread = rates.length >= 2
        ? Math.max(...rates) - Math.min(...rates)
        : 0;

      return { ...rate, spread };
    });
  }, [fundingRates, visibleExchanges]);

  const filteredAndSortedRates = useMemo(() => {
    let filtered = ratesWithSpread;

    // Filter by search query
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(rate => rate.symbol.toLowerCase().includes(query));
    }

    // Sort
    return [...filtered].sort((a, b) => {
      let aVal: number | string = 0;
      let bVal: number | string = 0;

      if (sortKey === 'symbol') {
        aVal = a.symbol;
        bVal = b.symbol;
      } else if (sortKey === 'spread') {
        aVal = a.spread;
        bVal = b.spread;
      } else {
        const aSnapshot = a[sortKey as keyof CombinedFundingRate] as FundingSnapshot | null;
        const bSnapshot = b[sortKey as keyof CombinedFundingRate] as FundingSnapshot | null;
        aVal = aSnapshot?.funding_rate ?? -Infinity;
        bVal = bSnapshot?.funding_rate ?? -Infinity;
      }

      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortDirection === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }

      return sortDirection === 'asc' ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number);
    });
  }, [ratesWithSpread, searchQuery, sortKey, sortDirection]);

  const formatRate = (snapshot: FundingSnapshot | null) => {
    if (!snapshot) return { rate: '-', interval: '-', color: 'text-muted-foreground' };

    const rateBps = snapshot.funding_rate * 10000;
    const color = rateBps > 0 ? 'text-green-500' : rateBps < 0 ? 'text-red-500' : 'text-muted-foreground';

    return {
      rate: `${rateBps >= 0 ? '+' : ''}${rateBps.toFixed(2)}`,
      interval: `${snapshot.funding_interval_hours}h`,
      color,
    };
  };

  const SortableHeader = ({ label, sortKeyVal }: { label: string; sortKeyVal: SortKey }) => {
    const isActive = sortKey === sortKeyVal;
    return (
      <TableHead
        className="cursor-pointer hover:text-foreground whitespace-nowrap"
        onClick={() => handleSort(sortKeyVal)}
      >
        <span className="flex items-center gap-1">
          {label}
          {isActive ? (
            sortDirection === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
          ) : (
            <ArrowUpDown className="h-3 w-3 opacity-50" />
          )}
        </span>
      </TableHead>
    );
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>Funding Rates ({filteredAndSortedRates.length} symbols)</CardTitle>
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search symbol..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8"
            />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <SortableHeader label="Symbol" sortKeyVal="symbol" />
                {visibleExchanges.map(({ key, exchange }) => (
                  <SortableHeader key={key} label={exchange} sortKeyVal={key as SortKey} />
                ))}
                <SortableHeader label="Spread (bps)" sortKeyVal="spread" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredAndSortedRates.map((rate) => (
                <TableRow key={rate.symbol}>
                  <TableCell className="font-medium">{rate.symbol}</TableCell>
                  {visibleExchanges.map(({ key }) => {
                    const snapshot = rate[key] as FundingSnapshot | null;
                    const { rate: rateStr, interval, color } = formatRate(snapshot);
                    return (
                      <TableCell key={key}>
                        <div className={cn("font-mono text-sm", color)}>{rateStr}</div>
                        <div className="text-xs text-muted-foreground">{interval}</div>
                      </TableCell>
                    );
                  })}
                  <TableCell>
                    <span className={cn(
                      "font-medium",
                      rate.spread > 5 ? "text-green-500" :
                      rate.spread > 3 ? "text-yellow-500" :
                      "text-muted-foreground"
                    )}>
                      {rate.spread.toFixed(2)}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {filteredAndSortedRates.length === 0 && (
            <div className="py-8 text-center text-muted-foreground">
              {searchQuery ? 'No symbols found matching your search' : 'No funding rate data available'}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
