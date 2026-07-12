"use client";

import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, XAxis, YAxis } from "recharts";
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

  const { data, hasFunding1, hasFunding2 } = useMemo(() => {
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
    // 1. 結算時間吸附到最近的蠟燭，掛 fundingN（副圖 bar 用；X 軸是 category 字串軸）
    // 2. 每根蠟燭標註它所屬期別的結算（下一個 >= 蠟燭時間的結算），掛 nfNBp/nfNTime（tooltip 用）
    let has1 = false;
    let has2 = false;
    const attach = (legFunding: LegFunding | null, n: 1 | 2): boolean => {
      if (!legFunding || legFunding.events.length === 0 || visible.length === 0) return false;
      const events = [...legFunding.events].sort((a, b) => a.timestamp - b.timestamp);
      const first = Number(visible[0].time);
      const last = Number(visible[visible.length - 1].time);
      const step = visible.length > 1 ? last - Number(visible[visible.length - 2].time) : 0;
      let attached = false;
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
        const row = visible[best];
        // 同一根蠟燭若有多筆結算（理論上不會）就累加
        row[`funding${n}`] = ((row[`funding${n}`] as number | undefined) ?? 0) + ev.rateBp;
        attached = true;
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
      return attached;
    };
    has1 = attach(funding?.leg1 ?? null, 1);
    has2 = attach(funding?.leg2 ?? null, 2);
    return { data: visible, hasFunding1: has1, hasFunding2: has2 };
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
    if (funding?.leg1) cfg.funding1 = { label: funding.leg1.label, color: FUNDING_COLORS.leg1 };
    if (funding?.leg2) cfg.funding2 = { label: funding.leg2.label, color: FUNDING_COLORS.leg2 };
    return cfg;
  }, [bb, mode, funding]);

  const current = data.length > 0 ? data[data.length - 1].basis : null;
  const hasFundingBars = hasFunding1 || hasFunding2;
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

        {hasFundingBars && (
          <div className="mt-3">
            <div className="mb-1 flex flex-wrap items-center gap-3 px-3 text-xs text-muted-foreground">
              <span>Funding（bp / 次）</span>
              {funding?.leg1 && hasFunding1 && (
                <span className="flex items-center gap-1">
                  <span
                    className="inline-block h-2 w-2 rounded-[2px]"
                    style={{ backgroundColor: FUNDING_COLORS.leg1 }}
                  />
                  {funding.leg1.label}
                </span>
              )}
              {funding?.leg2 && hasFunding2 && (
                <span className="flex items-center gap-1">
                  <span
                    className="inline-block h-2 w-2 rounded-[2px]"
                    style={{ backgroundColor: FUNDING_COLORS.leg2 }}
                  />
                  {funding.leg2.label}
                </span>
              )}
            </div>
            <ChartContainer config={chartConfig} className="aspect-auto h-[90px] w-full">
              <BarChart accessibilityLayer data={data} margin={{ left: 12, right: 12 }}>
                {/* 隱藏 X 軸但保留刻度定位，與上方主圖同資料列數 + 同 YAxis 寬度 → 垂直對齊 */}
                <XAxis dataKey="time" hide />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  width={76}
                  domain={["auto", "auto"]}
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
                <Bar dataKey="funding1" fill={FUNDING_COLORS.leg1} barSize={3} isAnimationActive={false} />
                <Bar dataKey="funding2" fill={FUNDING_COLORS.leg2} barSize={3} isAnimationActive={false} />
              </BarChart>
            </ChartContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
