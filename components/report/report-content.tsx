"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { Area, AreaChart, CartesianGrid, ReferenceLine, XAxis, YAxis } from "recharts";
import { Loader2, Play, Save, Trash2, FolderOpen, Send, Pencil, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { PerformanceStats } from "@/components/charts/performance-stats";
import { DatePickerField } from "@/components/report/date-picker-field";
import { createClient } from "@/lib/supabase/client";
import {
  mergeStrategyEquity,
  aggregateTotalEquity,
  buildCombinedEquityCurve,
  downsample,
  fillRangeBoundaries,
  adjustNavTransfers,
  adjustEquityCurveTransfers,
  type ChartDataPoint,
} from "@/lib/utils/equity";
import type {
  Strategy,
  StrategyRun,
  EquityCurve,
  CombinedTrade,
} from "@/lib/types/database";

const chartConfig = {
  equity: {
    label: "Equity",
    color: "hsl(142 76% 36%)",
  },
} satisfies ChartConfig;

interface SavedReport {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  selected_strategy_ids: string[];
  forward_fill_ids: string[];
  max_nav_change: number;
  notes: string;
  storage_user_id: string;
  storage_report_id: string;
  created_at: string;
}

interface SavedReportData {
  totalChartData: ChartDataPoint[];
  totalEquityCurve: EquityCurve[];
  totalCombinedTrades: CombinedTrade[];
}

interface ReportContentProps {
  allStrategies: Strategy[];
  allRuns: StrategyRun[];
  shareRatioMap: Record<string, number>;
}

const SESSION_KEY = "report-state";

interface SerializedState {
  startDate: string | null;
  endDate: string | null;
  selectedStrategyIds: string[];
  forwardFillIds: string[];
  maxNavChange: number;
  result: {
    strategyEquity: [string, EquityCurve[]][];
    strategyCombinedTrades: [string, CombinedTrade[]][];
    totalChartData: ChartDataPoint[];
    totalEquityCurve: EquityCurve[];
    totalCombinedTrades: CombinedTrade[];
  } | null;
}

interface ReportResult {
  // Per-strategy data
  strategyEquity: Map<string, EquityCurve[]>;
  strategyCombinedTrades: Map<string, CombinedTrade[]>;
  // Aggregated
  totalChartData: ChartDataPoint[];
  totalEquityCurve: EquityCurve[];
  totalCombinedTrades: CombinedTrade[];
}

function findOverlappingRuns(
  runs: StrategyRun[],
  strategyId: string,
  rangeStart: Date,
  rangeEnd: Date
): StrategyRun[] {
  return runs.filter(
    (r) =>
      r.strategy_id === strategyId &&
      new Date(r.start_time) < rangeEnd &&
      (r.end_time === null || new Date(r.end_time) > rangeStart)
  );
}

async function fetchPaginated<T>(
  table: string,
  runIds: string[],
  startDate: Date,
  endDate: Date
): Promise<T[]> {
  if (runIds.length === 0) return [];
  const supabase = createClient();
  const PAGE_SIZE = 1000;
  const allData: T[] = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .in("run_id", runIds)
      .gte("ts", startDate.toISOString())
      .lte("ts", endDate.toISOString())
      .order("ts", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) {
      console.error(`Error fetching ${table}:`, error);
      break;
    }

    if (data && data.length > 0) {
      allData.push(...(data as T[]));
      offset += PAGE_SIZE;
      hasMore = data.length === PAGE_SIZE;
    } else {
      hasMore = false;
    }
  }

  return allData;
}

function formatPrice(price: number): string {
  if (price >= 1000000) return `$${(price / 1000000).toFixed(2)}M`;
  if (price >= 1000) return `$${(price / 1000).toFixed(2)}K`;
  return `$${price.toFixed(2)}`;
}

function detectTransferPoints(data: ChartDataPoint[], threshold: number): number[] {
  if (data.length < 2 || threshold <= 0) return [];
  const points: number[] = [];
  for (let i = 1; i < data.length; i++) {
    if (Math.abs(data[i].equity - data[i - 1].equity) > threshold) {
      points.push(data[i].time);
    }
  }
  return points;
}

function EquityChart({ data, transferPoints, height = 300 }: { data: ChartDataPoint[]; transferPoints?: number[]; height?: number }) {
  const displayData = useMemo(() => downsample(data), [data]);

  const yDomain = useMemo(() => {
    if (displayData.length === 0) return [0, 100];
    const values = displayData.map((d) => d.equity);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const padding = (max - min) * 0.1 || 100;
    return [Math.floor(min - padding), Math.ceil(max + padding)];
  }, [displayData]);

  if (displayData.length === 0) {
    return (
      <div className="flex items-center justify-center text-muted-foreground" style={{ height }}>
        No data
      </div>
    );
  }

  return (
    <ChartContainer config={chartConfig} className="w-full" style={{ height }}>
      <AreaChart data={displayData} margin={{ left: 10, right: 10, top: 10, bottom: 0 }}>
        <defs>
          <linearGradient id="fillEquityReport" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="hsl(142 76% 36%)" stopOpacity={0.8} />
            <stop offset="95%" stopColor="hsl(142 76% 36%)" stopOpacity={0.1} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="time"
          type="number"
          domain={["dataMin", "dataMax"]}
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={80}
          tickFormatter={(value) => {
            const date = new Date(value);
            return date.toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            });
          }}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          domain={yDomain}
          tickFormatter={formatPrice}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(_, payload) => {
                if (payload?.[0]?.payload?.time) {
                  return new Date(payload[0].payload.time).toLocaleString("en-US", {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  });
                }
                return "";
              }}
              formatter={(value) => formatPrice(value as number)}
            />
          }
        />
        <Area
          dataKey="equity"
          type="monotone"
          fill="url(#fillEquityReport)"
          stroke="hsl(142 76% 36%)"
          strokeWidth={2}
          isAnimationActive={false}
        />
        {transferPoints?.map((t) => (
          <ReferenceLine
            key={t}
            x={t}
            stroke="hsl(0 72% 51%)"
            strokeDasharray="4 3"
            strokeWidth={1.5}
          />
        ))}
      </AreaChart>
    </ChartContainer>
  );
}

export function ReportContent({ allStrategies, allRuns, shareRatioMap }: ReportContentProps) {
  const [startDate, setStartDate] = useState<Date | undefined>();
  const [endDate, setEndDate] = useState<Date | undefined>();
  const [selectedStrategyIds, setSelectedStrategyIds] = useState<Set<string>>(new Set());
  const [forwardFillIds, setForwardFillIds] = useState<Set<string>>(new Set());
  const [maxNavChange, setMaxNavChange] = useState<number>(0);
  const [isLoading, setIsLoading] = useState(false);
  const [reportResult, setReportResult] = useState<ReportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ total: number; completed: number; currentName: string }>({
    total: 0,
    completed: 0,
    currentName: "",
  });

  const [savedReports, setSavedReports] = useState<SavedReport[]>([]);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [loadedReport, setLoadedReport] = useState<SavedReport | null>(null);
  const [loadedReportData, setLoadedReportData] = useState<SavedReportData | null>(null);
  const [isLoadingReport, setIsLoadingReport] = useState(false);
  const [editingNotes, setEditingNotes] = useState("");
  const [isSavingNotes, setIsSavingNotes] = useState(false);
  const notesDirty = loadedReport ? editingNotes !== loadedReport.notes : false;
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [shareEmail, setShareEmail] = useState("");
  const [isSharing, setIsSharing] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const [shareSuccess, setShareSuccess] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const restoredRef = useRef(false);

  // Fetch saved reports on mount
  useEffect(() => {
    const supabase = createClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from("saved_reports")
      .select("*")
      .order("created_at", { ascending: false })
      .then(({ data }: { data: SavedReport[] | null }) => {
        if (data) setSavedReports(data);
      });
  }, []);

  // Restore state from sessionStorage on mount
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return;
      const saved: SerializedState = JSON.parse(raw);
      if (saved.startDate) setStartDate(new Date(saved.startDate));
      if (saved.endDate) setEndDate(new Date(saved.endDate));
      if (saved.selectedStrategyIds?.length) setSelectedStrategyIds(new Set(saved.selectedStrategyIds));
      if (saved.forwardFillIds?.length) setForwardFillIds(new Set(saved.forwardFillIds));
      if (saved.maxNavChange) setMaxNavChange(saved.maxNavChange);
      if (saved.result) {
        setReportResult({
          strategyEquity: new Map(saved.result.strategyEquity),
          strategyCombinedTrades: new Map(saved.result.strategyCombinedTrades),
          totalChartData: saved.result.totalChartData,
          totalEquityCurve: saved.result.totalEquityCurve,
          totalCombinedTrades: saved.result.totalCombinedTrades,
        });
      }
    } catch {}
  }, []);

  // Save state to sessionStorage when results change
  useEffect(() => {
    if (!restoredRef.current) return;
    try {
      const state: SerializedState = {
        startDate: startDate?.toISOString() ?? null,
        endDate: endDate?.toISOString() ?? null,
        selectedStrategyIds: Array.from(selectedStrategyIds),
        forwardFillIds: Array.from(forwardFillIds),
        maxNavChange,
        result: reportResult
          ? {
              strategyEquity: Array.from(reportResult.strategyEquity.entries()),
              strategyCombinedTrades: Array.from(reportResult.strategyCombinedTrades.entries()),
              totalChartData: reportResult.totalChartData,
              totalEquityCurve: reportResult.totalEquityCurve,
              totalCombinedTrades: reportResult.totalCombinedTrades,
            }
          : null,
      };
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(state));
    } catch {}
  }, [startDate, endDate, selectedStrategyIds, forwardFillIds, maxNavChange, reportResult]);

  // Group strategies with their run counts
  const strategiesWithRuns = useMemo(() => {
    return allStrategies.map((s) => ({
      ...s,
      runCount: allRuns.filter((r) => r.strategy_id === s.strategy_id).length,
    }));
  }, [allStrategies, allRuns]);

  const toggleStrategy = (strategyId: string) => {
    setSelectedStrategyIds((prev) => {
      const next = new Set(prev);
      if (next.has(strategyId)) {
        next.delete(strategyId);
        // Also remove from forward-fill set
        setForwardFillIds((ff) => {
          const n = new Set(ff);
          n.delete(strategyId);
          return n;
        });
      } else {
        next.add(strategyId);
      }
      return next;
    });
  };

  const toggleForwardFill = (strategyId: string) => {
    setForwardFillIds((prev) => {
      const next = new Set(prev);
      if (next.has(strategyId)) {
        next.delete(strategyId);
      } else {
        next.add(strategyId);
      }
      return next;
    });
  };

  const selectAll = () => {
    setSelectedStrategyIds(new Set(allStrategies.map((s) => s.strategy_id)));
  };

  const deselectAll = () => {
    setSelectedStrategyIds(new Set());
  };

  const strategyNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const s of allStrategies) {
      map[s.strategy_id] = s.name;
    }
    return map;
  }, [allStrategies]);

  const canGenerate = startDate && endDate && selectedStrategyIds.size > 0 && startDate < endDate;

  const handleGenerate = useCallback(async () => {
    if (!startDate || !endDate || selectedStrategyIds.size === 0) return;

    setIsLoading(true);
    setError(null);
    setReportResult(null);

    const strategyIds = Array.from(selectedStrategyIds);
    setProgress({ total: strategyIds.length, completed: 0, currentName: "" });

    try {
      const rangeEnd = new Date(endDate);
      rangeEnd.setHours(23, 59, 59, 999);

      const strategyEquity = new Map<string, EquityCurve[]>();
      const strategyCombinedTrades = new Map<string, CombinedTrade[]>();
      let completedCount = 0;

      // Process all strategies in parallel with progress tracking
      await Promise.all(
        strategyIds.map(async (strategyId) => {
          const overlapping = findOverlappingRuns(allRuns, strategyId, startDate, rangeEnd);
          const runIds = overlapping.map((r) => r.run_id);

          if (runIds.length === 0) {
            strategyEquity.set(strategyId, []);
            strategyCombinedTrades.set(strategyId, []);
          } else {
            const [equityData, tradesData] = await Promise.all([
              fetchPaginated<EquityCurve>("equity_curve", runIds, startDate, rangeEnd),
              fetchPaginated<CombinedTrade>("combined_trades", runIds, startDate, rangeEnd),
            ]);

            // Merge runs (forward-fill between runs, same as overview)
            let merged = mergeStrategyEquity(equityData);
            merged = fillRangeBoundaries(
              merged, overlapping, startDate, rangeEnd,
              forwardFillIds.has(strategyId)
            );

            strategyEquity.set(strategyId, merged);
            strategyCombinedTrades.set(strategyId, tradesData);
          }

          completedCount++;
          const name = strategyNameMap[strategyId] ?? "Unknown";
          setProgress({ total: strategyIds.length, completed: completedCount, currentName: name });
        })
      );

      // Check if we got any data
      const hasData = Array.from(strategyEquity.values()).some((d) => d.length > 0);
      if (!hasData) {
        setError("No runs found in the selected date range.");
        setIsLoading(false);
        return;
      }

      // Aggregation step
      setProgress({ total: strategyIds.length, completed: strategyIds.length, currentName: "Aggregating..." });

      const allCombinedTrades = strategyIds.flatMap((id) => strategyCombinedTrades.get(id) ?? []);

      const totalChartData = aggregateTotalEquity(strategyEquity, shareRatioMap);
      const totalEquityCurve = buildCombinedEquityCurve(strategyEquity, shareRatioMap);

      setReportResult({
        strategyEquity,
        strategyCombinedTrades,
        totalChartData,
        totalEquityCurve,
        totalCombinedTrades: allCombinedTrades,
      });
    } catch (e) {
      console.error("Report generation error:", e);
      setError("Failed to generate report. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }, [startDate, endDate, selectedStrategyIds, forwardFillIds, allRuns, shareRatioMap, strategyNameMap]);

  const adjustedCombined = useMemo(() => {
    if (!reportResult) return null;
    const chartData = maxNavChange > 0
      ? adjustNavTransfers(reportResult.totalChartData, maxNavChange)
      : reportResult.totalChartData;
    const equityCurve = maxNavChange > 0
      ? adjustEquityCurveTransfers(reportResult.totalEquityCurve, maxNavChange)
      : reportResult.totalEquityCurve;
    const transferPoints = maxNavChange > 0
      ? detectTransferPoints(reportResult.totalChartData, maxNavChange)
      : undefined;
    return { chartData, equityCurve, transferPoints };
  }, [reportResult, maxNavChange]);

  const handleSaveReport = useCallback(async () => {
    if (!saveName.trim() || !adjustedCombined || !reportResult || !startDate || !endDate) return;
    setIsSaving(true);
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const reportId = crypto.randomUUID();

      // Strip fields not needed by PerformanceStats to reduce file size
      const trimmedEquity = adjustedCombined.equityCurve.map((e) => ({
        ts: e.ts,
        total_equity: e.total_equity,
        drawdown_pct: e.drawdown_pct,
        total_position_value: e.total_position_value,
      }));
      const trimmedTrades = reportResult.totalCombinedTrades.map((t) => ({
        quantity: t.quantity,
        entry_price: t.entry_price,
        exit_price: t.exit_price,
        total_pnl: t.total_pnl,
      }));

      const jsonStr = JSON.stringify({
        totalChartData: downsample(adjustedCombined.chartData),
        totalEquityCurve: trimmedEquity,
        totalCombinedTrades: trimmedTrades,
      });

      // Gzip compress
      const stream = new Blob([jsonStr]).stream().pipeThrough(new CompressionStream("gzip"));
      const compressedBlob = await new Response(stream).blob();

      // DB insert + Storage upload in parallel
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const [dbResult, storageResult] = await Promise.all([
        (supabase as any)
          .from("saved_reports")
          .insert({
            id: reportId,
            user_id: user.id,
            name: saveName.trim(),
            start_date: startDate.toISOString(),
            end_date: endDate.toISOString(),
            selected_strategy_ids: Array.from(selectedStrategyIds),
            forward_fill_ids: Array.from(forwardFillIds),
            max_nav_change: maxNavChange,
          })
          .select()
          .single(),
        supabase.storage
          .from("reports")
          .upload(`${user.id}/${reportId}.json.gz`, compressedBlob, {
            upsert: true,
            contentType: "application/gzip",
          }),
      ]);

      if (dbResult.error) throw dbResult.error;
      if (storageResult.error) {
        await (supabase as any).from("saved_reports").delete().eq("id", reportId);
        throw storageResult.error;
      }

      setSavedReports((prev) => [dbResult.data as SavedReport, ...prev]);
      setSaveDialogOpen(false);
      setSaveName("");
    } catch (e) {
      console.error("Save report error:", e);
    } finally {
      setIsSaving(false);
    }
  }, [saveName, adjustedCombined, reportResult, startDate, endDate, selectedStrategyIds, forwardFillIds, maxNavChange]);

  const handleDeleteReport = useCallback(async (id: string) => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const report = savedReports.find((r) => r.id === id);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: delError } = await (supabase as any).from("saved_reports").delete().eq("id", id);
    if (!delError) {
      // Only delete file if this user owns it (not a shared copy)
      if (user && report && report.storage_user_id === user.id && report.storage_report_id === report.id) {
        await supabase.storage.from("reports").remove([`${user.id}/${id}.json.gz`]);
      }
      setSavedReports((prev) => prev.filter((r) => r.id !== id));
      if (loadedReport?.id === id) {
        setLoadedReport(null);
        setLoadedReportData(null);
      }
    }
  }, [loadedReport, savedReports]);

  const handleSaveNotes = useCallback(async () => {
    if (!loadedReport) return;
    setIsSavingNotes(true);
    try {
      const supabase = createClient();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: updateError } = await (supabase as any)
        .from("saved_reports")
        .update({ notes: editingNotes })
        .eq("id", loadedReport.id);
      if (!updateError) {
        const updated = { ...loadedReport, notes: editingNotes };
        setLoadedReport(updated);
        setSavedReports((prev) => prev.map((r) => r.id === updated.id ? updated : r));
      }
    } catch (e) {
      console.error("Save notes error:", e);
    } finally {
      setIsSavingNotes(false);
    }
  }, [loadedReport, editingNotes]);

  const handleShareReport = useCallback(async () => {
    if (!loadedReport || !shareEmail.trim()) return;
    setIsSharing(true);
    setShareError(null);
    try {
      const supabase = createClient();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any).rpc("share_report", {
        source_report_id: loadedReport.id,
        target_email: shareEmail.trim(),
      });
      if (error) throw error;
      setShareSuccess(true);
      setTimeout(() => {
        setShareDialogOpen(false);
        setShareEmail("");
        setShareSuccess(false);
      }, 1500);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to share";
      setShareError(msg);
    } finally {
      setIsSharing(false);
    }
  }, [loadedReport, shareEmail]);

  const handleRename = useCallback(async (id: string) => {
    if (!renameValue.trim()) return;
    const supabase = createClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
      .from("saved_reports")
      .update({ name: renameValue.trim() })
      .eq("id", id);
    if (!error) {
      setSavedReports((prev) => prev.map((r) => r.id === id ? { ...r, name: renameValue.trim() } : r));
      if (loadedReport?.id === id) setLoadedReport({ ...loadedReport, name: renameValue.trim() });
    }
    setRenamingId(null);
  }, [renameValue, loadedReport]);

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Report</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Select a date range and strategies to generate performance reports.
        </p>
      </div>

      {/* Saved Reports */}
      {savedReports.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Saved Reports</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {savedReports.map((r) => (
                <div
                  key={r.id}
                  className={`flex items-center gap-2 p-2.5 rounded-md border cursor-pointer transition-colors hover:bg-accent ${
                    loadedReport?.id === r.id ? "border-primary bg-accent" : ""
                  }`}
                  onClick={async () => {
                    if (loadedReport?.id === r.id) {
                      setLoadedReport(null);
                      setLoadedReportData(null);
                      setEditingNotes("");
                      return;
                    }
                    setLoadedReport(r);
                    setEditingNotes(r.notes || "");
                    setLoadedReportData(null);
                    setIsLoadingReport(true);
                    try {
                      const supabase = createClient();
                      const { data: { user } } = await supabase.auth.getUser();
                      if (!user) return;
                      const { data, error: dlError } = await supabase.storage
                        .from("reports")
                        .download(`${r.storage_user_id}/${r.storage_report_id}.json.gz`);
                      if (dlError) throw dlError;
                      const decompressed = data.stream().pipeThrough(new DecompressionStream("gzip"));
                      const text = await new Response(decompressed).text();
                      const json: SavedReportData = JSON.parse(text);
                      setLoadedReportData(json);
                    } catch (e) {
                      console.error("Load report error:", e);
                      setLoadedReport(null);
                    } finally {
                      setIsLoadingReport(false);
                    }
                  }}
                >
                  <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    {renamingId === r.id ? (
                      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                        <Input
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") handleRename(r.id); if (e.key === "Escape") setRenamingId(null); }}
                          className="h-6 text-sm px-1"
                          autoFocus
                        />
                        <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => handleRename(r.id)}>
                          <Check className="h-3 w-3" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => setRenamingId(null)}>
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    ) : (
                      <>
                        <div className="text-sm font-medium truncate">{r.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {new Date(r.start_date).toLocaleDateString()} - {new Date(r.end_date).toLocaleDateString()}
                        </div>
                      </>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      setRenamingId(r.id);
                      setRenameValue(r.name);
                    }}
                  >
                    <Pencil className="h-3 w-3 text-muted-foreground" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteReport(r.id);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Loaded Saved Report */}
      {loadedReport && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-base truncate">{loadedReport.name}</CardTitle>
              <Button
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={() => { setShareDialogOpen(true); setShareError(null); setShareSuccess(false); setShareEmail(""); }}
              >
                <Send className="mr-1.5 h-3.5 w-3.5" />
                Share
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {isLoadingReport ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Loading report...
              </div>
            ) : loadedReportData ? (
              <>
                <EquityChart data={loadedReportData.totalChartData} />
                <PerformanceStats
                  filteredEquityCurve={loadedReportData.totalEquityCurve}
                  filteredCombinedTrades={loadedReportData.totalCombinedTrades}
                />
              </>
            ) : null}
            {/* Notes */}
            <div className="space-y-2 pt-2 border-t">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-muted-foreground">Notes</span>
                {notesDirty && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={handleSaveNotes}
                    disabled={isSavingNotes}
                  >
                    {isSavingNotes ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Save className="mr-1 h-3 w-3" />}
                    Save
                  </Button>
                )}
              </div>
              <Textarea
                placeholder="Add notes about this report..."
                value={editingNotes}
                onChange={(e) => setEditingNotes(e.target.value)}
                className="min-h-[80px] resize-y"
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Configuration */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Report Settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Date Range & Max NAV Change */}
          <div className="flex flex-wrap items-end gap-3 sm:gap-4">
            <DatePickerField
              label="Start Date"
              date={startDate}
              onSelect={setStartDate}
              maxDate={new Date()}
            />
            <DatePickerField
              label="End Date"
              date={endDate}
              onSelect={setEndDate}
              maxDate={new Date()}
            />
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-muted-foreground">
                Max NAV Change ($)
              </label>
              <Input
                type="number"
                min={0}
                step={100}
                placeholder="0 = disabled"
                className="w-[140px] sm:w-[160px]"
                value={maxNavChange || ""}
                onChange={(e) => setMaxNavChange(Number(e.target.value) || 0)}
              />
            </div>
          </div>

          {/* Strategy Selection */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-sm font-medium text-muted-foreground">Strategies</span>
              <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={selectAll}>
                Select All
              </Button>
              <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={deselectAll}>
                Clear
              </Button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
              {strategiesWithRuns.map((s) => {
                const isSelected = selectedStrategyIds.has(s.strategy_id);
                const isFf = forwardFillIds.has(s.strategy_id);
                return (
                  <div
                    key={s.strategy_id}
                    className="flex items-center gap-2 p-2 rounded-md border hover:bg-accent transition-colors"
                  >
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={() => toggleStrategy(s.strategy_id)}
                    />
                    <span
                      className="text-sm truncate cursor-pointer flex-1"
                      onClick={() => toggleStrategy(s.strategy_id)}
                    >
                      {s.name}
                    </span>
                    {isSelected && (
                      <button
                        type="button"
                        onClick={() => toggleForwardFill(s.strategy_id)}
                        className={`text-[10px] px-1.5 py-0.5 rounded border shrink-0 transition-colors ${
                          isFf
                            ? "bg-primary text-primary-foreground border-primary"
                            : "text-muted-foreground border-border hover:border-primary/50"
                        }`}
                        title={isFf ? "結束後填前值" : "結束後填0"}
                      >
                        填前值
                      </button>
                    )}
                    <Badge variant="secondary" className="text-xs shrink-0">
                      {s.runCount}
                    </Badge>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Generate Button */}
          <Button onClick={handleGenerate} disabled={!canGenerate || isLoading} className="w-full sm:w-auto">
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Play className="mr-2 h-4 w-4" />
                Generate Report
              </>
            )}
          </Button>

          {/* Progress Bar */}
          {isLoading && progress.total > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  {progress.completed < progress.total ? (
                    <>Completed: <span className="font-medium text-foreground">{progress.currentName}</span></>
                  ) : (
                    <span className="font-medium text-foreground">{progress.currentName}</span>
                  )}
                </span>
                <span className="text-muted-foreground">
                  {progress.completed}/{progress.total}
                </span>
              </div>
              <div className="h-2 w-full rounded-full bg-secondary overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-300 ease-out"
                  style={{ width: `${(progress.completed / progress.total) * 100}%` }}
                />
              </div>
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>

      {/* Results */}
      {reportResult && (
        <div className="space-y-4">
          {/* Combined Overview */}
          {selectedStrategyIds.size > 1 && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-base">Combined Performance</CardTitle>
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    onClick={() => setSaveDialogOpen(true)}
                  >
                    <Save className="mr-1.5 h-3.5 w-3.5" />
                    Save
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {adjustedCombined && (
                  <>
                    <EquityChart
                      data={adjustedCombined.chartData}
                      transferPoints={adjustedCombined.transferPoints}
                    />
                    <PerformanceStats
                      filteredEquityCurve={adjustedCombined.equityCurve}
                      filteredCombinedTrades={reportResult.totalCombinedTrades}
                    />
                  </>
                )}
              </CardContent>
            </Card>
          )}

          {/* Save Dialog */}
          <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Save Report</DialogTitle>
              </DialogHeader>
              <Input
                placeholder="Report name"
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSaveReport()}
              />
              <DialogFooter>
                <Button variant="outline" onClick={() => setSaveDialogOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleSaveReport} disabled={!saveName.trim() || isSaving}>
                  {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Save
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Per-Strategy Sections */}
          {Array.from(selectedStrategyIds).map((strategyId) => {
            const equity = reportResult.strategyEquity.get(strategyId) ?? [];
            const trades = reportResult.strategyCombinedTrades.get(strategyId) ?? [];
            const ratio = shareRatioMap[strategyId] ?? 1;
            const chartData = equity.map((e) => ({
              time: new Date(e.ts).getTime(),
              equity: e.total_equity * ratio,
            }));

            return (
              <Card key={strategyId}>
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-base">
                      {strategyNameMap[strategyId] ?? strategyId}
                    </CardTitle>
                    <Badge variant="outline" className="text-xs">
                      {trades.length} trades
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <EquityChart data={chartData} height={250} />
                  <PerformanceStats
                    filteredEquityCurve={equity}
                    filteredCombinedTrades={trades}
                    shareRatio={shareRatioMap[strategyId]}
                  />
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
      {/* Share Dialog */}
      <Dialog open={shareDialogOpen} onOpenChange={setShareDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Share Report</DialogTitle>
          </DialogHeader>
          {shareSuccess ? (
            <p className="text-sm text-green-500 py-2">Sent successfully!</p>
          ) : (
            <>
              <Input
                type="email"
                placeholder="User email"
                value={shareEmail}
                onChange={(e) => setShareEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleShareReport()}
              />
              {shareError && <p className="text-sm text-destructive">{shareError}</p>}
              <DialogFooter>
                <Button variant="outline" onClick={() => setShareDialogOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleShareReport} disabled={!shareEmail.trim() || isSharing}>
                  {isSharing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                  Send
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
