"use client";

import { useEffect, useState, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import type {
  EquityCurve,
  PnlSeries,
  CombinedTrade,
  Position,
} from "@/lib/types/database";

// Generic hook for realtime subscriptions
function useRealtimeSubscription<T extends Record<string, unknown>>(
  table: string,
  runId: string,
  initialData: T[],
  primaryKey: string,
  sortKey: string = "ts",
  sortDirection: "asc" | "desc" = "asc"
) {
  const [data, setData] = useState<T[]>(initialData);

  useEffect(() => {
    // Reset data when initialData changes (e.g., time range filter applied on server)
    setData(initialData);
  }, [initialData]);

  useEffect(() => {
    const supabase = createClient();
    const channelName = `${table}-${runId}-${Date.now()}`;

    console.log(`[Realtime] Subscribing to ${table} for run ${runId}`);

    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: table,
          filter: `run_id=eq.${runId}`,
        },
        (payload) => {
          console.log(`[Realtime] ${table} received:`, payload.eventType, payload);

          if (payload.eventType === "INSERT") {
            const newRecord = payload.new as T;
            setData((prev) => {
              const updated = [...prev, newRecord];
              // Sort by the specified key
              return updated.sort((a, b) => {
                const aVal = a[sortKey];
                const bVal = b[sortKey];
                if (typeof aVal === "string" && typeof bVal === "string") {
                  const comparison = new Date(aVal).getTime() - new Date(bVal).getTime();
                  return sortDirection === "asc" ? comparison : -comparison;
                }
                return 0;
              });
            });
          } else if (payload.eventType === "UPDATE") {
            const updatedRecord = payload.new as T;
            setData((prev) =>
              prev.map((item) => {
                // Match by primary key
                if (item[primaryKey] === updatedRecord[primaryKey]) {
                  return updatedRecord;
                }
                // Fallback: match by timestamp for time-series data
                if (primaryKey === "ts" && item["ts"] === updatedRecord["ts"]) {
                  return updatedRecord;
                }
                return item;
              })
            );
          } else if (payload.eventType === "DELETE") {
            const deletedRecord = payload.old as T;
            setData((prev) =>
              prev.filter((item) => {
                // Match by primary key
                if (item[primaryKey] === deletedRecord[primaryKey]) {
                  return false;
                }
                return true;
              })
            );
          }
        }
      )
      .subscribe((status, err) => {
        console.log(`[Realtime] ${table} subscription status:`, status, err);
      });

    return () => {
      console.log(`[Realtime] Unsubscribing from ${table}`);
      supabase.removeChannel(channel);
    };
  }, [table, runId, primaryKey, sortKey, sortDirection]);

  return data;
}

// Hook for equity curve data
export function useRealtimeEquityCurve(runId: string, initialData: EquityCurve[]) {
  return useRealtimeSubscription<EquityCurve>(
    "equity_curve",
    runId,
    initialData,
    "ts",
    "ts",
    "asc"
  );
}

// Hook for PnL series data
export function useRealtimePnlSeries(runId: string, initialData: PnlSeries[]) {
  return useRealtimeSubscription<PnlSeries>(
    "pnl_series",
    runId,
    initialData,
    "ts",
    "ts",
    "asc"
  );
}

// Hook for combined trades data
export function useRealtimeCombinedTrades(runId: string, initialData: CombinedTrade[]) {
  return useRealtimeSubscription<CombinedTrade>(
    "combined_trades",
    runId,
    initialData,
    "combined_trade_id",
    "ts",
    "asc"
  );
}

// Hook for positions data (realtime positions need special handling)
// Uses debouncing to batch multiple position updates together
export function useRealtimePositions(runId: string, initialData: Position[]) {
  const [positions, setPositions] = useState<Position[]>(initialData);
  const pendingUpdatesRef = useRef<Position[]>([]);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    setPositions(initialData);
  }, [initialData]);

  useEffect(() => {
    const supabase = createClient();
    const channelName = `positions-${runId}-${Date.now()}`;

    console.log(`[Realtime] Subscribing to positions for run ${runId}`);

    // Flush pending updates to state
    const flushUpdates = () => {
      if (pendingUpdatesRef.current.length === 0) return;

      const updates = [...pendingUpdatesRef.current];
      pendingUpdatesRef.current = [];

      setPositions((prev) => {
        // Merge new positions with existing ones
        const positionMap = new Map<string, Position>();

        // Add existing positions
        prev.forEach((pos) => {
          const key = `${pos.symbol}-${pos.exchange}-${pos.ts}`;
          positionMap.set(key, pos);
        });

        // Add/update with new positions
        updates.forEach((pos) => {
          const key = `${pos.symbol}-${pos.exchange}-${pos.ts}`;
          positionMap.set(key, pos);
        });

        // Convert back to array, sort by ts desc, and limit
        return Array.from(positionMap.values())
          .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())
          .slice(0, 100);
      });
    };

    // Schedule a debounced flush
    const scheduleFlush = () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      // Wait 150ms for more updates before flushing
      debounceTimerRef.current = setTimeout(flushUpdates, 150);
    };

    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "positions",
          filter: `run_id=eq.${runId}`,
        },
        (payload) => {
          console.log(`[Realtime] positions received:`, payload.eventType, payload);

          if (payload.eventType === "INSERT" || payload.eventType === "UPDATE") {
            const position = payload.new as Position;
            pendingUpdatesRef.current.push(position);
            scheduleFlush();
          }
        }
      )
      .subscribe((status, err) => {
        console.log(`[Realtime] positions subscription status:`, status, err);
      });

    return () => {
      console.log(`[Realtime] Unsubscribing from positions`);
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      supabase.removeChannel(channel);
    };
  }, [runId]);

  return positions;
}
