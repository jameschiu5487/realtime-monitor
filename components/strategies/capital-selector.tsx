"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";

import type { CapitalGroup } from "@/lib/capital-groups";

interface CapitalSelectorProps {
  options: CapitalGroup[];
  /** Currently selected capital, or null when showing every run. */
  selected: number | null;
}

/**
 * Picks which initial-capital group the combined view aggregates.
 *
 * Runs that share an initial_capital are the same account restarted — they run
 * one after another, not side by side — so combining across groups mixes
 * different capital bases and makes the return percentage meaningless. The
 * selection lives in the URL because the page filters runs server-side, which
 * narrows the realtime subscriptions too, not just the rows fetched.
 */
export function CapitalSelector({ options, selected }: CapitalSelectorProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Only one group, and no "all" to compare against — nothing to choose.
  if (options.length <= 1) return null;

  const select = (capital: number | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (capital === null) params.set("capital", "all");
    else params.set("capital", String(capital));
    router.push(`${pathname}?${params.toString()}`);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-muted-foreground whitespace-nowrap">Capital:</span>
      <Button
        variant={selected === null ? "default" : "outline"}
        size="sm"
        className="h-7"
        onClick={() => select(null)}
        title="Every run, regardless of capital base"
      >
        All
      </Button>
      {options.map((opt) => (
        <Button
          key={opt.capital}
          variant={selected === opt.capital ? "default" : "outline"}
          size="sm"
          className="h-7"
          onClick={() => select(opt.capital)}
          title={`${opt.runCount} run${opt.runCount === 1 ? "" : "s"} · ${opt.span}`}
        >
          ${opt.capital.toLocaleString()}
          <span className="ml-1 text-xs opacity-60">×{opt.runCount}</span>
        </Button>
      ))}
    </div>
  );
}
