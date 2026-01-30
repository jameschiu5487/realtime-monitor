"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type {
  EquityCurve,
  PnlSeries,
  CombinedTrade,
  Position,
} from "@/lib/types/database";

// Generic hook for realtime subscriptions
function useRealtimeSubscription<T extends { ts?: string }>(
  table: string,
  runId: string,
  initialData: T[],
  sortKey: keyof T = "ts" as keyof T,
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
                // Match by primary key - handle different table structures
                if ("combined_trade_id" in item && "combined_trade_id" in updatedRecord) {
                  return (item as CombinedTrade).combined_trade_id ===
                    (updatedRecord as CombinedTrade).combined_trade_id
                    ? updatedRecord
                    : item;
                }
                if ("ts" in item && "ts" in updatedRecord) {
                  // For time-series data, match by timestamp and run_id
                  const itemTs = (item as { ts: string }).ts;
                  const updatedTs = (updatedRecord as { ts: string }).ts;
                  return itemTs === updatedTs ? updatedRecord : item;
                }
                return item;
              })
            );
          } else if (payload.eventType === "DELETE") {
            const deletedRecord = payload.old as T;
            setData((prev) =>
              prev.filter((item) => {
                if ("combined_trade_id" in item && "combined_trade_id" in deletedRecord) {
                  return (item as CombinedTrade).combined_trade_id !==
                    (deletedRecord as CombinedTrade).combined_trade_id;
                }
                if ("ts" in item && "ts" in deletedRecord) {
                  return (item as { ts: string }).ts !== (deletedRecord as { ts: string }).ts;
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
  }, [table, runId, sortKey, sortDirection]);

  return data;
}

// Hook for equity curve data
export function useRealtimeEquityCurve(runId: string, initialData: EquityCurve[]) {
  return useRealtimeSubscription<EquityCurve>(
    "equity_curve",
    runId,
    initialData,
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
    "asc"
  );
}

// Hook for combined trades data
export function useRealtimeCombinedTrades(runId: string, initialData: CombinedTrade[]) {
  return useRealtimeSubscription<CombinedTrade>(
    "combined_trades",
    runId,
    initialData,
    "ts",
    "asc"
  );
}

// Hook for positions data (realtime positions need special handling)
export function useRealtimePositions(runId: string, initialData: Position[]) {
  const [positions, setPositions] = useState<Position[]>(initialData);

  useEffect(() => {
    setPositions(initialData);
  }, [initialData]);

  useEffect(() => {
    const supabase = createClient();
    const channelName = `positions-${runId}-${Date.now()}`;

    console.log(`[Realtime] Subscribing to positions for run ${runId}`);

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

          if (payload.eventType === "INSERT") {
            const newPosition = payload.new as Position;
            setPositions((prev) => {
              // Add new position and keep sorted by ts desc (newest first)
              const updated = [newPosition, ...prev];
              // Limit to most recent 100 positions to prevent memory issues
              return updated.slice(0, 100);
            });
          } else if (payload.eventType === "UPDATE") {
            const updatedPosition = payload.new as Position;
            setPositions((prev) =>
              prev.map((pos) =>
                pos.ts === updatedPosition.ts &&
                pos.symbol === updatedPosition.symbol &&
                pos.exchange === updatedPosition.exchange
                  ? updatedPosition
                  : pos
              )
            );
          }
        }
      )
      .subscribe((status, err) => {
        console.log(`[Realtime] positions subscription status:`, status, err);
      });

    return () => {
      console.log(`[Realtime] Unsubscribing from positions`);
      supabase.removeChannel(channel);
    };
  }, [runId]);

  return positions;
}
