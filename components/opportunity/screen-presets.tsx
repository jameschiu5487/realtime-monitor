"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { X, Plus, Check } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useOpportunityScreens } from "@/lib/hooks/use-opportunity-screens";
import {
  formatCompactUsd,
  isScreenActive,
  type ScreenThresholds,
} from "@/lib/opportunity-screen";

interface ScreenPresetsProps {
  current: ScreenThresholds;
  onApply: (thresholds: ScreenThresholds) => void;
}

/** One-line summary of what a preset actually screens on, for the chip tooltip. */
function describe(t: ScreenThresholds): string {
  const parts: string[] = [];
  if (t.maxAbsBasisBps !== null) parts.push(`|basis| ≤ ${t.maxAbsBasisBps}`);
  if (t.minDailyVolume !== null) parts.push(`vol ≥ ${formatCompactUsd(t.minDailyVolume)}`);
  if (t.minSpreadBps !== null) parts.push(`spread ≥ ${t.minSpreadBps}`);
  return parts.length > 0 ? parts.join(" · ") : "no criteria";
}

function sameThresholds(a: ScreenThresholds, b: ScreenThresholds): boolean {
  return (
    a.maxAbsBasisBps === b.maxAbsBasisBps &&
    a.minDailyVolume === b.minDailyVolume &&
    a.minSpreadBps === b.minSpreadBps
  );
}

export function ScreenPresets({ current, onApply }: ScreenPresetsProps) {
  const { screens, loading, save, remove } = useOpportunityScreens();
  const [naming, setNaming] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [busy, setBusy] = useState(false);

  const handleSave = async () => {
    const name = nameInput.trim();
    if (!name) return;
    setBusy(true);
    // Saving over an existing name replaces it, so say which happened.
    const overwriting = screens.some((s) => s.name === name);
    const ok = await save(name, current);
    setBusy(false);
    if (ok) {
      toast.success(overwriting ? `已更新「${name}」` : `已儲存「${name}」`);
      setNaming(false);
      setNameInput("");
    } else {
      toast.error("儲存失敗");
    }
  };

  const handleRemove = async (id: string, name: string) => {
    if (!(await remove(id))) {
      toast.error("刪除失敗");
      return;
    }
    toast.success(`已刪除「${name}」`);
  };

  if (loading && screens.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-muted-foreground whitespace-nowrap">Saved:</span>

      {screens.length === 0 && !naming && (
        <span className="text-sm text-muted-foreground/60">
          none yet — set thresholds above, then save them
        </span>
      )}

      {screens.map((preset) => {
        const active = sameThresholds(preset.thresholds, current);
        return (
          <span
            key={preset.id}
            className={cn(
              "inline-flex items-center rounded-full border text-sm transition-colors",
              active ? "border-green-500 bg-green-500/10" : "hover:bg-muted",
            )}
          >
            <button
              type="button"
              className="py-1 pl-3 pr-1"
              title={describe(preset.thresholds)}
              onClick={() => onApply(preset.thresholds)}
            >
              {preset.name}
            </button>
            <button
              type="button"
              className="py-1 pl-1 pr-2 text-muted-foreground/60 hover:text-red-500"
              title={`Delete ${preset.name}`}
              aria-label={`Delete ${preset.name}`}
              onClick={() => handleRemove(preset.id, preset.name)}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        );
      })}

      {naming ? (
        <span className="inline-flex items-center gap-1">
          <Input
            autoFocus
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSave();
              if (e.key === "Escape") {
                setNaming(false);
                setNameInput("");
              }
            }}
            placeholder="preset name"
            className="h-8 w-36"
          />
          <Button size="sm" variant="ghost" onClick={handleSave} disabled={busy || !nameInput.trim()}>
            <Check className="h-4 w-4" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setNaming(false);
              setNameInput("");
            }}
          >
            <X className="h-4 w-4" />
          </Button>
        </span>
      ) : (
        <Button
          size="sm"
          variant="outline"
          className="h-7"
          onClick={() => setNaming(true)}
          // Saving an empty screen would create a preset that screens on
          // nothing, which does the same as having no preset selected.
          disabled={!isScreenActive(current)}
          title={
            isScreenActive(current)
              ? "Save the current thresholds"
              : "Set at least one threshold first"
          }
        >
          <Plus className="h-3 w-3 mr-1" />
          Save
        </Button>
      )}
    </div>
  );
}
