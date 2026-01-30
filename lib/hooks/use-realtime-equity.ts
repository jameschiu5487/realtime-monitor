"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { EquityCurve } from "@/lib/types/database";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";

export function useRealtimeEquity(runId: string, initialData: EquityCurve[]) {
  const [equityCurve, setEquityCurve] = useState<EquityCurve[]>(initialData);

  useEffect(() => {
    const supabase = createClient();

    const channel = supabase
      .channel(`equity-${runId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "equity_curve",
          filter: `run_id=eq.${runId}`,
        },
        (payload: RealtimePostgresChangesPayload<EquityCurve>) => {
          if (payload.new && "equity_id" in payload.new) {
            setEquityCurve((prev) => [...prev, payload.new as EquityCurve]);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [runId]);

  return equityCurve;
}
