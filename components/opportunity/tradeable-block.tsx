"use client";

import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Opportunity, Exchange } from "@/lib/types/opportunity";
import type { VolumeEntry } from "@/lib/services/volume-fetcher";
import {
  formatCompactUsd,
  isScreenActive,
  legVolume,
  screenOpportunity,
  type ScreenThresholds,
} from "@/lib/opportunity-screen";

interface TradeableBlockProps {
  opportunities: Opportunity[];
  volumes?: Record<string, VolumeEntry>;
  thresholds: ScreenThresholds;
  onSymbolClick?: (symbol: string, exchangeA: Exchange, exchangeB: Exchange) => void;
}

function formatCountdown(secs: number): string {
  if (secs < 0) return "passed";
  const mins = Math.floor(secs / 60);
  const hours = Math.floor(mins / 60);
  if (hours > 0) return `${hours}h ${mins % 60}m`;
  return `${mins}m`;
}

/**
 * The rows that clear the screen, lifted out of the table so they can be acted
 * on without hunting for green markers. Renders nothing at all when no
 * threshold is set — without one there is no definition of "tradeable".
 */
export function TradeableBlock({
  opportunities,
  volumes,
  thresholds,
  onSymbolClick,
}: TradeableBlockProps) {
  const passing = useMemo(
    () =>
      opportunities
        .filter((opp) => screenOpportunity(opp, volumes, thresholds).state === "pass")
        // Soonest funding first: these are time-boxed, and an entry window that
        // closes in 20 minutes matters more than a wider spread eight hours out.
        .sort(
          (a, b) =>
            Math.min(a.time_to_funding_a_secs, a.time_to_funding_b_secs) -
            Math.min(b.time_to_funding_a_secs, b.time_to_funding_b_secs),
        ),
    [opportunities, volumes, thresholds],
  );

  if (!isScreenActive(thresholds)) return null;

  const LegLine = ({ exchange, symbol }: { exchange: Exchange; symbol: string }) => {
    const entry = legVolume(volumes, exchange, symbol);
    return (
      <span className="tabular-nums">
        {entry ? formatCompactUsd(entry.estimatedDailyVolume) : "—"}
      </span>
    );
  };

  return (
    <Card className="border-green-500/40">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          Tradeable
          <Badge
            variant="secondary"
            className={cn(
              passing.length > 0
                ? "bg-green-500/20 text-green-500"
                : "bg-muted text-muted-foreground",
            )}
          >
            {passing.length}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {passing.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">
            No opportunity clears the current screen. Loosen a threshold above, or check the
            markers in the table to see which criterion each row misses.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {passing.map((opp) => {
              const soonest = Math.min(opp.time_to_funding_a_secs, opp.time_to_funding_b_secs);
              return (
                <div
                  key={`${opp.symbol}-${opp.exchange_pair}`}
                  className={cn(
                    "rounded-lg border p-3 transition-colors",
                    onSymbolClick && "cursor-pointer hover:border-green-500/60 hover:bg-muted/40",
                    opp.is_in_entry_window && "border-yellow-500/50 bg-yellow-500/5",
                  )}
                  onClick={() => onSymbolClick?.(opp.symbol, opp.exchange_a, opp.exchange_b)}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-medium">{opp.symbol}</span>
                    <span
                      className={cn(
                        "text-xs tabular-nums",
                        soonest <= 600 && soonest > 0
                          ? "text-yellow-500"
                          : "text-muted-foreground",
                      )}
                    >
                      {formatCountdown(soonest)}
                    </span>
                  </div>

                  <div className="mt-1 text-xs">
                    <span className="text-red-500">Short</span>{" "}
                    <span className="text-muted-foreground">{opp.short_exchange}</span>
                    <span className="text-muted-foreground"> / </span>
                    <span className="text-green-500">Long</span>{" "}
                    <span className="text-muted-foreground">{opp.long_exchange}</span>
                  </div>

                  <div className="mt-2 flex items-center gap-3 text-xs tabular-nums">
                    <span>
                      <span className="text-muted-foreground">Spread </span>
                      <span className="font-medium text-blue-500">
                        {opp.rate_spread_bps.toFixed(1)}
                      </span>
                    </span>
                    <span>
                      <span className="text-muted-foreground">Basis </span>
                      <span className="font-medium">
                        {opp.basis_bps === null
                          ? "-"
                          : `${opp.basis_bps > 0 ? "+" : ""}${opp.basis_bps.toFixed(1)}`}
                      </span>
                    </span>
                    <span>
                      <span className="text-muted-foreground">APY </span>
                      <span className="font-medium text-green-500">
                        {opp.annualized_return_pct.toFixed(0)}%
                      </span>
                    </span>
                  </div>

                  <div className="mt-1 text-xs text-muted-foreground">
                    Vol <LegLine exchange={opp.exchange_a} symbol={opp.symbol} />
                    {" / "}
                    <LegLine exchange={opp.exchange_b} symbol={opp.symbol} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
