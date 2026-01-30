import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Clock, DollarSign } from "lucide-react";
import type { Strategy, StrategyRun } from "@/lib/types/database";

interface RunDetailsHeaderProps {
  strategy: Strategy;
  run: StrategyRun;
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

export function RunDetailsHeader({ strategy, run }: RunDetailsHeaderProps) {
  return (
    <div className="flex items-start gap-3 sm:gap-6 pb-4 sm:pb-6 border-b">
      <Link href={`/strategies/${strategy.strategy_id}`}>
        <Button variant="ghost" size="icon" className="mt-0.5 h-8 w-8 sm:h-10 sm:w-10">
          <ArrowLeft className="h-4 w-4 sm:h-5 sm:w-5" />
        </Button>
      </Link>
      <div className="flex-1 min-w-0">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1 min-w-0">
            <h1 className="text-xl sm:text-3xl font-bold tracking-tight truncate">{strategy.name}</h1>
            <p className="text-xs sm:text-sm text-muted-foreground">
              Run started {new Date(run.start_time).toLocaleString("en-US", {
                year: "numeric",
                month: "numeric",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
                hour12: false,
              })}
            </p>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
            <Badge variant={modeVariants[run.mode]} className="text-xs sm:text-sm px-2 py-0.5 sm:px-3 sm:py-1">
              {run.mode}
            </Badge>
            <Badge variant={statusVariants[run.status]} className="text-xs sm:text-sm px-2 py-0.5 sm:px-3 sm:py-1">
              {run.status}
            </Badge>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-6 mt-3 sm:mt-4">
          <div className="flex items-center gap-1.5 sm:gap-2 text-xs sm:text-sm text-muted-foreground">
            <Clock className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            <span>Duration: {formatDuration(run.start_time, run.end_time)}</span>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2 text-xs sm:text-sm text-muted-foreground">
            <DollarSign className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            <span>Initial Capital: {formatCurrency(run.initial_capital)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
