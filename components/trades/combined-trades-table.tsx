"use client";

import { useState, useMemo } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronRight, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CombinedTrade } from "@/lib/types/database";

interface CombinedTradesTableProps {
  combinedTrades: CombinedTrade[];
  enableHedge: boolean;
}

type SortField = "ts" | "holding_period_hours" | "funding_fee_realized" | "price_pnl" | "commission_fee" | "total_pnl";
type SortDirection = "asc" | "desc";

interface SortConfig {
  field: SortField;
  direction: SortDirection;
}

interface HedgePair {
  id: string;
  ts: string;
  symbol: string;
  positions: CombinedTrade[];
  totalQuantity: number;
  totalNominalValue: number;
  totalFunding: number;
  totalPricePnl: number;
  totalCommission: number;
  totalPnl: number;
  avgHoldingPeriod: number;
}

function formatDateTime(dateString: string) {
  return new Date(dateString).toLocaleString();
}

function formatNumber(value: number | null, decimals: number = 2) {
  if (value === null) return "-";
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

function formatCurrency(value: number | null) {
  if (value === null) return "-";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatHours(hours: number | null) {
  if (hours === null) return "-";
  if (hours < 1) {
    return `${Math.round(hours * 60)}m`;
  }
  if (hours < 24) {
    return `${formatNumber(hours, 1)}h`;
  }
  return `${formatNumber(hours / 24, 1)}d`;
}

function getPnLColor(pnl: number | null) {
  if (pnl === null) return "";
  if (pnl > 0) return "text-emerald-600 dark:text-emerald-400";
  if (pnl < 0) return "text-red-600 dark:text-red-400";
  return "";
}

function SortableHeader({
  children,
  field,
  currentSort,
  onSort,
  className,
}: {
  children: React.ReactNode;
  field: SortField;
  currentSort: SortConfig;
  onSort: (field: SortField) => void;
  className?: string;
}) {
  const isActive = currentSort.field === field;

  return (
    <TableHead
      className={cn("cursor-pointer select-none hover:bg-muted/50", className)}
      onClick={() => onSort(field)}
    >
      <div className={cn("flex items-center gap-1", className?.includes("text-right") && "justify-end")}>
        {children}
        {isActive ? (
          currentSort.direction === "asc" ? (
            <ArrowUp className="h-3 w-3" />
          ) : (
            <ArrowDown className="h-3 w-3" />
          )
        ) : (
          <ArrowUpDown className="h-3 w-3 text-muted-foreground/50" />
        )}
      </div>
    </TableHead>
  );
}

// Group positions into hedge pairs based on symbol and close timestamp
function groupIntoHedgePairs(trades: CombinedTrade[]): HedgePair[] {
  // Sort by timestamp first
  const sorted = [...trades].sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());

  const pairs: HedgePair[] = [];
  const used = new Set<number>();

  for (let i = 0; i < sorted.length; i++) {
    if (used.has(sorted[i].combined_trade_id)) continue;

    const trade1 = sorted[i];
    // Find matching trade with same symbol but different exchange (within 1 minute)
    let matchIndex = -1;
    for (let j = i + 1; j < sorted.length; j++) {
      if (used.has(sorted[j].combined_trade_id)) continue;
      const trade2 = sorted[j];

      if (trade2.symbol === trade1.symbol && trade2.exchange !== trade1.exchange) {
        const timeDiff = Math.abs(new Date(trade2.ts).getTime() - new Date(trade1.ts).getTime());
        if (timeDiff <= 60 * 1000) { // Within 1 minute
          matchIndex = j;
          break;
        }
      }
    }

    if (matchIndex !== -1) {
      const trade2 = sorted[matchIndex];
      used.add(trade1.combined_trade_id);
      used.add(trade2.combined_trade_id);

      const positions = [trade1, trade2];
      pairs.push({
        id: `${trade1.combined_trade_id}-${trade2.combined_trade_id}`,
        ts: trade1.ts,
        symbol: trade1.symbol,
        positions,
        totalQuantity: positions.reduce((sum, p) => sum + p.quantity, 0),
        totalNominalValue: positions.reduce((sum, p) => sum + p.quantity * p.entry_price, 0),
        totalFunding: positions.reduce((sum, p) => sum + (p.funding_fee_realized ?? 0), 0),
        totalPricePnl: positions.reduce((sum, p) => sum + (p.price_pnl ?? 0), 0),
        totalCommission: positions.reduce((sum, p) => sum + (p.commission_fee ?? 0), 0),
        totalPnl: positions.reduce((sum, p) => sum + (p.total_pnl ?? 0), 0),
        avgHoldingPeriod: positions.reduce((sum, p) => sum + (p.holding_period_hours ?? 0), 0) / positions.length,
      });
    } else {
      // No match found, treat as single position
      used.add(trade1.combined_trade_id);
      pairs.push({
        id: `${trade1.combined_trade_id}`,
        ts: trade1.ts,
        symbol: trade1.symbol,
        positions: [trade1],
        totalQuantity: trade1.quantity,
        totalNominalValue: trade1.quantity * trade1.entry_price,
        totalFunding: trade1.funding_fee_realized ?? 0,
        totalPricePnl: trade1.price_pnl ?? 0,
        totalCommission: trade1.commission_fee ?? 0,
        totalPnl: trade1.total_pnl ?? 0,
        avgHoldingPeriod: trade1.holding_period_hours ?? 0,
      });
    }
  }

  return pairs;
}

function HedgePairSummaryRow({ pair }: { pair: HedgePair }) {
  return (
    <TableRow className="bg-primary/5 hover:bg-primary/10 border-t-2 border-primary/20">
      <TableCell></TableCell>
      <TableCell colSpan={4} className="font-medium text-primary">
        Hedge Pair Summary
      </TableCell>
      <TableCell className="text-right font-mono font-medium">
        {formatCurrency(pair.totalNominalValue)}
      </TableCell>
      <TableCell className="text-right font-mono">
        {formatNumber(pair.totalQuantity, 4)}
      </TableCell>
      <TableCell></TableCell>
      <TableCell></TableCell>
      <TableCell className="text-right font-mono">
        {formatHours(pair.avgHoldingPeriod)}
      </TableCell>
      <TableCell className={cn("text-right font-mono font-medium", getPnLColor(pair.totalFunding))}>
        {formatCurrency(pair.totalFunding)}
      </TableCell>
      <TableCell className={cn("text-right font-mono font-medium", getPnLColor(pair.totalPricePnl))}>
        {formatCurrency(pair.totalPricePnl)}
      </TableCell>
      <TableCell className="text-right font-mono font-medium text-muted-foreground">
        {formatCurrency(pair.totalCommission)}
      </TableCell>
      <TableCell className={cn("text-right font-mono font-bold", getPnLColor(pair.totalPnl))}>
        {formatCurrency(pair.totalPnl)}
      </TableCell>
    </TableRow>
  );
}

function PositionRow({
  position,
  isExpanded,
  onToggle,
  isPartOfPair,
  isFirstInPair,
}: {
  position: CombinedTrade;
  isExpanded: boolean;
  onToggle: () => void;
  isPartOfPair: boolean;
  isFirstInPair: boolean;
}) {
  return (
    <TableRow
      className={cn(
        "cursor-pointer transition-colors",
        isExpanded && "bg-muted/50",
        isPartOfPair && !isFirstInPair && "border-t-0"
      )}
      onClick={onToggle}
    >
      <TableCell className="w-10">
        {isFirstInPair && (
          isExpanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )
        )}
      </TableCell>
      <TableCell className="font-mono text-xs">
        {formatDateTime(position.ts)}
      </TableCell>
      <TableCell className="font-medium">{position.symbol}</TableCell>
      <TableCell>{position.exchange}</TableCell>
      <TableCell>
        <Badge variant={position.side === "long" ? "default" : "secondary"}>
          {position.side}
        </Badge>
      </TableCell>
      <TableCell className="text-right font-mono">
        {formatCurrency(position.quantity * position.entry_price)}
      </TableCell>
      <TableCell className="text-right font-mono">
        {formatNumber(position.quantity, 4)}
      </TableCell>
      <TableCell className="text-right font-mono">
        {formatCurrency(position.entry_price)}
      </TableCell>
      <TableCell className="text-right font-mono">
        {formatCurrency(position.exit_price)}
      </TableCell>
      <TableCell className="text-right font-mono">
        {formatHours(position.holding_period_hours)}
      </TableCell>
      <TableCell className={cn("text-right font-mono", getPnLColor(position.funding_fee_realized))}>
        {formatCurrency(position.funding_fee_realized)}
      </TableCell>
      <TableCell className={cn("text-right font-mono", getPnLColor(position.price_pnl))}>
        {formatCurrency(position.price_pnl)}
      </TableCell>
      <TableCell className="text-right font-mono text-muted-foreground">
        {formatCurrency(position.commission_fee)}
      </TableCell>
      <TableCell className={cn("text-right font-mono font-medium", getPnLColor(position.total_pnl))}>
        {formatCurrency(position.total_pnl)}
      </TableCell>
    </TableRow>
  );
}

export function CombinedTradesTable({ combinedTrades, enableHedge }: CombinedTradesTableProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [sortConfig, setSortConfig] = useState<SortConfig>({
    field: "ts",
    direction: "desc",
  });

  const handleSort = (field: SortField) => {
    setSortConfig((prev) => ({
      field,
      direction: prev.field === field && prev.direction === "desc" ? "asc" : "desc",
    }));
  };

  const hedgePairs = useMemo(() => {
    if (!enableHedge) return [];
    return groupIntoHedgePairs(combinedTrades);
  }, [combinedTrades, enableHedge]);

  const sortedPairs = useMemo(() => {
    if (!enableHedge) return [];

    return [...hedgePairs].sort((a, b) => {
      let aValue: number;
      let bValue: number;

      switch (sortConfig.field) {
        case "ts":
          aValue = new Date(a.ts).getTime();
          bValue = new Date(b.ts).getTime();
          break;
        case "holding_period_hours":
          aValue = a.avgHoldingPeriod;
          bValue = b.avgHoldingPeriod;
          break;
        case "funding_fee_realized":
          aValue = a.totalFunding;
          bValue = b.totalFunding;
          break;
        case "price_pnl":
          aValue = a.totalPricePnl;
          bValue = b.totalPricePnl;
          break;
        case "commission_fee":
          aValue = a.totalCommission;
          bValue = b.totalCommission;
          break;
        case "total_pnl":
          aValue = a.totalPnl;
          bValue = b.totalPnl;
          break;
        default:
          aValue = 0;
          bValue = 0;
      }

      return sortConfig.direction === "asc" ? aValue - bValue : bValue - aValue;
    });
  }, [hedgePairs, sortConfig, enableHedge]);

  const sortedTrades = useMemo(() => {
    if (enableHedge) return [];

    return [...combinedTrades].sort((a, b) => {
      let aValue: number;
      let bValue: number;

      if (sortConfig.field === "ts") {
        aValue = new Date(a.ts).getTime();
        bValue = new Date(b.ts).getTime();
      } else {
        aValue = a[sortConfig.field] ?? 0;
        bValue = b[sortConfig.field] ?? 0;
      }

      return sortConfig.direction === "asc" ? aValue - bValue : bValue - aValue;
    });
  }, [combinedTrades, sortConfig, enableHedge]);

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  if (combinedTrades.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No historical positions found for this run.
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-10"></TableHead>
          <SortableHeader field="ts" currentSort={sortConfig} onSort={handleSort}>
            Entry Time
          </SortableHeader>
          <TableHead>Symbol</TableHead>
          <TableHead>Exchange</TableHead>
          <TableHead>Side</TableHead>
          <TableHead className="text-right">Nominal Value</TableHead>
          <TableHead className="text-right">Quantity</TableHead>
          <TableHead className="text-right">Entry</TableHead>
          <TableHead className="text-right">Exit</TableHead>
          <SortableHeader field="holding_period_hours" currentSort={sortConfig} onSort={handleSort} className="text-right">
            Duration
          </SortableHeader>
          <SortableHeader field="funding_fee_realized" currentSort={sortConfig} onSort={handleSort} className="text-right">
            Funding
          </SortableHeader>
          <SortableHeader field="price_pnl" currentSort={sortConfig} onSort={handleSort} className="text-right">
            Price P&L
          </SortableHeader>
          <SortableHeader field="commission_fee" currentSort={sortConfig} onSort={handleSort} className="text-right">
            Commission
          </SortableHeader>
          <SortableHeader field="total_pnl" currentSort={sortConfig} onSort={handleSort} className="text-right">
            Total P&L
          </SortableHeader>
        </TableRow>
      </TableHeader>
      <TableBody>
        {enableHedge ? (
          // Hedge mode: show pairs with expandable summary
          sortedPairs.map((pair) => {
            const isExpanded = expandedIds.has(pair.id);
            const isActualPair = pair.positions.length === 2;

            return (
              <>{pair.positions.map((position, index) => (
                  <PositionRow
                    key={position.combined_trade_id}
                    position={position}
                    isExpanded={isExpanded}
                    onToggle={() => toggleExpanded(pair.id)}
                    isPartOfPair={isActualPair}
                    isFirstInPair={index === 0}
                  />
                ))}
                {isExpanded && isActualPair && <HedgePairSummaryRow pair={pair} />}
              </>
            );
          })
        ) : (
          // Non-hedge mode: show individual positions
          sortedTrades.map((position) => (
            <TableRow key={position.combined_trade_id}>
              <TableCell className="w-10"></TableCell>
              <TableCell className="font-mono text-xs">
                {formatDateTime(position.ts)}
              </TableCell>
              <TableCell className="font-medium">{position.symbol}</TableCell>
              <TableCell>{position.exchange}</TableCell>
              <TableCell>
                <Badge variant={position.side === "long" ? "default" : "secondary"}>
                  {position.side}
                </Badge>
              </TableCell>
              <TableCell className="text-right font-mono">
                {formatCurrency(position.quantity * position.entry_price)}
              </TableCell>
              <TableCell className="text-right font-mono">
                {formatNumber(position.quantity, 4)}
              </TableCell>
              <TableCell className="text-right font-mono">
                {formatCurrency(position.entry_price)}
              </TableCell>
              <TableCell className="text-right font-mono">
                {formatCurrency(position.exit_price)}
              </TableCell>
              <TableCell className="text-right font-mono">
                {formatHours(position.holding_period_hours)}
              </TableCell>
              <TableCell className={cn("text-right font-mono", getPnLColor(position.funding_fee_realized))}>
                {formatCurrency(position.funding_fee_realized)}
              </TableCell>
              <TableCell className={cn("text-right font-mono", getPnLColor(position.price_pnl))}>
                {formatCurrency(position.price_pnl)}
              </TableCell>
              <TableCell className="text-right font-mono text-muted-foreground">
                {formatCurrency(position.commission_fee)}
              </TableCell>
              <TableCell className={cn("text-right font-mono font-medium", getPnLColor(position.total_pnl))}>
                {formatCurrency(position.total_pnl)}
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}
