"use client";

import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Opportunity, OpportunityType } from "@/lib/types/opportunity";

interface OpportunityTableProps {
  opportunities: Opportunity[];
  onSymbolClick?: (symbol: string) => void;
}

type SortKey = 'symbol' | 'type' | 'rate_spread_bps' | 'net_profit_bps' | 'time_to_funding_a_secs' | 'time_to_funding_b_secs' | 'annualized_return_pct';
type SortDirection = 'asc' | 'desc';

export function OpportunityTable({ opportunities, onSymbolClick }: OpportunityTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>('net_profit_bps');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [filter, setFilter] = useState<'all' | OpportunityType>('all');

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDirection('desc');
    }
  };

  const sortedOpportunities = useMemo(() => {
    let filtered = opportunities;
    if (filter !== 'all') {
      filtered = opportunities.filter(o => o.opportunity_type === filter);
    }

    return [...filtered].sort((a, b) => {
      let aVal: number | string;
      let bVal: number | string;

      switch (sortKey) {
        case 'symbol':
          aVal = a.symbol;
          bVal = b.symbol;
          break;
        case 'type':
          aVal = a.opportunity_type;
          bVal = b.opportunity_type;
          break;
        case 'net_profit_bps':
          aVal = a.net_profit_bps ?? a.rate_spread_bps;
          bVal = b.net_profit_bps ?? b.rate_spread_bps;
          break;
        default:
          aVal = a[sortKey] as number;
          bVal = b[sortKey] as number;
      }

      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortDirection === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }

      return sortDirection === 'asc' ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number);
    });
  }, [opportunities, sortKey, sortDirection, filter]);

  const formatBps = (bps: number | null) => bps !== null ? bps.toFixed(2) : '-';
  const formatTime = (secs: number) => {
    if (secs < 0) return 'Passed';
    const mins = Math.floor(secs / 60);
    const hours = Math.floor(mins / 60);
    if (hours > 0) return `${hours}h ${mins % 60}m`;
    return `${mins}m`;
  };

  const getTypeVariant = (type: OpportunityType): "default" | "secondary" => {
    return type === 'RateArbitrage' ? 'default' : 'secondary';
  };

  const getTypeLabel = (type: OpportunityType) => {
    return type === 'RateArbitrage' ? 'Rate Arb' : 'Interval';
  };

  const getProfitColor = (profit: number | null) => {
    if (profit === null) return 'text-muted-foreground';
    if (profit > 5) return 'text-green-500';
    if (profit > 0) return 'text-green-400';
    if (profit > -2) return 'text-yellow-500';
    return 'text-red-500';
  };

  const SortableHeader = ({ label, sortKeyVal }: { label: string; sortKeyVal: SortKey }) => {
    const isActive = sortKey === sortKeyVal;
    return (
      <TableHead
        className="cursor-pointer hover:text-foreground"
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

  const rateArbCount = opportunities.filter(o => o.opportunity_type === 'RateArbitrage').length;
  const intervalCount = opportunities.filter(o => o.opportunity_type === 'IntervalMismatch').length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>Opportunities ({sortedOpportunities.length})</CardTitle>
          <div className="flex gap-2">
            <Button
              variant={filter === 'all' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setFilter('all')}
            >
              All ({opportunities.length})
            </Button>
            <Button
              variant={filter === 'RateArbitrage' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setFilter('RateArbitrage')}
              className={filter === 'RateArbitrage' ? 'bg-purple-500 hover:bg-purple-600' : ''}
            >
              Rate Arb ({rateArbCount})
            </Button>
            <Button
              variant={filter === 'IntervalMismatch' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setFilter('IntervalMismatch')}
              className={filter === 'IntervalMismatch' ? 'bg-orange-500 hover:bg-orange-600' : ''}
            >
              Interval ({intervalCount})
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <SortableHeader label="Symbol" sortKeyVal="symbol" />
                <SortableHeader label="Type" sortKeyVal="type" />
                <TableHead>Exchange A</TableHead>
                <TableHead>Exchange B</TableHead>
                <SortableHeader label="Spread (bps)" sortKeyVal="rate_spread_bps" />
                <TableHead>Cost (bps)</TableHead>
                <SortableHeader label="Net Profit (bps)" sortKeyVal="net_profit_bps" />
                <SortableHeader label="APY" sortKeyVal="annualized_return_pct" />
                <SortableHeader label="Time A" sortKeyVal="time_to_funding_a_secs" />
                <SortableHeader label="Time B" sortKeyVal="time_to_funding_b_secs" />
                <TableHead>Direction</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedOpportunities.map((opp) => (
                <TableRow
                  key={`${opp.symbol}-${opp.exchange_pair}`}
                  className={cn(
                    opp.is_in_entry_window && "bg-yellow-500/5"
                  )}
                >
                  <TableCell
                    className="font-medium cursor-pointer hover:text-blue-500"
                    onClick={() => onSymbolClick?.(opp.symbol)}
                  >
                    {opp.symbol}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={getTypeVariant(opp.opportunity_type)}
                      className={cn(
                        opp.opportunity_type === 'RateArbitrage'
                          ? 'bg-purple-500/20 text-purple-500 hover:bg-purple-500/30'
                          : 'bg-orange-500/20 text-orange-500 hover:bg-orange-500/30'
                      )}
                    >
                      {getTypeLabel(opp.opportunity_type)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div>{opp.exchange_a}: {opp.exchange_a_rate_bps.toFixed(2)} bps</div>
                    <div className="text-xs text-muted-foreground">{opp.exchange_a_interval_hours}h interval</div>
                  </TableCell>
                  <TableCell>
                    <div>{opp.exchange_b}: {opp.exchange_b_rate_bps.toFixed(2)} bps</div>
                    <div className="text-xs text-muted-foreground">{opp.exchange_b_interval_hours}h interval</div>
                  </TableCell>
                  <TableCell className="text-blue-500 font-medium">
                    {formatBps(opp.rate_spread_bps)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatBps(opp.total_spread_cost_bps)}
                  </TableCell>
                  <TableCell className={cn("font-medium", getProfitColor(opp.net_profit_bps))}>
                    {formatBps(opp.net_profit_bps)}
                  </TableCell>
                  <TableCell className="text-green-500">
                    {opp.annualized_return_pct.toFixed(1)}%
                  </TableCell>
                  <TableCell>
                    <span className={cn(
                      "font-medium",
                      opp.time_to_funding_a_secs <= 600 && opp.time_to_funding_a_secs > 0 ? "text-yellow-500" : "text-muted-foreground"
                    )}>
                      {formatTime(opp.time_to_funding_a_secs)}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className={cn(
                      "font-medium",
                      opp.time_to_funding_b_secs <= 600 && opp.time_to_funding_b_secs > 0 ? "text-yellow-500" : "text-muted-foreground"
                    )}>
                      {formatTime(opp.time_to_funding_b_secs)}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="text-xs">
                      <span className="text-red-500">Short</span>
                      <span className="text-muted-foreground"> {opp.short_exchange}</span>
                    </div>
                    <div className="text-xs">
                      <span className="text-green-500">Long</span>
                      <span className="text-muted-foreground"> {opp.long_exchange}</span>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {sortedOpportunities.length === 0 && (
            <div className="py-8 text-center text-muted-foreground">
              No opportunities found
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
