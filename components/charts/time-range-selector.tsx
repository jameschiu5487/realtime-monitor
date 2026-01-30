"use client";

import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface TimeRange {
  start: Date;
  end: Date;
}

interface TimeRangeSelectorProps {
  dataStartTime: Date;
  dataEndTime: Date;
  onRangeChange: (range: TimeRange) => void;
  currentRange?: TimeRange;
}

const presetRanges = [
  { label: "15m", minutes: 15 },
  { label: "30m", minutes: 30 },
  { label: "1h", minutes: 60 },
  { label: "3h", minutes: 180 },
  { label: "6h", minutes: 360 },
  { label: "12h", minutes: 720 },
  { label: "1d", minutes: 1440 },
  { label: "3d", minutes: 4320 },
  { label: "1w", minutes: 10080 },
  { label: "2w", minutes: 20160 },
  { label: "1M", minutes: 43200 },
  { label: "3M", minutes: 129600 },
  { label: "6M", minutes: 259200 },
  { label: "1Y", minutes: 525600 },
] as const;

function formatDateTime(date: Date) {
  return date.toLocaleString("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).replace(",", "");
}

export function TimeRangeSelector({
  dataStartTime,
  dataEndTime,
  onRangeChange,
  currentRange,
}: TimeRangeSelectorProps) {
  const displayRange = currentRange || { start: dataStartTime, end: dataEndTime };

  // Calculate which preset is currently active (if any)
  const activePreset = useMemo(() => {
    if (!currentRange) return "All";

    const rangeMinutes = (currentRange.end.getTime() - currentRange.start.getTime()) / (60 * 1000);
    const isAtEnd = Math.abs(currentRange.end.getTime() - dataEndTime.getTime()) < 60000; // within 1 minute

    if (!isAtEnd) return null; // Custom range if not ending at latest data

    for (const preset of presetRanges) {
      if (Math.abs(rangeMinutes - preset.minutes) < 1) {
        return preset.label;
      }
    }

    // Check if it's the full range
    const fullRangeMinutes = (dataEndTime.getTime() - dataStartTime.getTime()) / (60 * 1000);
    if (Math.abs(rangeMinutes - fullRangeMinutes) < 1) {
      return "All";
    }

    return null; // Custom range
  }, [currentRange, dataStartTime, dataEndTime]);

  const handlePresetClick = (label: string) => {
    const preset = presetRanges.find((p) => p.label === label);
    if (!preset) return;

    const end = dataEndTime;
    const start = new Date(end.getTime() - preset.minutes * 60 * 1000);

    const finalStart = start < dataStartTime ? dataStartTime : start;
    onRangeChange({ start: finalStart, end });
  };

  const handleShowAll = () => {
    onRangeChange({ start: dataStartTime, end: dataEndTime });
  };

  // Calculate which presets are available based on data range
  const dataRangeMinutes = (dataEndTime.getTime() - dataStartTime.getTime()) / (60 * 1000);

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
      <div className="flex flex-wrap gap-1">
        {presetRanges.map((preset) => {
          const isAvailable = preset.minutes <= dataRangeMinutes;
          const isActive = activePreset === preset.label;
          return (
            <Button
              key={preset.label}
              variant={isActive ? "default" : "outline"}
              size="sm"
              className={cn(
                "h-7 px-2 text-xs sm:h-8 sm:px-3",
                !isAvailable && "opacity-50"
              )}
              onClick={() => handlePresetClick(preset.label)}
              disabled={!isAvailable}
            >
              {preset.label}
            </Button>
          );
        })}
        <Button
          variant={activePreset === "All" ? "default" : "outline"}
          size="sm"
          className="h-7 px-2 text-xs sm:h-8 sm:px-3"
          onClick={handleShowAll}
        >
          All
        </Button>
      </div>

      <div className="sm:ml-auto flex items-center gap-2">
        <div className="rounded-md bg-primary px-2 py-1 text-[10px] font-medium text-primary-foreground sm:px-3 sm:py-1.5 sm:text-xs overflow-x-auto whitespace-nowrap">
          {formatDateTime(displayRange.start)} - {formatDateTime(displayRange.end)}
        </div>
      </div>
    </div>
  );
}
