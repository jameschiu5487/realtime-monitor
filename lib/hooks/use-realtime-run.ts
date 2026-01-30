"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { StrategyRun } from "@/lib/types/database";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";

export function useRealtimeRun(runId: string, initialRun: StrategyRun) {
  const [run, setRun] = useState<StrategyRun>(initialRun);

  useEffect(() => {
    const supabase = createClient();

    const channel = supabase
      .channel(`run-${runId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "strategy_runs",
          filter: `run_id=eq.${runId}`,
        },
        (payload: RealtimePostgresChangesPayload<StrategyRun>) => {
          if (payload.new && "run_id" in payload.new) {
            setRun(payload.new as StrategyRun);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [runId]);

  return run;
}
