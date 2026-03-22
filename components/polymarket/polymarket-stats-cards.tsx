"use client";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface Stats {
  totalEquity: number;
  totalPnl: number;
  positionValue: number;
  drawdown: number;
  totalTrades: number;
  totalWins: number;
  overallWinRate: number;
  activePositions: number;
  initialCapital: number;
}

interface PolymarketStatsCardsProps {
  stats: Stats;
}

export function PolymarketStatsCards({ stats }: PolymarketStatsCardsProps) {
  const pnlPct = stats.initialCapital > 0 ? (stats.totalPnl / stats.initialCapital) * 100 : 0;

  const cards = [
    {
      label: "Total Equity",
      value: `$${stats.totalEquity.toFixed(2)}`,
      className: "",
    },
    {
      label: "Total P&L",
      value: `${stats.totalPnl >= 0 ? "+" : ""}$${stats.totalPnl.toFixed(2)} (${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(2)}%)`,
      className: stats.totalPnl >= 0
        ? "text-emerald-600 dark:text-emerald-400"
        : "text-red-600 dark:text-red-400",
    },
    {
      label: "Win Rate",
      value: `${stats.overallWinRate.toFixed(1)}% (${stats.totalWins}/${stats.totalTrades})`,
      className: "",
    },
    {
      label: "Active Positions",
      value: `${stats.activePositions}`,
      className: "",
    },
    {
      label: "Position Value",
      value: `$${stats.positionValue.toFixed(2)}`,
      className: "",
    },
    {
      label: "Max Drawdown",
      value: `${stats.drawdown.toFixed(2)}%`,
      className: stats.drawdown < 0
        ? "text-red-600 dark:text-red-400"
        : "",
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
      {cards.map((card) => (
        <Card key={card.label}>
          <CardContent className="pt-4 pb-4 px-4">
            <p className="text-xs text-muted-foreground mb-1">{card.label}</p>
            <p className={cn("text-lg font-bold font-mono", card.className)}>
              {card.value}
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
