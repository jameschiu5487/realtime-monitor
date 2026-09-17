"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  PnLBreakdownChart,
  type PnLBreakdownDataPoint,
} from "@/components/charts/pnl-breakdown-chart";
import { createClient } from "@/lib/supabase/client";
import type { StrategyRun, PnlSeries } from "@/lib/types/database";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";

// A "pod" is one long-lived deployment slot of a fleet strategy (e.g. one
// symbol of the smallcap16 sniper). Pods are identified by the run's `notes`
// (kore writes its pod_name there); the latest run per pod represents it.
export interface FleetPod {
  podName: string;
  run: StrategyRun;
}

interface FleetContentProps {
  strategyId: string;
  pods: FleetPod[];
  /** pnl_series rows for the pods' latest runs (recent window, ts ascending) */
  initialPnlSeries: PnlSeries[];
  shareRatio: number;
}

// "kore-sniper-zrousdt-smallcap16-dryrun" -> "zrousdt"
function podSymbol(podName: string): string {
  const m = podName.match(/^kore-sniper-([a-z0-9]+)-/);
  return m ? m[1] : podName;
}

// A running pod whose freshest datapoint is older than this is flagged stale:
// kore flushes pnl_series every minute, so 5 minutes means the process (or its
// Supabase link) is gone even if the run row still says "running".
const STALE_MS = 5 * 60 * 1000;

export function FleetContent({
  strategyId,
  pods,
  initialPnlSeries,
  shareRatio,
}: FleetContentProps) {
  const [pnlSeries, setPnlSeries] = useState<PnlSeries[]>(initialPnlSeries);
  const runIds = useMemo(() => pods.map((p) => p.run.run_id), [pods]);

  useEffect(() => {
    if (runIds.length === 0) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`fleet-pnl-${strategyId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "pnl_series",
          filter: `run_id=in.(${runIds.join(",")})`,
        },
        (payload: RealtimePostgresChangesPayload<PnlSeries>) => {
          if (payload.new && "run_id" in payload.new) {
            setPnlSeries((prev) => [...prev, payload.new as PnlSeries]);
          }
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [strategyId, runIds]);

  const now = Date.now();

  // Latest datapoint per run drives the tiles.
  const latestByRun = useMemo(() => {
    const map = new Map<string, PnlSeries>();
    for (const row of pnlSeries) {
      const prev = map.get(row.run_id);
      if (!prev || new Date(row.ts).getTime() > new Date(prev.ts).getTime()) {
        map.set(row.run_id, row);
      }
    }
    return map;
  }, [pnlSeries]);

  // Fleet aggregate series: sum each pod's most recent value per minute
  // bucket, carrying the last known value forward so pods reporting on
  // slightly different seconds still sum correctly.
  const aggregateSeries: PnLBreakdownDataPoint[] = useMemo(() => {
    if (pnlSeries.length === 0) return [];
    const sorted = [...pnlSeries].sort(
      (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime()
    );
    const lastValue = new Map<string, PnlSeries>();
    const buckets = new Map<number, PnLBreakdownDataPoint>();
    for (const row of sorted) {
      lastValue.set(row.run_id, row);
      const bucket = Math.floor(new Date(row.ts).getTime() / 60_000) * 60_000;
      let total_pnl = 0;
      let funding_pnl = 0;
      let price_pnl = 0;
      let total_fee = 0;
      for (const v of lastValue.values()) {
        total_pnl += v.total_pnl ?? 0;
        funding_pnl += v.total_funding_pnl ?? 0;
        price_pnl += v.total_price_pnl ?? 0;
        total_fee += v.total_fee ?? 0;
      }
      buckets.set(bucket, {
        time: new Date(bucket).toISOString(),
        total_pnl: total_pnl * shareRatio,
        funding_pnl: funding_pnl * shareRatio,
        price_pnl: price_pnl * shareRatio,
        total_fee: total_fee * shareRatio,
      });
    }
    return [...buckets.values()];
  }, [pnlSeries, shareRatio]);

  const runningPods = pods.filter((p) => p.run.status === "running");
  const stalePods = runningPods.filter((p) => {
    const latest = latestByRun.get(p.run.run_id);
    return !latest || now - new Date(latest.ts).getTime() > STALE_MS;
  });
  const fleetPnl = pods.reduce(
    (sum, p) => sum + (latestByRun.get(p.run.run_id)?.total_pnl ?? 0),
    0
  );
  const fleetCapital = pods.reduce(
    (sum, p) => sum + (p.run.initial_capital || 0),
    0
  );

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Summary */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
        <SummaryCard label="Pods" value={`${pods.length}`} />
        <SummaryCard
          label="Running"
          value={`${runningPods.length}`}
          tone={
            stalePods.length > 0
              ? "warn"
              : runningPods.length === pods.length
                ? "good"
                : undefined
          }
          hint={stalePods.length > 0 ? `${stalePods.length} stale` : undefined}
        />
        <SummaryCard
          label="Capital"
          value={`$${(fleetCapital * shareRatio).toLocaleString()}`}
        />
        <SummaryCard
          label="Fleet PnL"
          value={`$${(fleetPnl * shareRatio).toFixed(2)}`}
          tone={fleetPnl > 0 ? "good" : fleetPnl < 0 ? "bad" : undefined}
        />
      </div>

      {/* Pod grid */}
      <Card>
        <CardHeader className="px-3 sm:px-6">
          <CardTitle className="text-sm sm:text-base font-medium">
            Pods
          </CardTitle>
        </CardHeader>
        <CardContent className="px-3 sm:px-6">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5 sm:gap-3">
            {pods.map((pod) => {
              const latest = latestByRun.get(pod.run.run_id);
              const isRunning = pod.run.status === "running";
              const isStale =
                isRunning &&
                (!latest || now - new Date(latest.ts).getTime() > STALE_MS);
              const pnl = (latest?.total_pnl ?? 0) * shareRatio;
              return (
                <Link
                  key={pod.podName}
                  href={`/strategies/${strategyId}/runs/${pod.run.run_id}`}
                >
                  <div className="rounded-lg border p-3 transition-colors hover:bg-accent/50">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-sm font-semibold truncate">
                        {podSymbol(pod.podName)}
                      </span>
                      <span
                        className={`h-2 w-2 shrink-0 rounded-full ${
                          isStale
                            ? "bg-yellow-500"
                            : isRunning
                              ? "bg-green-500"
                              : "bg-muted-foreground/40"
                        }`}
                        title={
                          isStale ? "stale" : isRunning ? "running" : pod.run.status
                        }
                      />
                    </div>
                    <div
                      className={`mt-1.5 font-mono text-sm ${
                        pnl > 0
                          ? "text-green-600 dark:text-green-500"
                          : pnl < 0
                            ? "text-red-600 dark:text-red-500"
                            : "text-muted-foreground"
                      }`}
                    >
                      {pnl >= 0 ? "+" : ""}
                      {pnl.toFixed(2)}
                    </div>
                    <div className="mt-1 text-[10px] text-muted-foreground font-mono">
                      {latest
                        ? new Date(latest.ts).toLocaleTimeString("en-US", {
                            hour12: false,
                          })
                        : "no data"}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Aggregate PnL */}
      {aggregateSeries.length > 1 && (
        <Card>
          <CardHeader className="px-3 sm:px-6">
            <CardTitle className="text-sm sm:text-base font-medium">
              Fleet PnL Breakdown
            </CardTitle>
          </CardHeader>
          <CardContent className="px-3 sm:px-6">
            <PnLBreakdownChart data={aggregateSeries} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "good" | "bad" | "warn";
}) {
  return (
    <Card>
      <CardContent className="p-3 sm:p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p
          className={`mt-1 font-mono text-lg font-semibold ${
            tone === "good"
              ? "text-green-600 dark:text-green-500"
              : tone === "bad"
                ? "text-red-600 dark:text-red-500"
                : tone === "warn"
                  ? "text-yellow-600 dark:text-yellow-500"
                  : ""
          }`}
        >
          {value}
        </p>
        {hint && (
          <Badge variant="outline" className="mt-1 text-[10px] text-yellow-600">
            {hint}
          </Badge>
        )}
      </CardContent>
    </Card>
  );
}
