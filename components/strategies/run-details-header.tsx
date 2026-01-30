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
    <div className="flex items-start gap-6 pb-6 border-b">
      <Link href={`/strategies/${strategy.strategy_id}`}>
        <Button variant="ghost" size="icon" className="mt-1">
          <ArrowLeft className="h-5 w-5" />
        </Button>
      </Link>
      <div className="flex-1">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <h1 className="text-3xl font-bold tracking-tight">{strategy.name}</h1>
            <p className="text-muted-foreground">
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
          <div className="flex items-center gap-2">
            <Badge variant={modeVariants[run.mode]} className="text-sm px-3 py-1">
              {run.mode}
            </Badge>
            <Badge variant={statusVariants[run.status]} className="text-sm px-3 py-1">
              {run.status}
            </Badge>
          </div>
        </div>

        <div className="flex items-center gap-6 mt-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Clock className="h-4 w-4" />
            <span>Duration: {formatDuration(run.start_time, run.end_time)}</span>
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <DollarSign className="h-4 w-4" />
            <span>Initial Capital: {formatCurrency(run.initial_capital)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
