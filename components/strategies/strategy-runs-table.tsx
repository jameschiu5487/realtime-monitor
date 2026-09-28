"use client";

import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import type { StrategyRun } from "@/lib/types/database";
import { formatDateTime as taipeiDateTime } from "@/lib/time";

interface StrategyRunsTableProps {
  runs: StrategyRun[];
  strategyId: string;
  shareRatio?: number;
}

const modeVariants: Record<
  StrategyRun["mode"],
  "default" | "secondary" | "outline"
> = {
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

function formatDateTime(dateString: string) {
  const date = new Date(dateString);
  return taipeiDateTime(date, {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

export function StrategyRunsTable({
  runs,
  strategyId,
  shareRatio = 1,
}: StrategyRunsTableProps) {
  if (runs.length === 0) {
    return (
      <div className="text-center py-6 sm:py-8 text-sm text-muted-foreground px-3">
        No runs found for this strategy.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <Table className="min-w-[540px]">
        <TableHeader>
          <TableRow>
            <TableHead className="w-[70px]">Mode</TableHead>
            <TableHead className="w-[80px]">Status</TableHead>
            <TableHead>Start Time</TableHead>
            <TableHead className="hidden sm:table-cell">End Time</TableHead>
            <TableHead className="text-right">Capital</TableHead>
            <TableHead className="text-right w-[70px]"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {runs.map((run) => (
            <TableRow key={run.run_id}>
              <TableCell className="py-2.5">
                <Badge
                  variant={modeVariants[run.mode]}
                  className="text-xs px-1.5 py-0"
                >
                  {run.mode}
                </Badge>
              </TableCell>
              <TableCell className="py-2.5">
                <Badge
                  variant={statusVariants[run.status]}
                  className="text-xs px-1.5 py-0"
                >
                  {run.status}
                </Badge>
              </TableCell>
              <TableCell className="py-2.5 text-sm font-mono">
                {formatDateTime(run.start_time)}
              </TableCell>
              <TableCell className="py-2.5 text-sm font-mono hidden sm:table-cell">
                {run.end_time ? formatDateTime(run.end_time) : "-"}
              </TableCell>
              <TableCell className="py-2.5 text-right text-sm font-mono">
                {formatCurrency(run.initial_capital * shareRatio)}
              </TableCell>
              <TableCell className="py-2.5 text-right">
                <Link
                  href={`/strategies/${strategyId}/runs/${run.run_id}`}
                >
                  <Button variant="ghost" size="sm" className="h-7 px-2">
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Button>
                </Link>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
