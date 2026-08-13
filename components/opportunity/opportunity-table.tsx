"use client";

import { useState, useMemo, useCallback } from 'react';
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
import type { Opportunity, OpportunityType, Exchange } from "@/lib/types/opportunity";
import { volumeKey, type VolumeEntry } from "@/lib/services/volume-fetcher";

/**
 * Screening thresholds. A null field means "don't test this", so the marker
 * only lights up against criteria the user actually set.
 */
export interface ScreenThresholds {
  /** Pass when |basis| is at or below this, in bps. Wide gaps cost you on entry. */
  maxAbsBasisBps: number | null;
  /** Pass when BOTH legs clear this estimated daily volume, in USD. */
  minDailyVolume: number | null;
  /** Pass when the raw funding rate spread is at or above this, in bps. */
  minSpreadBps: number | null;
}

export const EMPTY_THRESHOLDS: ScreenThresholds = {
  maxAbsBasisBps: null,
  minDailyVolume: null,
  minSpreadBps: null,
};

interface OpportunityTableProps {
  opportunities: Opportunity[];
  /** Estimated daily volume keyed by `${exchange}:${symbol}`; fills in progressively. */
  volumes?: Record<string, VolumeEntry>;
  thresholds?: ScreenThresholds;
  onSymbolClick?: (symbol: string, exchangeA: Exchange, exchangeB: Exchange) => void;
}

type SortKey = 'symbol' | 'type' | 'rate_spread_bps' | 'net_profit_bps' | 'time_to_funding_a_secs' | 'time_to_funding_b_secs' | 'annualized_return_pct' | 'basis_bps' | 'volume_a' | 'volume_b' | 'screen';
type SortDirection = 'asc' | 'desc';

/** Outcome of screening one row: pass, fail, or "can't tell yet". */
type ScreenState = 'pass' | 'fail' | 'pending' | 'off';

function formatUsd(value: number): string {
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `$${(value / 1e3).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

export function OpportunityTable({
  opportunities,
  volumes,
  thresholds = EMPTY_THRESHOLDS,
  onSymbolClick,
}: OpportunityTableProps) {
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

  const screenRow = useCallback(
    (opp: Opportunity): { state: ScreenState; reasons: string[] } => {
      const { maxAbsBasisBps, minDailyVolume, minSpreadBps } = thresholds;
      if (maxAbsBasisBps === null && minDailyVolume === null && minSpreadBps === null) {
        return { state: 'off', reasons: [] };
      }

      const reasons: string[] = [];
      // Volume arrives after the row does. A row we cannot judge yet is not the
      // same as one that failed, so it gets its own state instead of a red X.
      let pending = false;

      if (maxAbsBasisBps !== null) {
        if (opp.basis_bps === null) {
          pending = true;
          reasons.push('basis unavailable');
        } else if (Math.abs(opp.basis_bps) > maxAbsBasisBps) {
          reasons.push(`|basis| ${Math.abs(opp.basis_bps).toFixed(1)} > ${maxAbsBasisBps}`);
        }
      }

      if (minDailyVolume !== null) {
        // Both legs must clear it — an arb is only as liquid as its thinner side.
        for (const [label, exchange] of [
          ['A', opp.exchange_a],
          ['B', opp.exchange_b],
        ] as const) {
          const entry = volumes?.[volumeKey(exchange, opp.symbol)];
          if (!entry) {
            pending = true;
            reasons.push(`vol ${label} not loaded yet`);
          } else if (entry.estimatedDailyVolume < minDailyVolume) {
            reasons.push(
              `vol ${label} ${formatUsd(entry.estimatedDailyVolume)} < ${formatUsd(minDailyVolume)}`,
            );
          }
        }
      }

      if (minSpreadBps !== null && opp.rate_spread_bps < minSpreadBps) {
        reasons.push(`spread ${opp.rate_spread_bps.toFixed(1)} < ${minSpreadBps}`);
      }

      if (reasons.length === 0) return { state: 'pass', reasons };
      return { state: pending ? 'pending' : 'fail', reasons };
    },
    [thresholds, volumes],
  );

  const sortedOpportunities = useMemo(() => {
    // Volume arrives separately from the opportunity poll, so a row may not
    // have it yet. Treat missing as the lowest value rather than zero, so it
    // never outranks a real figure in the default descending view.
    const volumeFor = (opp: Opportunity, legA: boolean) => {
      const exchange = legA ? opp.exchange_a : opp.exchange_b;
      return volumes?.[volumeKey(exchange, opp.symbol)]?.estimatedDailyVolume ?? -Infinity;
    };

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
        case 'basis_bps':
          // Sort on magnitude — a -30 bps gap is as notable as +30.
          aVal = a.basis_bps === null ? -Infinity : Math.abs(a.basis_bps);
          bVal = b.basis_bps === null ? -Infinity : Math.abs(b.basis_bps);
          break;
        case 'volume_a':
        case 'volume_b':
          aVal = volumeFor(a, sortKey === 'volume_a');
          bVal = volumeFor(b, sortKey === 'volume_a');
          break;
        case 'screen': {
          const rank = { pass: 2, pending: 1, fail: 0, off: 0 } as const;
          aVal = rank[screenRow(a).state];
          bVal = rank[screenRow(b).state];
          break;
        }
        default:
          aVal = a[sortKey] as number;
          bVal = b[sortKey] as number;
      }

      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortDirection === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }

      return sortDirection === 'asc' ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number);
    });
  }, [opportunities, sortKey, sortDirection, filter, volumes, screenRow]);

  const formatBps = (bps: number | null) => bps !== null ? bps.toFixed(2) : '-';

  // Estimated daily volume for one leg. Its own column rather than a line
  // inside the exchange cell, so it can be sorted on — screening out illiquid
  // pairs is the main reason to look at it at all.
  const LegVolume = ({ exchange, symbol }: { exchange: Exchange; symbol: string }) => {
    const entry = volumes?.[volumeKey(exchange, symbol)];
    if (!entry) {
      return <span className="text-muted-foreground/50">—</span>;
    }
    // Fewer than 4 completed hours means a freshly listed or thin market, so
    // the extrapolation rests on less data than usual — flag it rather than
    // presenting it as equally solid.
    const partial = entry.hoursUsed < 4;
    return (
      <span
        className={cn(partial ? "text-yellow-500" : "text-muted-foreground")}
        title={`${formatUsd(entry.quoteVolumeWindow)} over the last ${entry.hoursUsed}h, scaled to 24h`}
      >
        {formatUsd(entry.estimatedDailyVolume)}
        {partial ? '*' : ''}
      </span>
    );
  };

  // Pass/fail marker. The tooltip names every criterion that failed, so a row
  // that misses by a hair is distinguishable from one that misses by a mile.
  const ScreenBlock = ({ opp }: { opp: Opportunity }) => {
    const { state, reasons } = screenRow(opp);
    if (state === 'off') {
      return <span className="text-muted-foreground/30" title="No screen set">·</span>;
    }
    const style = {
      pass: 'bg-green-500 border-green-500',
      fail: 'bg-transparent border-muted-foreground/30',
      pending: 'bg-transparent border-yellow-500 border-dashed',
    }[state];
    const label = {
      pass: 'Passes the screen',
      fail: reasons.join('\n'),
      pending: reasons.join('\n'),
    }[state];
    return (
      <span
        className={cn('inline-block h-3 w-3 rounded-sm border', style)}
        title={label}
        aria-label={state}
      />
    );
  };

  const getBasisColor = (bps: number | null) => {
    if (bps === null) return 'text-muted-foreground';
    const magnitude = Math.abs(bps);
    if (magnitude >= 20) return 'text-orange-500';
    if (magnitude >= 5) return 'text-yellow-500';
    return 'text-muted-foreground';
  };
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
                <SortableHeader label="" sortKeyVal="screen" />
                <SortableHeader label="Symbol" sortKeyVal="symbol" />
                <SortableHeader label="Type" sortKeyVal="type" />
                <TableHead>Exchange A</TableHead>
                <SortableHeader label="Vol A / day" sortKeyVal="volume_a" />
                <TableHead>Exchange B</TableHead>
                <SortableHeader label="Vol B / day" sortKeyVal="volume_b" />
                <SortableHeader label="Basis (bps)" sortKeyVal="basis_bps" />
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
                  <TableCell className="w-6 pr-0">
                    <ScreenBlock opp={opp} />
                  </TableCell>
                  <TableCell
                    className="font-medium cursor-pointer hover:text-blue-500"
                    onClick={() => onSymbolClick?.(opp.symbol, opp.exchange_a, opp.exchange_b)}
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
                  <TableCell className="whitespace-nowrap tabular-nums">
                    <LegVolume exchange={opp.exchange_a} symbol={opp.symbol} />
                  </TableCell>
                  <TableCell>
                    <div>{opp.exchange_b}: {opp.exchange_b_rate_bps.toFixed(2)} bps</div>
                    <div className="text-xs text-muted-foreground">{opp.exchange_b_interval_hours}h interval</div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums">
                    <LegVolume exchange={opp.exchange_b} symbol={opp.symbol} />
                  </TableCell>
                  <TableCell
                    className={cn("font-medium", getBasisColor(opp.basis_bps))}
                    title={
                      opp.exchange_a_mark_price !== null && opp.exchange_b_mark_price !== null
                        ? `${opp.exchange_a} ${opp.exchange_a_mark_price} vs ${opp.exchange_b} ${opp.exchange_b_mark_price}`
                        : undefined
                    }
                  >
                    {opp.basis_bps === null
                      ? '-'
                      : `${opp.basis_bps > 0 ? '+' : ''}${opp.basis_bps.toFixed(2)}`}
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
