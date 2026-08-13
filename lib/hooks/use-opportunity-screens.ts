"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { untypedWrites } from "@/lib/supabase/untyped";
import type { ScreenThresholds } from "@/lib/opportunity-screen";

export interface SavedScreen {
  id: string;
  name: string;
  thresholds: ScreenThresholds;
}

interface UseOpportunityScreensResult {
  screens: SavedScreen[];
  loading: boolean;
  error: string | null;
  /** Saves under `name`, overwriting any preset the user already has by that name. */
  save: (name: string, thresholds: ScreenThresholds) => Promise<boolean>;
  remove: (id: string) => Promise<boolean>;
}

/** Postgres numeric can arrive as a string; keep null distinct from 0. */
function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

interface ScreenRow {
  id: string;
  name: string;
  max_abs_basis_bps: unknown;
  min_daily_volume: unknown;
  min_spread_bps: unknown;
}

function toSavedScreen(row: ScreenRow): SavedScreen {
  return {
    id: row.id,
    name: row.name,
    thresholds: {
      maxAbsBasisBps: toNumberOrNull(row.max_abs_basis_bps),
      minDailyVolume: toNumberOrNull(row.min_daily_volume),
      minSpreadBps: toNumberOrNull(row.min_spread_bps),
    },
  };
}

export function useOpportunityScreens(): UseOpportunityScreensResult {
  const [screens, setScreens] = useState<SavedScreen[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data, error: loadError } = await supabase
      .from("opportunity_screens")
      .select("id, name, max_abs_basis_bps, min_daily_volume, min_spread_bps")
      .order("created_at", { ascending: true });

    if (loadError) {
      setError(loadError.message);
      setLoading(false);
      return;
    }
    setScreens((data ?? []).map(toSavedScreen));
    setError(null);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = useCallback(
    async (name: string, thresholds: ScreenThresholds) => {
      const trimmed = name.trim();
      if (!trimmed) return false;

      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setError("Not signed in");
        return false;
      }

      // Writes go through the untyped client — see lib/supabase/untyped.ts.
      // onConflict matches the (user_id, name) unique constraint, so saving
      // under an existing name updates it instead of erroring.
      const { error: saveError } = await untypedWrites(supabase)
        .from("opportunity_screens")
        .upsert(
          {
            user_id: user.id,
            name: trimmed,
            max_abs_basis_bps: thresholds.maxAbsBasisBps,
            min_daily_volume: thresholds.minDailyVolume,
            min_spread_bps: thresholds.minSpreadBps,
          },
          { onConflict: "user_id,name" },
        );

      if (saveError) {
        setError(saveError.message);
        return false;
      }
      await load();
      return true;
    },
    [load],
  );

  const remove = useCallback(
    async (id: string) => {
      const supabase = createClient();
      const { error: deleteError } = await untypedWrites(supabase)
        .from("opportunity_screens")
        .delete()
        .eq("id", id);

      if (deleteError) {
        setError(deleteError.message);
        return false;
      }
      setScreens((prev) => prev.filter((s) => s.id !== id));
      return true;
    },
    [],
  );

  return { screens, loading, error, save, remove };
}
