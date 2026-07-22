"use client";

import { useMemo } from "react";
import { CartesianGrid, Line, LineChart, ReferenceArea, ReferenceDot, ReferenceLine, XAxis, YAxis } from "recharts";
import { format } from "date-fns";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import type { BasisPoint } from "@/lib/basis";

// 與 opportunity-spread-modal 同色系：band 紫色由深到淺、MA 橘色、funding 紅色虛線
const BB_COLORS = ["#a855f7", "#c084fc", "#d8b4fe", "#e9d5ff"];
const MA_COLOR = "#f59e0b";
const FUNDING_COLORS = { leg1: "#ef4444", leg2: "#06b6d4" };
// 價格線走右軸，避開 basis/band/MA/funding 用色
const PRICE_COLORS = { leg1: "#16a34a", leg2: "#84cc16" };

// 依幣價量級決定小數位：高價少位、低價多位（目標約 4~5 位有效數字）
function priceDecimals(v: number): number {
  const a = Math.abs(v);
  if (a === 0 || !Number.isFinite(a)) return 2;
  if (a >= 1000) return 2;
  if (a >= 100) return 3;
  if (a >= 1) return 4;
  return Math.floor(-Math.log10(a)) + 4; // 0.0013 → 6 位
}
const fmtPrice = (v: number) =>
  v.toLocaleString(undefined, { maximumFractionDigits: priceDecimals(v) });

export interface BollingerConfig {
  window: number; // 根數（由分鐘依當前 K 線粒度換算而來）
  windowLabel: string; // 顯示用，例如 "240m"
  widthMode: "std" | "abs"; // band 寬度：σ 倍數，或顯示單位（bp/USDT）的絕對偏移
  widths: number[];
}

export interface LegFunding {
  label: string; // 例 "CRCLUSDT Bybit perp"
  events: { timestamp: number; rateBp: number }[];
}

export interface PairFunding {
  leg1: LegFunding | null; // spot 腿為 null
  leg2: LegFunding | null;
}

interface BasisChartProps {
  // 完整序列，開頭含約 1 天的 warmup 資料（供 indicator 起算），尾端 displayCount 根才上圖
  points: BasisPoint[];
  mode: "pct" | "abs";
  title: string;
  bb: BollingerConfig | null;
  displayCount: number;
  funding: PairFunding | null;
  legLabels: { leg1: string; leg2: string };
  // 每秒用 ticker 現價算出的即時 basis 點；K 線與 BB 不受其影響，僅覆蓋頭部讀值與加即時線
  livePoint: BasisPoint | null;
}

type ChartRow = { time: string; basis: number; fresh: boolean } & Record<
  string,
  string | number | boolean | undefined
>;

export function BasisChart({ points, mode, title, bb, displayCount, funding, legLabels, livePoint }: BasisChartProps) {
  const fmt = (v: number) => (mode === "pct" ? `${v.toFixed(1)} bp` : v.toFixed(4));

  const { data, fundingTimes1, fundingTimes2 } = useMemo(() => {
    // Store time as numeric string so ChartTooltipContent's labelFormatter receives
    // the raw timestamp string (typeof label === "string" branch) rather than falling
    // back to itemConfig?.label which would be "Basis"
    const rows: ChartRow[] = points.map((p) => ({
      time: String(p.time),
      // bp 模式：basisPct 是百分比，×100 換算 basis points
      basis: mode === "pct" ? p.basisPct * 100 : p.basisAbs,
      fresh: p.fresh,
      // 兩腿原始成交價，走右軸
      price1: p.leg1,
      price2: p.leg2,
    }));
    if (bb) {
      // population std、window 內不足的點留 undefined（同 opportunity-spread-modal 慣例）
      for (let i = bb.window - 1; i < rows.length; i++) {
        let sum = 0;
        for (let j = i - bb.window + 1; j <= i; j++) sum += rows[j].basis;
        const ma = sum / bb.window;
        let std = 0;
        if (bb.widthMode === "std") {
          let ssd = 0;
          for (let j = i - bb.window + 1; j <= i; j++) ssd += Math.pow(rows[j].basis - ma, 2);
          std = Math.sqrt(ssd / bb.window);
        }
        rows[i].ma = ma;
        bb.widths.forEach((m, k) => {
          const offset = bb.widthMode === "std" ? m * std : m;
          rows[i][`upper${k}`] = ma + offset;
          rows[i][`lower${k}`] = ma - offset;
        });
      }
    }
    // indicator 用完整序列（含 warmup）計算後，只顯示尾端 displayCount 根
    const visible = rows.slice(-displayCount);

    // funding 併入資料列：
    // 1. 結算時間吸附到最近的蠟燭，收集 time 字串供主圖垂直虛線用
    //    （X 軸是 category 字串軸，ReferenceLine 的 x 必須精確等於某個 row 的 time）
    // 2. 每根蠟燭標註它所屬期別的結算（下一個 >= 蠟燭時間的結算），掛 nfNBp/nfNTime
    //    （tooltip 顯示 + 副圖的 step 線）
    const attach = (legFunding: LegFunding | null, n: 1 | 2): string[] => {
      if (!legFunding || legFunding.events.length === 0 || visible.length === 0) return [];
      const events = [...legFunding.events].sort((a, b) => a.timestamp - b.timestamp);
      const first = Number(visible[0].time);
      const last = Number(visible[visible.length - 1].time);
      const step = visible.length > 1 ? last - Number(visible[visible.length - 2].time) : 0;
      // Set 去重：兩筆結算吸附到同一根蠟燭（或 API 回重複 timestamp）時只畫一條線
      const timeSet = new Set<string>();
      for (const ev of events) {
        if (ev.timestamp < first || ev.timestamp > last + step) continue;
        let best = 0;
        let bestDiff = Infinity;
        for (let i = 0; i < visible.length; i++) {
          const diff = Math.abs(Number(visible[i].time) - ev.timestamp);
          if (diff < bestDiff) {
            bestDiff = diff;
            best = i;
          }
        }
        timeSet.add(visible[best].time);
      }
      const times = [...timeSet];
      // two-pointer：為每根蠟燭找它之後（含當根）最近的結算
      let idx = 0;
      for (const row of visible) {
        const t = Number(row.time);
        while (idx < events.length && events[idx].timestamp < t) idx++;
        if (idx >= events.length) break;
        row[`nf${n}Bp`] = events[idx].rateBp;
        row[`nf${n}Time`] = events[idx].timestamp;
      }
      return times;
    };
    const times1 = attach(funding?.leg1 ?? null, 1);
    const times2 = attach(funding?.leg2 ?? null, 2);

    // 累計 funding：可見窗左緣起算為 0，每經過一次結算就把該期費率加進 running，
    // forward-fill 到每根蠟燭 → 單調階梯線（與上方「每期」圖同資料列數，垂直對齊）
    const cumulate = (legFunding: LegFunding | null, n: 1 | 2) => {
      if (!legFunding || legFunding.events.length === 0 || visible.length === 0) return;
      const events = [...legFunding.events].sort((a, b) => a.timestamp - b.timestamp);
      const first = Number(visible[0].time);
      let running = 0;
      let idx = 0;
      while (idx < events.length && events[idx].timestamp < first) idx++; // 窗前結算不計入
      for (const row of visible) {
        const t = Number(row.time);
        while (idx < events.length && events[idx].timestamp <= t) {
          running += events[idx].rateBp;
          idx++;
        }
        row[`cf${n}Bp`] = running;
      }
    };
    cumulate(funding?.leg1 ?? null, 1);
    cumulate(funding?.leg2 ?? null, 2);

    return { data: visible, fundingTimes1: times1, fundingTimes2: times2 };
  }, [points, mode, bb, displayCount, funding]);

  const chartConfig = useMemo(() => {
    const cfg: ChartConfig = {
      basis: {
        label: "Basis",
        // Tailwind v4 的 --chart-1 已是 oklch 完整色值，不可再包 hsl()
        color: "var(--chart-1)",
      },
    };
    if (bb) {
      cfg.ma = { label: `MA(${bb.windowLabel})`, color: MA_COLOR };
      const unit = bb.widthMode === "std" ? "σ" : mode === "pct" ? " bp" : " USDT";
      bb.widths.forEach((m, k) => {
        const color = BB_COLORS[k % BB_COLORS.length];
        cfg[`upper${k}`] = { label: `+${m}${unit}`, color };
        cfg[`lower${k}`] = { label: `-${m}${unit}`, color };
      });
    }
    if (funding?.leg1) {
      cfg.nf1Bp = { label: funding.leg1.label, color: FUNDING_COLORS.leg1 };
      cfg.cf1Bp = { label: funding.leg1.label, color: FUNDING_COLORS.leg1 };
    }
    if (funding?.leg2) {
      cfg.nf2Bp = { label: funding.leg2.label, color: FUNDING_COLORS.leg2 };
      cfg.cf2Bp = { label: funding.leg2.label, color: FUNDING_COLORS.leg2 };
    }
    cfg.price1 = { label: `${legLabels.leg1} 價`, color: PRICE_COLORS.leg1 };
    cfg.price2 = { label: `${legLabels.leg2} 價`, color: PRICE_COLORS.leg2 };
    return cfg;
  }, [bb, mode, funding, legLabels]);

  // 混合市場（如美股腿）時，用底色標出兩腳皆有真實成交的時段（= 美股開盤）
  const freshRanges = useMemo(() => {
    if (!data.some((r) => !r.fresh)) return null; // 全程都 fresh（純 crypto pair）就不畫
    const ranges: { start: string; end: string }[] = [];
    let start: string | null = null;
    for (let i = 0; i < data.length; i++) {
      if (data[i].fresh && start === null) start = data[i].time;
      if (!data[i].fresh && start !== null) {
        ranges.push({ start, end: data[i - 1].time });
        start = null;
      }
    }
    if (start !== null) ranges.push({ start, end: data[data.length - 1].time });
    return ranges;
  }, [data]);

  const current = data.length > 0 ? data[data.length - 1].basis : null;
  // 即時 basis 換算成當前顯示單位（bp / USDT），與 K 線的 basis 同軸
  const liveBasis =
    livePoint !== null ? (mode === "pct" ? livePoint.basisPct * 100 : livePoint.basisAbs) : null;
  // 頭部大字優先顯示即時值，退回最後一根 K 線
  const displayBasis = liveBasis ?? current;
  const lastTime = data.length > 0 ? data[data.length - 1].time : null;
  const hasFunding1 = fundingTimes1.length > 0;
  const hasFunding2 = fundingTimes2.length > 0;
  const hasFundingPanel = hasFunding1 || hasFunding2;
  const timeLabel = (value: unknown) => format(new Date(Number(value)), "MM/dd HH:mm");

  // 預估年化：可見區間累計 funding（bp→%）依已經過時間線性外推到一年
  const cumAnnualized = useMemo(() => {
    if (data.length < 2) return null;
    const first = Number(data[0].time);
    const last = Number(data[data.length - 1].time);
    const elapsedMs = last - first;
    if (elapsedMs <= 0) return null;
    const factor = (365 * 24 * 3600 * 1000) / elapsedMs;
    const finalCum = (key: string): number | null => {
      const v = data[data.length - 1][key];
      return typeof v === "number" ? v : null;
    };
    const c1 = finalCum("cf1Bp");
    const c2 = finalCum("cf2Bp");
    return {
      leg1: c1 === null ? null : (c1 / 100) * factor, // bp/100 = %，再年化
      leg2: c2 === null ? null : (c2 / 100) * factor,
    };
  }, [data]);
  const fmtPct = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;

  // 賭收斂的交易方向：basis < 0 → leg1 便宜 → Long leg1 / Short leg2；反之相反
  const convergenceHint = (row: ChartRow | undefined) => {
    if (!row || typeof row.basis !== "number" || row.basis === 0) return null;
    const longLabel = row.basis < 0 ? legLabels.leg1 : legLabels.leg2;
    const shortLabel = row.basis < 0 ? legLabels.leg2 : legLabels.leg1;
    return (
      <div className="mt-1 flex flex-col gap-0.5 border-t border-border/50 pt-1 font-normal">
        <span className="text-muted-foreground">賭收斂：</span>
        <span className="text-emerald-600 dark:text-emerald-400">Long　{longLabel}</span>
        <span className="text-red-600 dark:text-red-400">Short　{shortLabel}</span>
      </div>
    );
  };

  // hover 蠟燭所屬期別的 funding（該期結束時結算的費率）
  const fundingPeriodLines = (row: ChartRow | undefined) => {
    if (!row || !funding) return null;
    const legs = [
      { legFunding: funding.leg1, bp: row.nf1Bp, time: row.nf1Time, color: FUNDING_COLORS.leg1 },
      { legFunding: funding.leg2, bp: row.nf2Bp, time: row.nf2Time, color: FUNDING_COLORS.leg2 },
    ].filter((l) => l.legFunding && typeof l.bp === "number" && typeof l.time === "number");
    if (legs.length === 0) return null;
    return (
      <div className="mt-1 flex flex-col gap-0.5 border-t border-border/50 pt-1 font-normal">
        {legs.map((l, i) => (
          <span key={i} className="flex items-center justify-between gap-4" style={{ color: l.color }}>
            <span>{l.legFunding!.label}</span>
            <span className="font-mono tabular-nums">
              {(l.bp as number).toFixed(2)} bp（{format(new Date(l.time as number), "MM/dd HH:mm")} 結算）
            </span>
          </span>
        ))}
      </div>
    );
  };

  return (
    <Card>
      <CardHeader className="flex flex-col items-stretch border-b p-0 sm:flex-row">
        <div className="flex flex-1 flex-col justify-center gap-1 px-6 py-5 sm:py-6">
          <CardTitle className="font-mono text-base">{title}</CardTitle>
          <CardDescription>
            {mode === "pct" ? "Basis（bp，(leg1 − leg2) / leg2）" : "價差（leg1 − leg2，USDT）"}
            {freshRanges && "；亮底 = 美股開盤時段，其餘以最後收盤價 forward-fill"}
          </CardDescription>
        </div>
        <div className="flex">
          <div className="flex flex-1 flex-col justify-center gap-1 border-t px-6 py-4 text-left sm:border-t-0 sm:border-l sm:px-8 sm:py-6">
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {liveBasis !== null ? "即時 Basis" : "目前 Basis"}
              {liveBasis !== null && (
                <span className="relative flex h-2 w-2" title="每秒即時更新">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                </span>
              )}
            </span>
            <span
              className={
                "text-lg font-bold leading-none sm:text-2xl " +
                (displayBasis !== null && displayBasis >= 0
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-red-600 dark:text-red-400")
              }
            >
              {displayBasis !== null ? fmt(displayBasis) : "—"}
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-2 sm:p-6">
        <ChartContainer config={chartConfig} className="aspect-auto h-[250px] w-full sm:h-[320px]">
          <LineChart accessibilityLayer data={data} margin={{ left: 12, right: 12 }}>
            <CartesianGrid vertical={false} />
            {freshRanges?.map((r, i) => (
              <ReferenceArea
                key={`fresh-${i}`}
                x1={r.start}
                x2={r.end}
                fill="var(--chart-1)"
                fillOpacity={0.08}
                strokeOpacity={0}
              />
            ))}
            <XAxis
              dataKey="time"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={48}
              tickFormatter={timeLabel}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={76}
              domain={["auto", "auto"]}
              tickFormatter={(value) => fmt(Number(value))}
            />
            <YAxis
              yAxisId="price"
              orientation="right"
              tickLine={false}
              axisLine={false}
              width={64}
              domain={["auto", "auto"]}
              tick={{ fill: PRICE_COLORS.leg1 }}
              tickFormatter={(value) => fmtPrice(Number(value))}
            />
            <ReferenceLine y={0} strokeDasharray="3 3" stroke="var(--muted-foreground)" />
            {/* 即時 basis：跨圖水平線 + 右緣跳動點（每秒更新，不進 K 線/BB 資料） */}
            {liveBasis !== null && (
              <ReferenceLine
                y={liveBasis}
                stroke="var(--color-basis)"
                strokeDasharray="2 2"
                strokeOpacity={0.5}
              />
            )}
            {liveBasis !== null && lastTime !== null && (
              <ReferenceDot
                x={lastTime}
                y={liveBasis}
                r={4}
                fill="var(--color-basis)"
                stroke="var(--background)"
                strokeWidth={1.5}
                isFront
              />
            )}
            {fundingTimes1.map((t) => (
              <ReferenceLine
                key={`f1-${t}`}
                x={t}
                stroke={FUNDING_COLORS.leg1}
                strokeWidth={1}
                strokeDasharray="4 2"
                strokeOpacity={0.55}
              />
            ))}
            {fundingTimes2.map((t) => (
              <ReferenceLine
                key={`f2-${t}`}
                x={t}
                stroke={FUNDING_COLORS.leg2}
                strokeWidth={1}
                strokeDasharray="4 2"
                strokeOpacity={0.55}
              />
            ))}
            <ChartTooltip
              content={
                <ChartTooltipContent
                  labelFormatter={(value, payload) => {
                    const row = payload?.[0]?.payload as ChartRow | undefined;
                    return (
                      <div className="flex flex-col">
                        <span>{timeLabel(value)}</span>
                        {convergenceHint(row)}
                        {fundingPeriodLines(row)}
                      </div>
                    );
                  }}
                  formatter={(value, name) => {
                    const priceColor =
                      name === "price1"
                        ? PRICE_COLORS.leg1
                        : name === "price2"
                          ? PRICE_COLORS.leg2
                          : undefined;
                    return (
                      <div className="flex w-full items-center justify-between gap-4 leading-none">
                        <span
                          className="text-muted-foreground"
                          style={priceColor ? { color: priceColor } : undefined}
                        >
                          {chartConfig[name as string]?.label ?? name}
                        </span>
                        <span
                          className="font-mono font-medium tabular-nums"
                          style={priceColor ? { color: priceColor } : undefined}
                        >
                          {priceColor ? fmtPrice(Number(value)) : fmt(Number(value))}
                        </span>
                      </div>
                    );
                  }}
                />
              }
            />
            {bb &&
              bb.widths.flatMap((m, k) => {
                const color = BB_COLORS[k % BB_COLORS.length];
                const common = {
                  type: "monotone" as const,
                  stroke: color,
                  strokeWidth: 1,
                  dot: false,
                  isAnimationActive: false,
                  connectNulls: false,
                };
                return [
                  <Line key={`upper${k}`} dataKey={`upper${k}`} {...common} />,
                  <Line key={`lower${k}`} dataKey={`lower${k}`} {...common} />,
                ];
              })}
            {bb && (
              <Line
                dataKey="ma"
                type="monotone"
                stroke={MA_COLOR}
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
                connectNulls={false}
              />
            )}
            <Line
              dataKey="basis"
              type="monotone"
              stroke="var(--color-basis)"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
            <Line
              yAxisId="price"
              dataKey="price1"
              type="monotone"
              stroke={PRICE_COLORS.leg1}
              strokeWidth={1.25}
              strokeOpacity={0.7}
              dot={false}
              isAnimationActive={false}
              connectNulls={false}
            />
            <Line
              yAxisId="price"
              dataKey="price2"
              type="monotone"
              stroke={PRICE_COLORS.leg2}
              strokeWidth={1.25}
              strokeOpacity={0.7}
              dot={false}
              isAnimationActive={false}
              connectNulls={false}
            />
          </LineChart>
        </ChartContainer>

        {hasFundingPanel && (
          <div className="mt-3">
            <div className="mb-1 flex flex-wrap items-center gap-3 px-3 text-xs text-muted-foreground">
              <span>Funding（bp / 期）</span>
              {funding?.leg1 && hasFunding1 && (
                <span className="flex items-center gap-1">
                  <span
                    className="inline-block h-0.5 w-3"
                    style={{ backgroundColor: FUNDING_COLORS.leg1 }}
                  />
                  {funding.leg1.label}
                </span>
              )}
              {funding?.leg2 && hasFunding2 && (
                <span className="flex items-center gap-1">
                  <span
                    className="inline-block h-0.5 w-3"
                    style={{ backgroundColor: FUNDING_COLORS.leg2 }}
                  />
                  {funding.leg2.label}
                </span>
              )}
            </div>
            <ChartContainer config={chartConfig} className="aspect-auto h-[100px] w-full">
              {/* 每期費率的階梯線；X 軸隱藏但與主圖同資料列數 + 同 YAxis 寬度 → 垂直對齊 */}
              <LineChart accessibilityLayer data={data} margin={{ left: 12, right: 12 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="time" hide />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  width={76}
                  domain={["auto", "auto"]}
                  tickCount={3}
                  tickFormatter={(value) => `${Number(value).toFixed(2)}`}
                />
                <ReferenceLine y={0} strokeDasharray="3 3" stroke="var(--muted-foreground)" />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      labelFormatter={timeLabel}
                      formatter={(value, name) => (
                        <div className="flex w-full items-center justify-between gap-4 leading-none">
                          <span className="text-muted-foreground">
                            {chartConfig[name as string]?.label ?? name}
                          </span>
                          <span className="font-mono font-medium tabular-nums">
                            {`${Number(value).toFixed(2)} bp`}
                          </span>
                        </div>
                      )}
                    />
                  }
                />
                {hasFunding1 && (
                  <Line
                    dataKey="nf1Bp"
                    type="stepAfter"
                    stroke={FUNDING_COLORS.leg1}
                    strokeWidth={1.5}
                    dot={false}
                    isAnimationActive={false}
                    connectNulls={false}
                  />
                )}
                {hasFunding2 && (
                  <Line
                    dataKey="nf2Bp"
                    type="stepAfter"
                    stroke={FUNDING_COLORS.leg2}
                    strokeWidth={1.5}
                    dot={false}
                    isAnimationActive={false}
                    connectNulls={false}
                  />
                )}
              </LineChart>
            </ChartContainer>

            <div className="mb-1 mt-3 flex flex-wrap items-center gap-3 px-3 text-xs text-muted-foreground">
              <span>累計 Funding（bp，本區間左緣起算）</span>
              {hasFunding1 && cumAnnualized?.leg1 != null && (
                <span className="flex items-center gap-1">
                  <span
                    className="inline-block h-0.5 w-3"
                    style={{ backgroundColor: FUNDING_COLORS.leg1 }}
                  />
                  預估年化 {fmtPct(cumAnnualized.leg1)}
                </span>
              )}
              {hasFunding2 && cumAnnualized?.leg2 != null && (
                <span className="flex items-center gap-1">
                  <span
                    className="inline-block h-0.5 w-3"
                    style={{ backgroundColor: FUNDING_COLORS.leg2 }}
                  />
                  預估年化 {fmtPct(cumAnnualized.leg2)}
                </span>
              )}
            </div>
            <ChartContainer config={chartConfig} className="aspect-auto h-[100px] w-full">
              {/* 累計費率的階梯線；與上方每期圖同資料列數 + 同 YAxis 寬度 → 垂直對齊 */}
              <LineChart accessibilityLayer data={data} margin={{ left: 12, right: 12 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="time" hide />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  width={76}
                  domain={["auto", "auto"]}
                  tickCount={3}
                  tickFormatter={(value) => `${Number(value).toFixed(1)}`}
                />
                <ReferenceLine y={0} strokeDasharray="3 3" stroke="var(--muted-foreground)" />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      labelFormatter={timeLabel}
                      formatter={(value, name) => (
                        <div className="flex w-full items-center justify-between gap-4 leading-none">
                          <span className="text-muted-foreground">
                            {chartConfig[name as string]?.label ?? name}
                          </span>
                          <span className="font-mono font-medium tabular-nums">
                            {`${Number(value).toFixed(2)} bp`}
                          </span>
                        </div>
                      )}
                    />
                  }
                />
                {hasFunding1 && (
                  <Line
                    dataKey="cf1Bp"
                    type="stepAfter"
                    stroke={FUNDING_COLORS.leg1}
                    strokeWidth={1.5}
                    dot={false}
                    isAnimationActive={false}
                    connectNulls={false}
                  />
                )}
                {hasFunding2 && (
                  <Line
                    dataKey="cf2Bp"
                    type="stepAfter"
                    stroke={FUNDING_COLORS.leg2}
                    strokeWidth={1.5}
                    dot={false}
                    isAnimationActive={false}
                    connectNulls={false}
                  />
                )}
              </LineChart>
            </ChartContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
