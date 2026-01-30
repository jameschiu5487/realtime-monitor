"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import type { Trade } from "@/lib/types/database";

interface TradesTableProps {
  trades: Trade[];
}

function formatDateTime(dateString: string) {
  const date = new Date(dateString);
  return date.toLocaleString("en-US", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function formatNumber(value: number, decimals: number = 2) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  }).format(value);
}

export function TradesTable({ trades }: TradesTableProps) {
  if (trades.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No trades found for this run.
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Time</TableHead>
          <TableHead>Symbol</TableHead>
          <TableHead>Exchange</TableHead>
          <TableHead>Action</TableHead>
          <TableHead>Side</TableHead>
          <TableHead className="text-right">Quantity</TableHead>
          <TableHead className="text-right">Price</TableHead>
          <TableHead className="text-right">Fees</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {trades.map((trade) => (
          <TableRow key={trade.trade_id}>
            <TableCell className="font-mono text-xs">
              {formatDateTime(trade.ts)}
            </TableCell>
            <TableCell className="font-medium">{trade.symbol}</TableCell>
            <TableCell>{trade.exchange}</TableCell>
            <TableCell>{trade.action}</TableCell>
            <TableCell>
              <Badge variant={trade.side === "buy" ? "default" : "secondary"}>
                {trade.side}
              </Badge>
            </TableCell>
            <TableCell className="text-right font-mono">
              {formatNumber(trade.quantity_actual, 4)}
            </TableCell>
            <TableCell className="text-right font-mono">
              {formatCurrency(trade.price)}
            </TableCell>
            <TableCell className="text-right font-mono">
              {formatCurrency(trade.fee_amount_usdt)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
