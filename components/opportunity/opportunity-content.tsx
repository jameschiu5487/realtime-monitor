"use client";

import { useState, useMemo } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertCircle, RefreshCw } from "lucide-react";
import { useOpportunitySSE } from "@/lib/hooks/use-opportunity-sse";
import { OpportunityStatsHeader } from "./opportunity-stats";
import { OpportunityTable } from "./opportunity-table";
import { FundingRatesTable } from "./funding-rates-table";
import type { Exchange, OpportunityStats } from "@/lib/types/opportunity";
import { getExchangePairsFromSelections, ALL_EXCHANGES } from "@/lib/types/opportunity";
import { cn } from "@/lib/utils";

export function OpportunityContent() {
  const [selectedExchanges, setSelectedExchanges] = useState<Exchange[]>(['Binance', 'Bybit']);
  const [activeTab, setActiveTab] = useState<'opportunities' | 'funding-rates'>('opportunities');
  const [costBpsInput, setCostBpsInput] = useState<string>("20"); // String for input
  const costBps = parseInt(costBpsInput) || 0; // Parse for calculations

  const {
    opportunities,
    stats,
    fundingRates,
    connected,
    lastUpdate,
    error,
    refresh,
    isLoading,
  } = useOpportunitySSE();

  const handleExchangeToggle = (exchange: Exchange) => {
    setSelectedExchanges(prev => {
      if (prev.includes(exchange)) {
        // Don't allow deselecting if only one exchange remains
        if (prev.length === 1) return prev;
        return prev.filter(e => e !== exchange);
      }
      return [...prev, exchange];
    });
  };

  // Filter opportunities by selected exchange pairs and apply cost
  const filteredOpportunities = useMemo(() => {
    const selectedPairs = getExchangePairsFromSelections(selectedExchanges);
    return opportunities
      .filter(opp => selectedPairs.includes(opp.exchange_pair))
      .map(opp => ({
        ...opp,
        total_spread_cost_bps: costBps,
        net_profit_bps: opp.rate_spread_bps - costBps,
      }))
      .sort((a, b) => (b.net_profit_bps ?? 0) - (a.net_profit_bps ?? 0));
  }, [opportunities, selectedExchanges, costBps]);

  // Calculate filtered stats
  const filteredStats = useMemo((): OpportunityStats | null => {
    if (!stats) return null;

    const filtered = filteredOpportunities;
    const rateArbCount = filtered.filter(o => o.opportunity_type === 'RateArbitrage').length;
    const intervalMismatchCount = filtered.filter(o => o.opportunity_type === 'IntervalMismatch').length;
    const inEntryWindow = filtered.filter(o => o.is_in_entry_window).length;
    const profitable = filtered.filter(o => o.net_profit_bps !== null && o.net_profit_bps > 0).length;

    // Find best opportunity from filtered list
    const bestOpportunity = filtered.length > 0 ? filtered[0] : null;
    const bestNetProfit = filtered
      .filter(o => o.net_profit_bps !== null)
      .reduce((max, o) => Math.max(max, o.net_profit_bps!), -Infinity);

    const avgSpreadBps = filtered.length > 0
      ? filtered.reduce((sum, o) => sum + o.rate_spread_bps, 0) / filtered.length
      : null;

    return {
      ...stats,
      total: filtered.length,
      rate_arb_count: rateArbCount,
      interval_mismatch_count: intervalMismatchCount,
      in_entry_window: inEntryWindow,
      profitable,
      best_opportunity: bestOpportunity,
      best_net_profit: bestNetProfit === -Infinity ? null : bestNetProfit,
      avg_spread_bps: avgSpreadBps,
    };
  }, [stats, filteredOpportunities]);

  return (
    <div className="space-y-6">
      {/* Error Alert */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Stats Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <OpportunityStatsHeader
            stats={filteredStats}
            connected={connected}
            lastUpdate={lastUpdate}
            selectedExchanges={selectedExchanges}
            onExchangeToggle={handleExchangeToggle}
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={refresh}
          disabled={isLoading}
          className="shrink-0"
        >
          <RefreshCw className={cn("h-4 w-4 mr-2", isLoading && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {/* Tabs with Cost Input */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)}>
        <div className="flex items-center gap-4">
          <TabsList>
            <TabsTrigger value="opportunities">
              Opportunities ({filteredOpportunities.length})
            </TabsTrigger>
            <TabsTrigger value="funding-rates">
              Funding Rates
            </TabsTrigger>
          </TabsList>

          <div className="flex items-center gap-2">
            <Label htmlFor="cost-input" className="text-sm text-muted-foreground whitespace-nowrap">
              Cost (bps):
            </Label>
            <Input
              id="cost-input"
              type="number"
              value={costBpsInput}
              onChange={(e) => setCostBpsInput(e.target.value)}
              className="w-20 h-8"
              step="1"
              min="0"
            />
          </div>
        </div>

        <TabsContent value="opportunities" className="mt-4">
          <OpportunityTable opportunities={filteredOpportunities} />
        </TabsContent>

        <TabsContent value="funding-rates" className="mt-4">
          <FundingRatesTable
            fundingRates={fundingRates}
            selectedExchanges={selectedExchanges}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
