"use client";

import { Fragment, useMemo } from "react";
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
import type { TickerQuote } from "@/lib/basis";
import { cn } from "@/lib/utils";

// key: `${exchange}|${market}` → { symbol: TickerQuote }
type TickerMap = Record<string, Record<string, TickerQuote>>;

interface SavedPairsListProps {
  pairs: BasisPair[];
  tickers: TickerMap;
  onSelect: (pair: BasisPair) => void;
  onDelete: (id: string) => void;
}

function quoteOf(
  exchange: string,
  market: string,
  symbol: string,
  tickers: TickerMap
): TickerQuote | undefined {
  return tickers[`${exchange}|${market}`]?.[symbol];
}

// 依價位大小決定小數位（BTC 級用 2 位、個位數用 4 位、更小用 6 位）
function formatPrice(v: number | undefined): string {
  if (v === undefined || !Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  const decimals = abs >= 100 ? 2 : abs >= 1 ? 4 : 6;
  return v.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function snapshot(pair: BasisPair, tickers: TickerMap): { pct: number; abs: number } | null {
  const p1 = quoteOf(pair.leg1_exchange, pair.leg1_market, pair.leg1_symbol, tickers)?.last;
  const p2 = quoteOf(pair.leg2_exchange, pair.leg2_market, pair.leg2_symbol, tickers)?.last;
  if (p1 === undefined || p2 === undefined || !Number.isFinite(p1) || !Number.isFinite(p2) || p2 === 0)
    return null;
  return { pct: ((p1 - p2) / p2) * 100, abs: p1 - p2 };
}

export function SavedPairsList({ pairs, tickers, onSelect, onDelete }: SavedPairsListProps) {
  // 依 leg1（交易所＋市場＋標的）分組，同一 leg1 的 pair 收在一個區塊
  const groups = useMemo(() => {
    const map = new Map<
      string,
      { key: string; exchange: string; market: string; symbol: string; pairs: BasisPair[] }
    >();
    for (const p of pairs) {
      const key = `${p.leg1_exchange}|${p.leg1_market}|${p.leg1_symbol}`;
      let g = map.get(key);
      if (!g) {
        g = { key, exchange: p.leg1_exchange, market: p.leg1_market, symbol: p.leg1_symbol, pairs: [] };
        map.set(key, g);
      }
      g.pairs.push(p);
    }
    return [...map.values()].sort(
      (a, b) => a.symbol.localeCompare(b.symbol) || a.exchange.localeCompare(b.exchange)
    );
  }, [pairs]);

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
                <TableHead>標的</TableHead>
                <TableHead className="text-right">a1 (ask)</TableHead>
                <TableHead className="text-right">b1 (bid)</TableHead>
                <TableHead className="text-right">Basis (bp)</TableHead>
                <TableHead className="text-right">價差 (USDT)</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map((group) => {
                const legQuote = quoteOf(group.exchange, group.market, group.symbol, tickers);
                return (
                  <Fragment key={group.key}>
                    <TableRow className="bg-muted/50 hover:bg-muted/50">
                      <TableCell className="font-mono text-sm font-medium">
                        {group.symbol}
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                          {group.exchange} {group.market}
                        </span>
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                          · {group.pairs.length} 組
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {formatPrice(legQuote?.ask)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {formatPrice(legQuote?.bid)}
                      </TableCell>
                      <TableCell />
                      <TableCell />
                      <TableCell />
                    </TableRow>
                    {group.pairs.map((pair) => {
                      const snap = snapshot(pair, tickers);
                      const leg2Quote = quoteOf(
                        pair.leg2_exchange,
                        pair.leg2_market,
                        pair.leg2_symbol,
                        tickers
                      );
                      return (
                        <TableRow
                          key={pair.id}
                          className="cursor-pointer"
                          onClick={() => onSelect(pair)}
                        >
                          <TableCell className="pl-8 font-mono">
                            <span className="text-xs text-muted-foreground">↳</span> {pair.leg2_symbol}
                            <span className="ml-2 text-xs text-muted-foreground">
                              {pair.leg2_exchange} {pair.leg2_market}
                            </span>
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs">
                            {formatPrice(leg2Quote?.ask)}
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs">
                            {formatPrice(leg2Quote?.bid)}
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
                            {snap !== null ? `${(snap.pct * 100).toFixed(1)} bp` : "—"}
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
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
