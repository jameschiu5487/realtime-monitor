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
  if (p1 === undefined || p2 === undefined || !Number.isFinite(p1) || !Number.isFinite(p2) || p2 === 0) return null;
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
                <TableHead className="text-right">Basis (bp)</TableHead>
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
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
