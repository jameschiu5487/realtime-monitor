"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  FULL_WINDOW_MIN,
  calibration,
  histograms,
  isClean,
  perEvent,
  scored,
  shortModel,
  summarize,
  type ModelRow,
  type ModelSummary,
} from "@/lib/model-metrics";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DistributionChart, IcTrendChart, ScatterCalibration } from "./model-charts";
import { DEFAULT_EVAL_SETTINGS, ModelEvaluation, type EvalSettings } from "./model-evaluation";
import { formatDateTime, formatTime } from "@/lib/time";

/** Predictions land at :30 + 5s and outcomes 8m05s after settlement. */
const AUTO_REFRESH_MS = 5 * 60 * 1000;
/** Rendered rows cap; the table scrolls inside a fixed height either way. */
const TABLE_LIMIT = 1000;

type SourceMode = "live" | "replay" | "all";
const SOURCE_MODES: SourceMode[] = ["live", "replay", "all"];

interface ModelMonitorContentProps {
  rows: ModelRow[];
  days: number;
  windows: number[];
  error: string | null;
}

const fmtTs = (ms: number) =>
  formatDateTime(ms, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

const bp = (v: number | null | undefined, digits = 2) =>
  v == null || !Number.isFinite(v) ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(digits)}`;

const signClass = (v: number | null | undefined) =>
  v == null ? "text-muted-foreground" : v > 0 ? "text-emerald-500" : v < 0 ? "text-red-500" : "";

export function ModelMonitorContent({ rows: allRows, days, windows, error }: ModelMonitorContentProps) {
  const router = useRouter();

  // Every model in the window, most rows first; the page shows one at a time.
  const models = useMemo(() => {
    const m = new Map<string, { live: number; replay: number }>();
    for (const r of allRows) {
      if (!r.modelVersion) continue;
      const c = m.get(r.modelVersion) ?? { live: 0, replay: 0 };
      if (r.source === "replay") c.replay++;
      else c.live++;
      m.set(r.modelVersion, c);
    }
    return [...m.entries()]
      .map(([version, c]) => ({ version, ...c, total: c.live + c.replay }))
      .sort((a, b) => b.total - a.total || a.version.localeCompare(b.version));
  }, [allRows]);
  const [pickedModel, setPickedModel] = useState<string | null>(null);
  // Which predictions to use: real-time only, reproduced only, or both.
  const [sourceMode, setSourceMode] = useState<SourceMode>("all");
  const sourceOk = useCallback(
    (r: ModelRow) =>
      sourceMode === "all" || (sourceMode === "replay" ? r.source === "replay" : r.source !== "replay"),
    [sourceMode]
  );
  const activeModel =
    pickedModel && models.some((m) => m.version === pickedModel) ? pickedModel : models[0]?.version ?? null;
  const rows = useMemo(
    () => allRows.filter((r) => r.modelVersion === activeModel && sourceOk(r)),
    [allRows, activeModel, sourceOk]
  );

  const hasClean = useMemo(() => rows.some(isClean), [rows]);
  // Settled rows overall vs the clean subset, shown beside the toggle.
  const settledCounts = useMemo(() => {
    const settled = scored(rows);
    return { all: settled.length, clean: settled.filter(isClean).length };
  }, [rows]);
  // Off by default: it used to switch on as soon as any clean row existed,
  // which after the shadow restart silently cut 523 settled rows to 2.
  const [cleanOnly, setCleanOnly] = useState(false);
  const [symbolQuery, setSymbolQuery] = useState("");
  const [evalSettings, setEvalSettings] = useState<EvalSettings>(DEFAULT_EVAL_SETTINGS);
  const feeBp = evalSettings.feeBp;
  const [loadedAt, setLoadedAt] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => {
      router.refresh();
      setLoadedAt(Date.now());
    }, AUTO_REFRESH_MS);
    return () => clearInterval(id);
  }, [router]);

  const filtered = useMemo(() => {
    const q = symbolQuery.trim().toUpperCase();
    return rows.filter(
      (r) => (!cleanOnly || isClean(r)) && (q === "" || r.symbol.toUpperCase().includes(q))
    );
  }, [rows, cleanOnly, symbolQuery]);

  // The other models under the same filters, for their lines on the equity curve.
  const otherModels = useMemo(() => {
    const q = symbolQuery.trim().toUpperCase();
    return models
      .filter((m) => m.version !== activeModel)
      .map((m) => ({
        version: m.version,
        rows: scored(
          allRows.filter(
            (r) =>
              r.modelVersion === m.version &&
              sourceOk(r) &&
              (!cleanOnly || isClean(r)) &&
              (q === "" || r.symbol.toUpperCase().includes(q))
          )
        ),
      }));
  }, [models, activeModel, allRows, cleanOnly, symbolQuery, sourceOk]);

  const scoredRows = useMemo(() => scored(filtered), [filtered]);
  const summary = useMemo(() => summarize(scoredRows), [scoredRows]);
  const events = useMemo(() => perEvent(scoredRows), [scoredRows]);
  const bins = useMemo(() => calibration(scoredRows), [scoredRows]);
  const hist = useMemo(() => histograms(scoredRows), [scoredRows]);
  const pending = filtered.length - scoredRows.length;

  // Predictions-tab only: an exp_funding range, bp. Blank = no bound.
  const [expMin, setExpMin] = useState("");
  const [expMax, setExpMax] = useState("");
  const tableFiltered = useMemo(() => {
    const lo = expMin.trim() === "" ? null : Number(expMin);
    const hi = expMax.trim() === "" ? null : Number(expMax);
    const useLo = lo != null && Number.isFinite(lo);
    const useHi = hi != null && Number.isFinite(hi);
    if (!useLo && !useHi) return filtered;
    return filtered.filter(
      (r) =>
        r.expFundingBp != null &&
        (!useLo || r.expFundingBp >= lo!) &&
        (!useHi || r.expFundingBp <= hi!)
    );
  }, [filtered, expMin, expMax]);

  const tableRows = useMemo(
    () =>
      [...tableFiltered]
        .sort((a, b) => b.fundingTs - a.fundingTs || a.symbol.localeCompare(b.symbol))
        .slice(0, TABLE_LIMIT),
    [tableFiltered]
  );

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Model Monitor</h1>
          <p className="text-sm text-muted-foreground">
            Shadow predictions (ypred) against realised y, bp. Live predictions, plus replay only
            where live has no row.
          </p>
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <span className="text-xs text-muted-foreground">Source</span>
            {SOURCE_MODES.map((mode) => (
              <Button
                key={mode}
                size="sm"
                variant={mode === sourceMode ? "default" : "outline"}
                className="h-7 px-2 text-xs"
                onClick={() => setSourceMode(mode)}
              >
                {mode}
              </Button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5 pt-1">
            {models.map((m) => (
              <Button
                key={m.version}
                size="sm"
                variant={m.version === activeModel ? "default" : "outline"}
                className="h-auto py-1 font-mono text-xs"
                title={m.version}
                onClick={() => setPickedModel(m.version)}
              >
                {shortModel(m.version)}
                <span className="ml-1.5 opacity-70">
                  {m.live} live{m.replay > 0 ? ` · ${m.replay} replay` : ""}
                </span>
              </Button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {windows.map((w) => (
            <Button key={w} asChild size="sm" variant={w === days ? "default" : "outline"}>
              <Link href={`/model?days=${w}`}>{w}d</Link>
            </Button>
          ))}
          <Button
            size="icon"
            variant="ghost"
            suppressHydrationWarning
            title={`Refresh (auto every 5 min; loaded ${formatTime(loadedAt)})`}
            onClick={() => {
              router.refresh();
              setLoadedAt(Date.now());
            }}
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {error && (
        <Card className="border-red-500/50">
          <CardContent className="py-3 text-sm text-red-500">Failed to load: {error}</CardContent>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <Switch id="clean-only" checked={cleanOnly} onCheckedChange={setCleanOnly} />
          <Label htmlFor="clean-only" className="text-sm">
            Clean only (no ledger gap, {FULL_WINDOW_MIN}m window)
          </Label>
          <span className="text-xs text-muted-foreground font-mono">
            clean {settledCounts.clean} / {settledCounts.all} settled
          </span>
        </div>
        <Input
          placeholder="Filter symbol…"
          value={symbolQuery}
          onChange={(e) => setSymbolQuery(e.target.value)}
          className="h-8 w-40"
        />
        {!hasClean && rows.length > 0 && (
          <span className="text-xs text-amber-500">
            No clean rows yet — every prediction in this window has a ledger gap.
          </span>
        )}
      </div>

      <Tabs defaultValue="evaluation" className="space-y-4">
        <TabsList>
          <TabsTrigger value="evaluation">Evaluation</TabsTrigger>
          <TabsTrigger value="diagnostics">Diagnostics</TabsTrigger>
          <TabsTrigger value="predictions">Predictions</TabsTrigger>
        </TabsList>

        {/* Research's own priority order: strategy-level metrics first. */}
        <TabsContent value="evaluation">
          <ModelEvaluation
            rows={scoredRows}
            modelVersion={activeModel}
            otherModels={otherModels}
            splitBySource={sourceMode === "all"}
            settings={evalSettings}
            onSettingsChange={setEvalSettings}
          />
        </TabsContent>

        <TabsContent value="diagnostics" className="space-y-4 sm:space-y-6">
          <SummaryCards summary={summary} pending={pending} />
          <IcTrendChart events={events} />
          <ScatterCalibration rows={scoredRows} bins={bins} />
          <DistributionChart bins={hist} />
        </TabsContent>

        <TabsContent value="predictions">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Predictions</CardTitle>
              <CardDescription className="text-xs">
                Newest first{tableFiltered.length > TABLE_LIMIT ? `, latest ${TABLE_LIMIT} of ${tableFiltered.length}` : ""}.
                Open rows are waiting for settlement (y lands 8m05s after).
              </CardDescription>
              <div className="flex flex-wrap items-center gap-2 pt-2 text-xs">
                <span className="text-muted-foreground">Exp funding (bp)</span>
                <Input
                  type="number"
                  inputMode="decimal"
                  step="0.1"
                  placeholder="min"
                  value={expMin}
                  onChange={(e) => setExpMin(e.target.value)}
                  className="h-7 w-20 text-xs"
                />
                <span className="text-muted-foreground">~</span>
                <Input
                  type="number"
                  inputMode="decimal"
                  step="0.1"
                  placeholder="max"
                  value={expMax}
                  onChange={(e) => setExpMax(e.target.value)}
                  className="h-7 w-20 text-xs"
                />
                {(expMin !== "" || expMax !== "") && (
                  <>
                    <span className="font-mono text-muted-foreground">
                      {tableFiltered.length} / {filtered.length} rows
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs"
                      onClick={() => {
                        setExpMin("");
                        setExpMax("");
                      }}
                    >
                      Clear
                    </Button>
                  </>
                )}
              </div>
            </CardHeader>
            <CardContent className="px-0 sm:px-6">
              <div className="max-h-[480px] overflow-auto">
                <table className="w-full text-xs font-mono">
                  <thead className="sticky top-0 z-10 bg-card text-muted-foreground">
                    <tr className="border-b text-left">
                      <th className="px-2 py-1.5 font-medium">Settlement</th>
                      <th className="px-2 py-1.5 font-medium">Symbol</th>
                      <th className="px-2 py-1.5 font-medium" title="live = predicted in real time; replay = reproduced offline where live has no row">
                        Source
                      </th>
                      <th className="px-2 py-1.5 text-right font-medium">ypred</th>
                      <th className="px-2 py-1.5 text-right font-medium">y_true</th>
                      <th className="px-2 py-1.5 text-right font-medium">Error</th>
                      <th className="px-2 py-1.5 text-right font-medium" title="Expected funding known at entry">
                        Exp funding (bp)
                      </th>
                      <th className="px-2 py-1.5 text-right font-medium" title="Realised funding from settled rates">
                        Settled funding (bp)
                      </th>
                      <th className="px-2 py-1.5 text-right font-medium" title="Settled − exp funding">
                        Funding diff (bp)
                      </th>
                      <th className="px-2 py-1.5 text-right font-medium">Exp total</th>
                      <th className="px-2 py-1.5 text-right font-medium" title="y + settled funding − fee (fee set on the Evaluation tab)">
                        Realised net (fee {feeBp})
                      </th>
                      <th className="px-2 py-1.5 font-medium">Direction</th>
                      <th className="px-2 py-1.5 font-medium">Status</th>
                      <th className="px-2 py-1.5 text-right font-medium" title="ledger gap / window depth / substituted inputs">
                        Gap/Win/Sub
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {tableRows.map((r) => {
                      const err = r.yTrue == null ? null : r.yTrue - r.ypred;
                      const total = r.expFundingBp == null ? null : r.ypred + r.expFundingBp;
                      const realised =
                        r.yTrue == null || r.settledFundingBp == null ? null : r.yTrue + r.settledFundingBp - feeBp;
                      const fundingDiff =
                        r.settledFundingBp == null || r.expFundingBp == null ? null : r.settledFundingBp - r.expFundingBp;
                      return (
                        <tr key={`${r.fundingTs}|${r.symbol}`} className="border-b last:border-0">
                          <td className="px-2 py-1.5 whitespace-nowrap">{fmtTs(r.fundingTs)}</td>
                          <td className="px-2 py-1.5">{r.symbol}</td>
                          <td className={cn("px-2 py-1.5", r.source === "replay" && "text-amber-500")}>{r.source ?? "—"}</td>
                          <td className={cn("px-2 py-1.5 text-right", signClass(r.ypred))}>{bp(r.ypred)}</td>
                          <td className={cn("px-2 py-1.5 text-right", signClass(r.yTrue))}>{bp(r.yTrue)}</td>
                          <td className="px-2 py-1.5 text-right text-muted-foreground">{bp(err)}</td>
                          <td className="px-2 py-1.5 text-right">{bp(r.expFundingBp)}</td>
                          <td className="px-2 py-1.5 text-right">{bp(r.settledFundingBp)}</td>
                          <td className={cn("px-2 py-1.5 text-right", signClass(fundingDiff))}>{bp(fundingDiff)}</td>
                          <td className={cn("px-2 py-1.5 text-right", signClass(total))}>{bp(total)}</td>
                          <td className={cn("px-2 py-1.5 text-right font-semibold", signClass(realised))}>{bp(realised)}</td>
                          <td className="px-2 py-1.5 whitespace-nowrap">{directionLabel(r.direction)}</td>
                          <td className="px-2 py-1.5">
                            <Badge variant={r.status === "closed" ? "secondary" : "outline"} className="text-[10px]">
                              {r.status ?? "pending"}
                            </Badge>
                          </td>
                          <td
                            className={cn(
                              "px-2 py-1.5 text-right whitespace-nowrap",
                              !isClean(r) && "text-amber-500"
                            )}
                          >
                            {r.ledgerGapObs ?? "—"}/{r.windowDepthMin ?? "—"}/{r.substitutedInputs ?? "—"}
                          </td>
                        </tr>
                      );
                    })}
                    {tableRows.length === 0 && (
                      <tr>
                        <td colSpan={14} className="py-8 text-center text-muted-foreground">
                          No predictions in this window.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

/** Ledger direction, with primary = bybit and secondary = binance. */
function directionLabel(d: string | null): string {
  if (d === "long_primary_short_secondary") return "L prim / S sec";
  if (d === "short_primary_long_secondary") return "S prim / L sec";
  return d ?? "—";
}

function SummaryCards({ summary, pending }: { summary: ModelSummary | null; pending: number }) {
  const f = (v: number | null | undefined, d = 3) => (v == null ? "—" : v.toFixed(d));
  const cards: { label: string; value: string; hint?: string; className?: string }[] = [
    { label: "Scored", value: summary ? String(summary.n) : "0", hint: `${pending} pending` },
    { label: "IC", value: f(summary?.ic), className: signClass(summary?.ic), hint: "Pearson" },
    {
      label: "Rank IC (deprecated)",
      value: f(summary?.rankIc),
      className: "text-muted-foreground line-through decoration-1",
      hint: "monthly values run opposite to bp/trade (ρ −0.48)",
    },
    {
      label: "R² (not trusted)",
      value: f(summary?.r2),
      className: "text-muted-foreground",
      hint: "reported only, as in research",
    },
    {
      label: "Hit rate",
      value: summary?.hitRate == null ? "—" : `${(summary.hitRate * 100).toFixed(1)}%`,
      hint: "sign(ypred) = sign(y)",
    },
    { label: "MAE", value: summary ? `${summary.mae.toFixed(2)} bp` : "—" },
    { label: "RMSE", value: summary ? `${summary.rmse.toFixed(2)} bp` : "—" },
    {
      label: "Mean ypred / y",
      value: summary ? `${bp(summary.meanPred)} / ${bp(summary.meanTrue)}` : "—",
      hint: summary ? `bias ${bp(summary.bias)} bp` : undefined,
    },
    {
      label: "Mean y | ypred > 0",
      value: summary?.meanTrueWhenPredPositive == null ? "—" : `${bp(summary.meanTrueWhenPredPositive)} bp`,
      className: signClass(summary?.meanTrueWhenPredPositive),
      hint: "what trading the sign earns",
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {cards.map((c) => (
        <Card key={c.label}>
          <CardContent className="px-4 py-3">
            <p className="text-xs text-muted-foreground">{c.label}</p>
            <p className={cn("text-lg font-bold font-mono", c.className)}>{c.value}</p>
            {c.hint && <p className="text-[11px] text-muted-foreground">{c.hint}</p>}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
