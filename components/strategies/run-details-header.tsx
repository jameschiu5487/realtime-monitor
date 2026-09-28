import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Clock, DollarSign } from "lucide-react";
import type { Strategy, StrategyRun } from "@/lib/types/database";
import { formatDateTime } from "@/lib/time";

interface RunDetailsHeaderProps {
  strategy: Strategy;
  run: StrategyRun;
  initialCapitalOverride?: number;
}

const modeVariants: Record<StrategyRun["mode"], "default" | "secondary" | "outline"> = {
  live: "default",
  paper: "secondary",
  backtest: "outline",
};

const statusVariants: Record<
  StrategyRun["status"],
  "default" | "secondary" | "outline" | "destructive"
> = {
  running: "default",
  completed: "secondary",
  pending: "outline",
  failed: "destructive",
  cancelled: "outline",
};

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function formatDuration(startTime: string, endTime: string | null) {
  const start = new Date(startTime);
  const end = endTime ? new Date(endTime) : new Date();
  const diffMs = end.getTime() - start.getTime();

  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);

  return parts.length > 0 ? parts.join(" ") : "< 1m";
}

export function RunDetailsHeader({ strategy, run, initialCapitalOverride }: RunDetailsHeaderProps) {
  return (
    <div className="flex items-start gap-3 sm:gap-4 pb-4 border-b">
      <Link href={`/strategies/${strategy.strategy_id}`}>
        <Button variant="ghost" size="icon" className="mt-0.5 h-8 w-8 shrink-0">
          <ArrowLeft className="h-4 w-4" />
        </Button>
      </Link>
      <div className="flex-1 min-w-0">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1 min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight truncate">{strategy.name}</h1>
            <p className="text-sm text-muted-foreground">
              Started {formatDateTime(run.start_time, {
                month: "short",
                day: "numeric",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
                hour12: false,
              })}
            </p>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <Badge variant={modeVariants[run.mode]} className="text-xs px-2 py-0.5">
              {run.mode}
            </Badge>
            <Badge variant={statusVariants[run.status]} className="text-xs px-2 py-0.5">
              {run.status}
            </Badge>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 mt-3 text-sm text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" />
            <span className="font-mono">{formatDuration(run.start_time, run.end_time)}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <DollarSign className="h-3.5 w-3.5" />
            <span className="font-mono">{formatCurrency(initialCapitalOverride ?? run.initial_capital)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
