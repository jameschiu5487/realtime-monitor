"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { OpportunityStats, Exchange, ALL_EXCHANGES } from "@/lib/types/opportunity";
import { getExchangePairDisplayName } from "@/lib/types/opportunity";

interface OpportunityStatsProps {
  stats: OpportunityStats | null;
  connected: boolean;
  lastUpdate: Date | null;
  selectedExchanges: Exchange[];
  onExchangeToggle: (exchange: Exchange) => void;
}

const ALL_EXCHANGES_LIST: Exchange[] = ['Binance', 'Bybit', 'BingX', 'Gate', 'Bitget', 'Zoomex', 'BitMart'];

export function OpportunityStatsHeader({
  stats,
  connected,
  lastUpdate,
  selectedExchanges,
  onExchangeToggle,
}: OpportunityStatsProps) {
  const formatNumber = (num: number | null | undefined, decimals = 2) => {
    if (num === null || num === undefined) return '-';
    return num.toFixed(decimals);
  };

  return (
    <div className="space-y-4">
      {/* Header Row */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight">Funding Rate Monitor</h1>
          <div className={cn(
            "flex items-center gap-2 text-sm",
            connected ? "text-green-500" : "text-red-500"
          )}>
            <span className={cn(
              "h-2 w-2 rounded-full",
              connected ? "bg-green-500" : "bg-red-500"
            )} />
            {connected ? "Connected" : "Disconnected"}
          </div>
          {lastUpdate && (
            <span className="text-sm text-muted-foreground">
              Last update: {lastUpdate.toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>

      {/* Exchange Filter */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">Exchanges:</span>
        {ALL_EXCHANGES_LIST.map((exchange) => (
          <Badge
            key={exchange}
            variant={selectedExchanges.includes(exchange) ? "default" : "outline"}
            className="cursor-pointer"
            onClick={() => onExchangeToggle(exchange)}
          >
            {exchange}
          </Badge>
        ))}
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
          <StatCard
            label="Total Opportunities"
            value={stats.total.toString()}
            variant="blue"
          />
          <StatCard
            label="Rate Arbitrage"
            value={stats.rate_arb_count.toString()}
            variant="purple"
          />
          <StatCard
            label="Interval Mismatch"
            value={stats.interval_mismatch_count.toString()}
            variant="orange"
          />
          <StatCard
            label="In Entry Window"
            value={stats.in_entry_window.toString()}
            variant="yellow"
          />
          <StatCard
            label="Profitable (after cost)"
            value={stats.profitable.toString()}
            variant="green"
          />
        </div>
      )}

      {/* Best Opportunity */}
      {stats?.best_opportunity && (
        <Card className="bg-muted/50">
          <CardContent className="py-3">
            <span className="text-sm text-muted-foreground">Best Opportunity: </span>
            <span className="font-medium">
              {stats.best_opportunity.symbol}
            </span>
            <span className="text-xs text-muted-foreground ml-2">
              ({getExchangePairDisplayName(stats.best_opportunity.exchange_pair)})
            </span>
            <span className="text-muted-foreground"> - </span>
            <span className="font-medium text-green-500">
              {formatNumber(stats.best_net_profit)} bps net profit
            </span>
            <span className="text-muted-foreground"> ({formatNumber(stats.best_opportunity.rate_spread_bps)} bps spread)</span>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

interface StatCardProps {
  label: string;
  value: string;
  variant: 'blue' | 'green' | 'yellow' | 'red' | 'purple' | 'orange';
}

function StatCard({ label, value, variant }: StatCardProps) {
  const variantClasses = {
    blue: 'text-blue-500 bg-blue-500/10 border-blue-500/20',
    green: 'text-green-500 bg-green-500/10 border-green-500/20',
    yellow: 'text-yellow-500 bg-yellow-500/10 border-yellow-500/20',
    red: 'text-red-500 bg-red-500/10 border-red-500/20',
    purple: 'text-purple-500 bg-purple-500/10 border-purple-500/20',
    orange: 'text-orange-500 bg-orange-500/10 border-orange-500/20',
  };

  return (
    <Card className={cn("border", variantClasses[variant])}>
      <CardContent className="p-3">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={cn("text-2xl font-bold", variantClasses[variant].split(' ')[0])}>
          {value}
        </div>
      </CardContent>
    </Card>
  );
}
