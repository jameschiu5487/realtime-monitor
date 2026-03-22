"use client";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { PolymarketPosition } from "@/lib/types/database";

interface PolymarketPositionsTableProps {
  positions: PolymarketPosition[];
}

export function PolymarketPositionsTable({ positions }: PolymarketPositionsTableProps) {
  // Split into active and settled
  const active = positions.filter((p) => !p.settled);
  const settled = positions.filter((p) => p.settled);

  return (
    <Card>
      <CardHeader className="border-b px-4 py-3 sm:px-6 sm:py-4">
        <CardTitle className="text-base sm:text-lg">
          Positions
          <span className="text-xs font-normal text-muted-foreground ml-2">
            ({active.length} active, {settled.length} settled)
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {positions.length === 0 ? (
          <div className="flex items-center justify-center h-[120px] text-muted-foreground text-sm">
            No positions
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs sm:text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-3 py-2 text-left font-medium">Entry Time</th>
                  <th className="px-3 py-2 text-left font-medium">Symbol</th>
                  <th className="px-3 py-2 text-left font-medium">Side</th>
                  <th className="px-3 py-2 text-right font-medium">Shares</th>
                  <th className="px-3 py-2 text-right font-medium">Entry</th>
                  <th className="px-3 py-2 text-right font-medium">Current</th>
                  <th className="px-3 py-2 text-right font-medium">Cost</th>
                  <th className="px-3 py-2 text-right font-medium">Value</th>
                  <th className="px-3 py-2 text-right font-medium">P&L</th>
                  <th className="px-3 py-2 text-center font-medium">Result</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {/* Active positions first */}
                {active.map((p) => (
                  <PositionRow key={`${p.id}`} position={p} />
                ))}
                {/* Then settled */}
                {settled.slice(0, 20).map((p) => (
                  <PositionRow key={`${p.id}`} position={p} />
                ))}
                {settled.length > 20 && (
                  <tr>
                    <td colSpan={10} className="px-3 py-2 text-center text-muted-foreground">
                      ... and {settled.length - 20} more settled positions
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PositionRow({ position: p }: { position: PolymarketPosition }) {
  const pnl = p.unrealized_pnl ?? 0;
  const isSettled = p.settled;

  return (
    <tr className={cn("hover:bg-muted/30", isSettled && "opacity-60")}>
      <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
        {p.entry_time
          ? new Date(p.entry_time).toLocaleString("en-US", {
              month: "2-digit",
              day: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
              hour12: false,
            })
          : "-"}
      </td>
      <td className="px-3 py-2 font-medium">{p.symbol}</td>
      <td className="px-3 py-2">
        <span
          className={cn(
            "px-1.5 py-0.5 rounded text-xs font-medium",
            p.side === "UP"
              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
              : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
          )}
        >
          {p.side}
        </span>
      </td>
      <td className="px-3 py-2 text-right font-mono">{p.shares?.toFixed(2)}</td>
      <td className="px-3 py-2 text-right font-mono">{p.entry_price?.toFixed(4)}</td>
      <td className="px-3 py-2 text-right font-mono">{p.current_price?.toFixed(4)}</td>
      <td className="px-3 py-2 text-right font-mono">${p.cost?.toFixed(2)}</td>
      <td className="px-3 py-2 text-right font-mono">${p.current_value?.toFixed(2)}</td>
      <td
        className={cn(
          "px-3 py-2 text-right font-mono",
          pnl >= 0
            ? "text-emerald-600 dark:text-emerald-400"
            : "text-red-600 dark:text-red-400"
        )}
      >
        {pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}
      </td>
      <td className="px-3 py-2 text-center">
        {p.result ? (
          <span
            className={cn(
              "px-1.5 py-0.5 rounded text-xs font-medium",
              p.result === "WIN"
                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
            )}
          >
            {p.result}
          </span>
        ) : (
          <span className="text-muted-foreground">-</span>
        )}
      </td>
    </tr>
  );
}
