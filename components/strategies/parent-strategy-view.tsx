import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ArrowLeft, ArrowRight, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EquityCurveChart } from "@/components/charts/equity-curve-chart";
import { DrawdownChart } from "@/components/charts/drawdown-chart";
import { PerformanceStats } from "@/components/charts/performance-stats";
import { AggregatePnlChart } from "@/components/strategies/aggregate-pnl-chart";
import { bucketedSince, getCombinedTrades, getEquityCurve } from "@/lib/overview-queries";
import { buildCombinedEquityCurve } from "@/lib/utils/equity";
import {
  currentPositions,
  equityByRun,
  isParentBookMode,
  scaleCombinedTrades,
  sumPnlSeries,
  summarizeBook,
  type ParentBook,
  type ParentPosition,
} from "@/lib/parent-strategy";
import { cn } from "@/lib/utils";
import type { Position, Strategy, StrategyRun } from "@/lib/types/database";

/** Window for the aggregate charts. Book returns are still measured from initial_capital. */
const WINDOW_DAYS = 30;
const POSITION_ROWS_PER_RUN = 500;

type BookRun = Pick<
  StrategyRun,
  "run_id" | "strategy_id" | "mode" | "status" | "start_time" | "initial_capital"
>;

interface ParentStrategyViewProps {
  supabase: SupabaseClient;
  parent: Strategy;
  /** Children the viewer has user_strategy_access to. */
  childStrategies: Strategy[];
  /** Viewer's share_ratio per child strategy_id. */
  shareRatioByChild: Record<string, number>;
  includePaper: boolean;
}

function money(value: number | null, signed = false) {
  if (value === null) return "—";
  const abs = `$${Math.abs(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
  if (value < 0) return `-${abs}`;
  return signed && value > 0 ? `+${abs}` : abs;
}

function pct(value: number | null, signed = false) {
  if (value === null) return "—";
  const s = `${Math.abs(value).toFixed(2)}%`;
  if (value < 0) return `-${s}`;
  return signed && value > 0 ? `+${s}` : s;
}

function tone(value: number | null) {
  if (value === null || value === 0) return "";
  return value > 0
    ? "text-emerald-600 dark:text-emerald-400"
    : "text-red-600 dark:text-red-400";
}

/**
 * Aggregate view for a parent strategy: the sum of its children's current
 * books (running live/realtime runs, optionally paper too).
 */
export async function ParentStrategyView({
  supabase,
  parent,
  childStrategies: children,
  shareRatioByChild,
  includePaper,
}: ParentStrategyViewProps) {
  const childIds = children.map((c) => c.strategy_id);
  const childName = new Map(children.map((c) => [c.strategy_id, c.name]));

  let runs: BookRun[] = [];
  if (childIds.length > 0) {
    const { data, error } = await supabase
      .from("strategy_runs")
      .select("run_id, strategy_id, mode, status, start_time, initial_capital")
      .in("strategy_id", childIds)
      .eq("status", "running")
      .order("start_time", { ascending: true });
    if (error) console.error("Error fetching child runs:", error);
    runs = ((data ?? []) as unknown as BookRun[]).filter((r) =>
      isParentBookMode(r.mode as string, includePaper)
    );
  }

  const runIds = runs.map((r) => r.run_id);
  const ratioByRun: Record<string, number> = {};
  for (const r of runs) ratioByRun[r.run_id] = shareRatioByChild[r.strategy_id] ?? 1;

  const since = bucketedSince(WINDOW_DAYS);
  const [equityRows, combinedTrades, positionRows] = await Promise.all([
    getEquityCurve(supabase, runIds, since, bucketedSince(1)),
    getCombinedTrades(supabase, runIds, since),
    Promise.all(
      runIds.map(async (runId) => {
        const { data, error } = await supabase
          .from("positions")
          .select("*")
          .eq("run_id", runId)
          .order("ts", { ascending: false })
          .limit(POSITION_ROWS_PER_RUN);
        if (error) console.error("Error fetching positions:", error);
        return (data ?? []) as Position[];
      })
    ),
  ]);

  const seriesByRun = equityByRun(equityRows);

  const positions: ParentPosition[] = [];
  const books: ParentBook[] = runs.map((run, i) => {
    const name = childName.get(run.strategy_id) ?? "Unknown";
    const ratio = ratioByRun[run.run_id];
    const held = currentPositions(positionRows[i], {
      runId: run.run_id,
      childId: run.strategy_id,
      childName: name,
      mode: run.mode as string,
      shareRatio: ratio,
    });
    positions.push(...held);
    return summarizeBook(run, name, ratio, seriesByRun.get(run.run_id) ?? [], held.length);
  });
  positions.sort((a, b) => b.notional - a.notional);

  // Equity is summed only where every book has data (buildCombinedEquityCurve
  // starts at the latest first point), so a book coming online later shows up
  // as a new starting point rather than as a deposit-shaped jump. PnL has no
  // such problem and starts at the earliest book.
  const aggregate = buildCombinedEquityCurve(seriesByRun, ratioByRun);
  const pnlSeries = sumPnlSeries(seriesByRun, ratioByRun);
  const aggregateStart = aggregate.length > 0 ? new Date(aggregate[0].ts).getTime() : 0;
  const statsTrades = scaleCombinedTrades(
    combinedTrades.filter((t) => new Date(t.ts).getTime() >= aggregateStart),
    ratioByRun
  );

  const totalEquity = books.reduce((s, b) => s + (b.equity ?? 0), 0);
  const totalPnl = books.reduce((s, b) => s + (b.pnl ?? 0), 0);
  const totalInitial = books.reduce((s, b) => s + b.initialCapital, 0);
  const totalUpnl = positions.reduce((s, p) => s + p.unrealizedPnl, 0);
  const totalNotional = positions.reduce((s, p) => s + p.notional, 0);

  const booksByChild = new Map<string, ParentBook[]>();
  for (const b of books) {
    booksByChild.set(b.childId, [...(booksByChild.get(b.childId) ?? []), b]);
  }

  const modeLabel = includePaper ? "live + paper" : "live";

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex items-start gap-3 sm:gap-4 pb-4 border-b">
        <Link href="/strategies">
          <Button variant="ghost" size="icon" className="mt-0.5 h-8 w-8 shrink-0">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-1">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Layers className="h-5 w-5 text-primary shrink-0" />
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight truncate">
                  {parent.name}
                </h1>
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                {parent.description ??
                  `Aggregate of ${children.length} child ${children.length === 1 ? "strategy" : "strategies"}`}
              </p>
            </div>
            <span className="text-xs font-mono text-muted-foreground shrink-0">
              v{parent.version}
            </span>
          </div>
        </div>
      </div>

      {/* Mode toggle */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">Books:</span>
        <Button asChild size="sm" variant={includePaper ? "outline" : "default"}>
          <Link href={`/strategies/${parent.strategy_id}`}>Live only</Link>
        </Button>
        <Button asChild size="sm" variant={includePaper ? "default" : "outline"}>
          <Link href={`/strategies/${parent.strategy_id}?paper=1`}>Include paper</Link>
        </Button>
        <span className="text-xs text-muted-foreground">
          Running {modeLabel} runs of each child · charts cover the last {WINDOW_DAYS} days
        </span>
      </div>

      {/* Headline figures */}
      <Card>
        <CardContent className="p-0">
          <div className="grid grid-cols-2 sm:grid-cols-4">
            <Figure label="Total Equity" value={money(books.length ? totalEquity : null)} />
            <Figure
              label="Total PnL"
              value={money(books.length ? totalPnl : null, true)}
              className={tone(totalPnl)}
            />
            <Figure
              label="Return on Capital"
              value={pct(totalInitial > 0 ? ((totalEquity - totalInitial) / totalInitial) * 100 : null, true)}
              className={tone(totalEquity - totalInitial)}
            />
            <Figure
              label="Unrealized PnL"
              value={money(positions.length ? totalUpnl : 0, true)}
              className={tone(totalUpnl)}
            />
          </div>
        </CardContent>
      </Card>

      {/* Per-child breakdown */}
      <div className="grid gap-3 sm:gap-4 sm:grid-cols-2">
        {children.map((child) => {
          const childBooks = booksByChild.get(child.strategy_id) ?? [];
          return (
            <Card key={child.strategy_id}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <CardTitle className="text-sm sm:text-base truncate">{child.name}</CardTitle>
                    <CardDescription className="text-xs font-mono">
                      v{child.version} · share {(shareRatioByChild[child.strategy_id] ?? 1).toString()}
                    </CardDescription>
                  </div>
                  <Link
                    href={`/strategies/${child.strategy_id}`}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground shrink-0"
                  >
                    Open <ArrowRight className="h-3 w-3" />
                  </Link>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {childBooks.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No running {modeLabel} run.</p>
                ) : (
                  childBooks.map((b) => (
                    <Link
                      key={b.runId}
                      href={`/strategies/${b.childId}/runs/${b.runId}`}
                      className="block rounded-md border p-3 transition-colors hover:bg-accent/50"
                    >
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <Badge variant={b.mode === "paper" ? "secondary" : "default"}>{b.mode}</Badge>
                        <span className="text-xs text-muted-foreground font-mono">
                          since {b.startTime.slice(0, 10)}
                        </span>
                      </div>
                      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                        <dt className="text-muted-foreground">Equity</dt>
                        <dd className="text-right font-mono">{money(b.equity)}</dd>
                        <dt className="text-muted-foreground">Return</dt>
                        <dd className={cn("text-right font-mono", tone(b.returnPct))}>
                          {pct(b.returnPct, true)}
                        </dd>
                        <dt className="text-muted-foreground">Drawdown</dt>
                        <dd className="text-right font-mono">
                          {pct(b.drawdownPct === null ? null : -b.drawdownPct)}
                          <span className="text-xs text-muted-foreground">
                            {" "}(max {pct(b.maxDrawdownPct === null ? null : -b.maxDrawdownPct)})
                          </span>
                        </dd>
                        <dt className="text-muted-foreground">Positions</dt>
                        <dd className="text-right font-mono">{b.positionsCount}</dd>
                      </dl>
                    </Link>
                  ))
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {books.length === 0 ? (
        <Card>
          <CardContent className="flex h-[120px] items-center justify-center text-sm text-muted-foreground">
            No running {modeLabel} books to aggregate.
          </CardContent>
        </Card>
      ) : (
        <>
          {aggregate.length > 0 && (
            <>
              <PerformanceStats
                filteredEquityCurve={aggregate}
                filteredCombinedTrades={statsTrades}
                shareRatio={1}
              />
              <EquityCurveChart
                data={aggregate.map((p) => ({ time: p.ts, equity: p.total_equity }))}
              />
              {books.length > 1 && (
                <p className="text-xs text-muted-foreground -mt-2">
                  Summed equity starts once every book has data ({aggregate[0].ts.slice(0, 16).replace("T", " ")} UTC);
                  each book&apos;s last value is carried forward between its points.
                </p>
              )}
              <DrawdownChart
                data={aggregate.map((p) => ({ time: p.ts, drawdown: -p.drawdown_pct }))}
              />
            </>
          )}
          {pnlSeries.length > 0 && <AggregatePnlChart data={pnlSeries} />}
        </>
      )}

      {/* Combined positions */}
      <Card>
        <CardHeader className="px-3 sm:px-6">
          <CardTitle className="text-sm sm:text-base font-medium">Current Positions</CardTitle>
          <CardDescription className="text-xs">
            {positions.length} open · notional {money(totalNotional)} · uPnL {money(totalUpnl, true)}
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0 sm:px-6">
          {positions.length === 0 ? (
            <p className="px-3 sm:px-0 text-sm text-muted-foreground">No open positions.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Symbol</TableHead>
                    <TableHead>Book</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Notional</TableHead>
                    <TableHead className="text-right">uPnL</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {positions.map((p) => (
                    <TableRow key={`${p.runId}-${p.symbol}-${p.exchange}`}>
                      <TableCell className="font-mono">
                        {p.symbol}
                        <span className="ml-1 text-xs text-muted-foreground">{p.exchange}</span>
                      </TableCell>
                      <TableCell>
                        <Link href={`/strategies/${p.childId}`} className="hover:underline">
                          {p.book}
                        </Link>
                      </TableCell>
                      <TableCell className={cn("text-right font-mono", tone(p.quantity))}>
                        {p.quantity.toLocaleString("en-US", { maximumFractionDigits: 6 })}
                      </TableCell>
                      <TableCell className="text-right font-mono">{money(p.notional)}</TableCell>
                      <TableCell className={cn("text-right font-mono", tone(p.unrealizedPnl))}>
                        {money(p.unrealizedPnl, true)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Figure({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center p-3 sm:p-4">
      <span className={cn("text-lg sm:text-2xl font-bold font-mono", className)}>{value}</span>
      <span className="text-xs sm:text-sm text-muted-foreground text-center">{label}</span>
    </div>
  );
}
