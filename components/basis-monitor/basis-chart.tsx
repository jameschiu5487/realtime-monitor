"use client";

import { useMemo } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, XAxis, YAxis } from "recharts";
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
}

type ChartRow = { time: string; basis: number } & Record<string, string | number | undefined>;

export function BasisChart({ points, mode, title, bb, displayCount, funding }: BasisChartProps) {
  const fmt = (v: number) => (mode === "pct" ? `${v.toFixed(1)} bp` : v.toFixed(4));

  const { data, fundingTimes1, fundingTimes2 } = useMemo(() => {
    // Store time as numeric string so ChartTooltipContent's labelFormatter receives
    // the raw timestamp string (typeof label === "string" branch) rather than falling
    // back to itemConfig?.label which would be "Basis"
    const rows: ChartRow[] = points.map((p) => ({
      time: String(p.time),
      // bp 模式：basisPct 是百分比，×100 換算 basis points
      basis: mode === "pct" ? p.basisPct * 100 : p.basisAbs,
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
      const times: string[] = [];
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
        times.push(visible[best].time);
      }
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
    if (funding?.leg1) cfg.nf1Bp = { label: funding.leg1.label, color: FUNDING_COLORS.leg1 };
    if (funding?.leg2) cfg.nf2Bp = { label: funding.leg2.label, color: FUNDING_COLORS.leg2 };
    return cfg;
  }, [bb, mode, funding]);

  const current = data.length > 0 ? data[data.length - 1].basis : null;
  const hasFunding1 = fundingTimes1.length > 0;
  const hasFunding2 = fundingTimes2.length > 0;
  const hasFundingPanel = hasFunding1 || hasFunding2;
  const timeLabel = (value: unknown) => format(new Date(Number(value)), "MM/dd HH:mm");

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
          </CardDescription>
        </div>
        <div className="flex">
          <div className="flex flex-1 flex-col justify-center gap-1 border-t px-6 py-4 text-left sm:border-t-0 sm:border-l sm:px-8 sm:py-6">
            <span className="text-xs text-muted-foreground">目前 Basis</span>
            <span
              className={
                "text-lg font-bold leading-none sm:text-2xl " +
                (current !== null && current >= 0
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-red-600 dark:text-red-400")
              }
            >
              {current !== null ? fmt(current) : "—"}
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-2 sm:p-6">
        <ChartContainer config={chartConfig} className="aspect-auto h-[250px] w-full sm:h-[320px]">
          <LineChart accessibilityLayer data={data} margin={{ left: 12, right: 12 }}>
            <CartesianGrid vertical={false} />
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
            <ReferenceLine y={0} strokeDasharray="3 3" stroke="var(--muted-foreground)" />
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
                  labelFormatter={(value, payload) => (
                    <div className="flex flex-col">
                      <span>{timeLabel(value)}</span>
                      {fundingPeriodLines(payload?.[0]?.payload as ChartRow | undefined)}
                    </div>
                  )}
                  formatter={(value, name) => (
                    <div className="flex w-full items-center justify-between gap-4 leading-none">
                      <span className="text-muted-foreground">
                        {chartConfig[name as string]?.label ?? name}
                      </span>
                      <span className="font-mono font-medium tabular-nums">
                        {fmt(Number(value))}
                      </span>
                    </div>
                  )}
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
          </div>
        )}
      </CardContent>
    </Card>
  );
}
