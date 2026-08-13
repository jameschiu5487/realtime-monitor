"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import type { Opportunity } from "@/lib/types/opportunity";
import { volumeKey, type VolumeEntry, type VolumePair } from "@/lib/services/volume-fetcher";

interface UseVolumesResult {
  /** Keyed by `${exchange}:${symbol}` — see volumeKey(). */
  volumes: Record<string, VolumeEntry>;
  loading: boolean;
}

/** Matches MAX_PAIRS_PER_REQUEST on the route; larger chunks are truncated. */
const CHUNK_SIZE = 150;
/** How many chunk requests are allowed in flight at once. */
const CHUNK_CONCURRENCY = 3;
/** Volume moves slowly; no reason to re-pull it on the 30s opportunity poll. */
const REFRESH_MS = 300_000;

function uniquePairs(opportunities: Opportunity[]): VolumePair[] {
  const seen = new Map<string, VolumePair>();
  for (const opp of opportunities) {
    for (const exchange of [opp.exchange_a, opp.exchange_b]) {
      const key = volumeKey(exchange, opp.symbol);
      if (!seen.has(key)) seen.set(key, { exchange, symbol: opp.symbol });
    }
  }
  return Array.from(seen.values());
}

export function useVolumes(opportunities: Opportunity[]): UseVolumesResult {
  const [volumes, setVolumes] = useState<Record<string, VolumeEntry>>({});
  const [loading, setLoading] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);

  const pairs = useMemo(() => uniquePairs(opportunities), [opportunities]);

  // The opportunity poll hands back a fresh array every 30 seconds. Refetching
  // on identity would restart 740 upstream calls each time, so key the effect
  // on which pairs are present rather than on the array itself.
  const signature = useMemo(
    () =>
      pairs
        .map((p) => volumeKey(p.exchange, p.symbol))
        .sort()
        .join(","),
    [pairs],
  );

  const pairsRef = useRef(pairs);
  pairsRef.current = pairs;

  useEffect(() => {
    const timer = setInterval(() => setRefreshTick((t) => t + 1), REFRESH_MS);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const current = pairsRef.current;
    if (current.length === 0) {
      setVolumes({});
      return;
    }

    let cancelled = false;
    setLoading(true);

    const chunks: VolumePair[][] = [];
    for (let i = 0; i < current.length; i += CHUNK_SIZE) {
      chunks.push(current.slice(i, i + CHUNK_SIZE));
    }

    const run = async () => {
      let cursor = 0;
      const workers = Array.from(
        { length: Math.min(CHUNK_CONCURRENCY, chunks.length) },
        async () => {
          while (cursor < chunks.length && !cancelled) {
            const chunk = chunks[cursor++];
            try {
              const res = await fetch("/api/volume", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ pairs: chunk }),
              });
              if (!res.ok) continue;
              const data = (await res.json()) as {
                volumes?: Record<string, VolumeEntry>;
              };
              if (cancelled || !data.volumes) continue;
              // Merge as each chunk lands so the table fills in progressively.
              setVolumes((prev) => ({ ...prev, ...data.volumes }));
            } catch {
              // A failed chunk just leaves those rows without a volume.
            }
          }
        },
      );
      await Promise.all(workers);
      if (!cancelled) setLoading(false);
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [signature, refreshTick]);

  return { volumes, loading };
}
