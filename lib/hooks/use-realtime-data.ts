"use client";

import { useEffect, useState, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import type {
  EquityCurve,
  PnlSeries,
  CombinedTrade,
  Position,
} from "@/lib/types/database";

// Return type for hooks that includes loading state
interface RealtimeDataResult<T> {
  data: T[];
  isFreshDataLoaded: boolean;
}

// Generic hook for realtime subscriptions with immediate fresh data fetch
function useRealtimeSubscription<T extends Record<string, unknown>>(
  table: string,
  runId: string,
  initialData: T[],
  primaryKey: string,
  sortKey: string = "ts",
  sortDirection: "asc" | "desc" = "asc"
): RealtimeDataResult<T> {
  const [data, setData] = useState<T[]>(initialData);
  const [isFreshDataLoaded, setIsFreshDataLoaded] = useState(false);
  const hasFetchedRef = useRef(false);

  // Fetch fresh data immediately on mount
  useEffect(() => {
    if (hasFetchedRef.current) return;
    hasFetchedRef.current = true;

    const fetchFreshData = async () => {
      const supabase = createClient();
      console.log(`[Realtime] Fetching fresh ${table} data for run ${runId}`);

      // Fetch in descending order to get the LATEST records first (Supabase default limit is 1000)
      // Then reverse on client side if we need ascending order
      const { data: freshData, error } = await supabase
        .from(table)
        .select("*")
        .eq("run_id", runId)
        .order(sortKey, { ascending: false })
        .limit(5000); // Increase limit to get more data

      if (error) {
        console.error(`[Realtime] Error fetching ${table}:`, error);
        setIsFreshDataLoaded(true); // Mark as loaded even on error
        return;
      }

      if (freshData) {
        console.log(`[Realtime] Got ${freshData.length} fresh ${table} records`);
        // Sort according to the desired direction
        const sortedData = sortDirection === "asc"
          ? [...freshData].reverse()
          : freshData;
        setData(sortedData as T[]);
      }
      setIsFreshDataLoaded(true);
    };

    fetchFreshData();
  }, [table, runId, sortKey, sortDirection]);

  // Subscribe to realtime updates
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

  return { data, isFreshDataLoaded };
}

// Hook for equity curve data
export function useRealtimeEquityCurve(runId: string, initialData: EquityCurve[]): RealtimeDataResult<EquityCurve> {
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
export function useRealtimePnlSeries(runId: string, initialData: PnlSeries[]): RealtimeDataResult<PnlSeries> {
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
export function useRealtimeCombinedTrades(runId: string, initialData: CombinedTrade[]): RealtimeDataResult<CombinedTrade> {
  return useRealtimeSubscription<CombinedTrade>(
    "combined_trades",
    runId,
    initialData,
    "combined_trade_id",
    "ts",
    "asc"
  );
}

// Extended result type for positions that includes last update time
interface PositionsDataResult extends RealtimeDataResult<Position> {
  lastInsertTime: number; // Timestamp of last INSERT event (Date.now() when received)
}

// Hook for positions data (realtime positions need special handling)
export function useRealtimePositions(runId: string, initialData: Position[]): PositionsDataResult {
  const [positions, setPositions] = useState<Position[]>(initialData);
  const [isFreshDataLoaded, setIsFreshDataLoaded] = useState(false);
  const [lastInsertTime, setLastInsertTime] = useState<number>(Date.now());
  const hasFetchedRef = useRef(false);

  // Fetch fresh data immediately on mount
  useEffect(() => {
    if (hasFetchedRef.current) return;
    hasFetchedRef.current = true;

    const fetchFreshData = async () => {
      const supabase = createClient();
      console.log(`[Realtime] Fetching fresh positions data for run ${runId}`);

      const { data: freshData, error } = await supabase
        .from("positions")
        .select("*")
        .eq("run_id", runId)
        .order("ts", { ascending: false })
        .limit(100);

      if (error) {
        console.error(`[Realtime] Error fetching positions:`, error);
        setIsFreshDataLoaded(true);
        return;
      }

      if (freshData) {
        console.log(`[Realtime] Got ${freshData.length} fresh positions records`);
        setPositions(freshData as Position[]);
        // Set lastInsertTime to now when we load initial data
        setLastInsertTime(Date.now());
      }
      setIsFreshDataLoaded(true);
    };

    fetchFreshData();
  }, [runId]);

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

          if (payload.eventType === "INSERT" || payload.eventType === "UPDATE") {
            const newPosition = payload.new as Position;
            console.log(`[Realtime] Adding position: ${newPosition.symbol} ${newPosition.exchange} ts=${newPosition.ts}`);

            // Update lastInsertTime to NOW (when we received the event)
            setLastInsertTime(Date.now());

            setPositions((prev) => {
              // Add new position and merge with existing
              const positionMap = new Map<string, Position>();

              // Add existing positions
              prev.forEach((pos) => {
                const key = `${pos.symbol}-${pos.exchange}-${pos.ts}`;
                positionMap.set(key, pos);
              });

              // Add new position
              const newKey = `${newPosition.symbol}-${newPosition.exchange}-${newPosition.ts}`;
              positionMap.set(newKey, newPosition);

              // Convert back to array, sort by ts desc, and limit
              const result = Array.from(positionMap.values())
                .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())
                .slice(0, 100);

              console.log(`[Realtime] Positions state updated, now ${result.length} positions, latest ts:`, result[0]?.ts);
              return result;
            });
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

  return { data: positions, isFreshDataLoaded, lastInsertTime };
}
