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

interface StrategyRunsTableProps {
  runs: StrategyRun[];
  strategyId: string;
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

function formatDateTime(dateString: string) {
  const date = new Date(dateString);
  return date.toLocaleString("en-US", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
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

export function StrategyRunsTable({ runs, strategyId }: StrategyRunsTableProps) {
  if (runs.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No runs found for this strategy.
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Mode</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Start Time</TableHead>
          <TableHead>End Time</TableHead>
          <TableHead className="text-right">Initial Capital</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {runs.map((run) => (
          <TableRow key={run.run_id}>
            <TableCell>
              <Badge variant={modeVariants[run.mode]}>{run.mode}</Badge>
            </TableCell>
            <TableCell>
              <Badge variant={statusVariants[run.status]}>{run.status}</Badge>
            </TableCell>
            <TableCell>{formatDateTime(run.start_time)}</TableCell>
            <TableCell>
              {run.end_time ? formatDateTime(run.end_time) : "-"}
            </TableCell>
            <TableCell className="text-right">
              {formatCurrency(run.initial_capital)}
            </TableCell>
            <TableCell className="text-right">
              <Link href={`/strategies/${strategyId}/runs/${run.run_id}`}>
                <Button variant="ghost" size="sm">
                  View <ArrowRight className="ml-1 h-4 w-4" />
                </Button>
              </Link>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
