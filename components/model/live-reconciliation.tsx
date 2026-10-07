"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { cn } from "@/lib/utils";
import { DEFAULT_BASIS_CAP, modelTrades, net, prepare, eventKey, type EvalConfig } from "@/lib/model-eval";
import { LIVE_STRATEGIES, excludedReason, matchTrades, type LiveTrade, type MatchedTrade, type ShadowEvent } from "@/lib/live-recon";
import type { ModelRow, ScoredRow } from "@/lib/model-metrics";
import { CurveChart, Section, Table, bp, fmtTs, tone, type CurveSeries, type EvalSettings } from "./model-evaluation";

/** Live strategy whose entry rule is the page's model rule; Newtonz + model's rule isn't on the page. */
const RULE_STRATEGY = "Super_Newtonz";
const DETAIL_ROW_CAP = 1000;

/** Histogram: 2 bp bins across ±20 bp, everything beyond in one tail bin each side. */
const GAP_BIN_BP = 2;
const GAP_RANGE_BP = 20;
const STRATEGY_COLORS: Record<string, string> = { Super_Newtonz: "#0ea5e9", Newtonz: "#f59e0b" };
type GapKind = "price" | "slip" | "other" | "net";
const GAP_KINDS: { key: GapKind; label: string }[] = [
  { key: "price", label: "Price gap" },
  { key: "slip", label: "Exec slippage" },
  { key: "other", label: "Quote / timing" },
  { key: "net", label: "Net gap" },
];

const quantile = (xs: number[], q: number) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))];
};

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, v) => a + v, 0) / xs.length : null);
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * A trade comparable to one shadow event: its outcome is in (y closed, funding
 * settled) and it held through at most one settlement. An early exit (0, e.g.
 * FundingReversal) counts — it is the live result of the model's entry. A hold
 * across several collects several fundings and hours of price drift against a
 * single-event shadow — one 4 h SANDUSDT hold alone moved the funding gap by
 * −3.6 bp per trade (2026-10-05) — so those are counted, not averaged.
 */
type Scored = MatchedTrade & { event: ShadowEvent & { y: number; settledFunding: number } };
const isScored = (t: MatchedTrade): t is Scored =>
  t.settlementsCrossed <= 1 && t.event?.y != null && t.event.settledFunding != null;

export function LiveReconciliation({
  liveTrades,
  liveWindows,
  allRows,
  modelRows,
  settings,
}: {
  liveTrades: LiveTrade[];
  liveWindows: Record<string, [number, number][]>;
  /** Every model and source, for event-level facts (y, settled funding), which don't depend on the model. */
  allRows: ModelRow[];
  /** The page's model under the page's filters, for the rule check. */
  modelRows: ScoredRow[];
  settings: EvalSettings;
}) {
  const fee = settings.feeBp;
  const cost = settings.feeBp + settings.slipBp;
  // One strategy at a time (or both); every section follows it.
  const [strategy, setStrategy] = useState<string>(LIVE_STRATEGIES[0].name);
  const shown = useMemo(() => LIVE_STRATEGIES.filter((s) => strategy === "all" || s.name === strategy), [strategy]);
  const showRuleCheck = shown.some((s) => s.name === RULE_STRATEGY);

  const events = useMemo(() => {
    const m = new Map<string, ShadowEvent>();
    for (const r of allRows) {
      const key = `${r.fundingTs}|${r.symbol}`;
      const prev = m.get(key);
      // Prefer a row that already carries the outcome.
      if (prev && (prev.y != null || r.yTrue == null)) continue;
      m.set(key, { ts: r.fundingTs, symbol: r.symbol, y: r.yTrue, settledFunding: r.settledFundingBp, expFunding: r.expFundingBp });
    }
    return m;
  }, [allRows]);
  const matched = useMemo(() => matchTrades(liveTrades, events), [liveTrades, events]);

  // Gaps are against the shadow at the exchange fee only, so the price gap is
  // the measured slippage the page's Slippage setting stands in for.
  const summary = useMemo(
    () =>
      shown.map((s) => {
        const all = matched.filter((t) => t.strategy === s.name && !excludedReason(t));
        const ok = all.filter(isScored);
        const priceGaps = ok.map((t) => t.priceBp - t.event.y);
        return {
          ...s,
          trades: all.length,
          scored: ok.length,
          noEvent: all.filter((t) => t.event == null).length,
          earlyExit: all.filter((t) => t.event && t.settlementsCrossed === 0).length,
          pending: all.filter((t) => t.event && t.settlementsCrossed <= 1 && !isScored(t)).length,
          multi: all.filter((t) => t.settlementsCrossed > 1).length,
          liveNet: mean(ok.map((t) => t.netBp)),
          shadowNet: mean(ok.map((t) => t.event.y + t.event.settledFunding - fee)),
          priceGap: mean(priceGaps),
          priceGapMed: median(priceGaps),
          fundingGap: mean(ok.map((t) => t.fundingBp - t.event.settledFunding)),
          feeGap: mean(ok.map((t) => t.feeBp + fee)),
          liveTotal: all.reduce((a, t) => a + t.netBp, 0),
          // Price gap = −execution slippage + the rest, over the trades whose
          // slippage was measured (the same subset for all three).
          ...(() => {
            const m = ok.filter((t) => t.execSlipBp != null);
            const pg = mean(m.map((t) => t.priceBp - t.event.y));
            const slip = mean(m.map((t) => -(t.execSlipBp as number)));
            return {
              slipN: m.length,
              slipPriceGap: pg,
              slipGap: slip,
              otherGap: pg != null && slip != null ? pg - slip : null,
              slipShare: pg != null && slip != null && pg < 0 ? slip / pg : null,
            };
          })(),
        };
      }),
    [matched, fee, shown]
  );

  // Does the live strategy trade what the page's model rule trades, in the hours it ran?
  const ruleCheck = useMemo(() => {
    const windows = liveWindows[RULE_STRATEGY] ?? [];
    const inWindow = (ts: number) => windows.some(([a, b]) => ts >= a && ts <= b);
    const cfg: EvalConfig = {
      feeBp: fee,
      slipBp: settings.slipBp,
      marginBp: settings.marginBp,
      period: settings.period,
      basisCap: settings.capOn ? DEFAULT_BASIS_CAP : null,
    };
    const rule = modelTrades(prepare(modelRows, cfg.basisCap).rows, cfg).filter((r) => inWindow(r.ts));
    const ruleKeys = new Set(rule.map(eventKey));
    const live = matched.filter((t) => t.strategy === RULE_STRATEGY && t.settleTs != null && !excludedReason(t));
    const liveKeys = new Set(live.map((t) => `${t.settleTs}|${t.symbol}`));
    const shadowOnly = rule.filter((r) => !liveKeys.has(eventKey(r)));
    const liveOnly = live.filter((t) => !ruleKeys.has(`${t.settleTs}|${t.symbol}`));
    return {
      rule: rule.length,
      both: live.length - liveOnly.length,
      shadowOnly: shadowOnly.length,
      shadowOnlyNet: shadowOnly.reduce((a, r) => a + net(r, cost), 0),
      liveOnly: liveOnly.length,
      liveOnlyNet: liveOnly.reduce((a, t) => a + t.netBp, 0),
    };
  }, [liveWindows, modelRows, matched, fee, cost, settings.slipBp, settings.marginBp, settings.period, settings.capOn]);

  // One gap per scored trade, per strategy: price gap = measured slippage,
  // net gap = everything (price + funding + fee).
  const [gapKind, setGapKind] = useState<GapKind>("price");
  const gaps = useMemo(
    () =>
      shown.map((s) => ({
        name: s.name,
        values: matched
          .filter((t): t is Scored => t.strategy === s.name && !excludedReason(t) && isScored(t))
          .filter((t) => (gapKind === "slip" || gapKind === "other" ? t.execSlipBp != null : true))
          .map((t) => {
            const priceGap = t.priceBp - t.event.y;
            if (gapKind === "price") return priceGap;
            if (gapKind === "slip") return -(t.execSlipBp as number);
            if (gapKind === "other") return priceGap + (t.execSlipBp as number);
            return t.netBp - (t.event.y + t.event.settledFunding - fee);
          }),
      })),
    [matched, gapKind, fee, shown]
  );
  const histogram = useMemo(() => {
    const edges: number[] = [];
    for (let x = -GAP_RANGE_BP; x < GAP_RANGE_BP; x += GAP_BIN_BP) edges.push(x);
    const bins = [
      { label: `< ${-GAP_RANGE_BP}`, lo: -Infinity, hi: -GAP_RANGE_BP },
      ...edges.map((lo) => ({ label: `${lo}`, lo, hi: lo + GAP_BIN_BP })),
      { label: `≥ ${GAP_RANGE_BP}`, lo: GAP_RANGE_BP, hi: Infinity },
    ];
    return bins.map((b) => {
      const row: Record<string, number | string> = { label: b.label, range: Number.isFinite(b.lo) && Number.isFinite(b.hi) ? `${b.lo} ~ ${b.hi}` : b.label };
      for (const g of gaps) row[g.name] = g.values.filter((v) => v >= b.lo && v < b.hi).length;
      return row;
    });
  }, [gaps]);

  // Cumulative live vs shadow over the same scored trades, settlement order.
  // Shadow at the exchange fee only, as in the tables, so the gap between a
  // strategy's two lines is the cumulative slippage + funding + fee gap.
  const [curveUnit, setCurveUnit] = useState<"bp" | "usd">("bp");
  const curves = useMemo(() => {
    const scale = (t: Scored) => (curveUnit === "usd" ? t.grossUsd / 1e4 : 1);
    const series: CurveSeries[] = [];
    const diffs: CurveSeries[] = [];
    const ts = new Set<number>();
    for (const s of shown) {
      const trades = matched
        .filter((t): t is Scored => t.strategy === s.name && !excludedReason(t) && isScored(t))
        .sort((a, b) => a.event.ts - b.event.ts);
      const live = new Map<number, number>();
      const shadow = new Map<number, number>();
      // Execution slippage alone, as a gap (negative = cost); fills not found add 0.
      const slip = new Map<number, number>();
      for (const t of trades) {
        ts.add(t.event.ts);
        live.set(t.event.ts, (live.get(t.event.ts) ?? 0) + t.netBp * scale(t));
        slip.set(t.event.ts, (slip.get(t.event.ts) ?? 0) - (t.execSlipBp ?? 0) * scale(t));
        shadow.set(t.event.ts, (shadow.get(t.event.ts) ?? 0) + (t.event.y + t.event.settledFunding - fee) * scale(t));
      }
      const cumulate = (m: Map<number, number>) => {
        let c = 0;
        return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([t, v]) => ({ ts: t, cum: (c += v) }));
      };
      const color = STRATEGY_COLORS[s.name];
      const gap = new Map([...live].map(([t, v]) => [t, v - (shadow.get(t) ?? 0)]));
      diffs.push(
        { key: `${s.name}_diff`, label: `${s.name} live − shadow`, color, stats: { n: trades.length, curve: cumulate(gap) }, width: 2 },
        { key: `${s.name}_slip`, label: `${s.name} exec slippage`, color, stats: { n: trades.length, curve: cumulate(slip) }, dash: "4 3" }
      );
      series.push(
        { key: `${s.name}_live`, label: `${s.name} live`, color, stats: { n: trades.length, curve: cumulate(live) }, width: 2 },
        { key: `${s.name}_shadow`, label: `${s.name} shadow`, color, stats: { n: trades.length, curve: cumulate(shadow) }, dash: "4 3" }
      );
    }
    return { series, diffs, timeline: [...ts].sort((a, b) => a - b) };
  }, [matched, fee, curveUnit, shown]);

  const detail = useMemo(() => matched.filter((t) => strategy === "all" || t.strategy === strategy), [matched, strategy]);

  const gapCell = (v: number | null): ReactNode => <span className={tone(v)}>{bp(v)}</span>;

  // Sections are numbered in display order; the rule check only shows for Super_Newtonz.
  let n = 0;
  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-wrap gap-1">
        {[...LIVE_STRATEGIES.map((s) => s.name), "all"].map((s) => (
          <Button key={s} size="sm" variant={s === strategy ? "default" : "outline"} className="h-7 px-2 text-xs" onClick={() => setStrategy(s)}>
            {s === "all" ? "Both" : s}
          </Button>
        ))}
      </div>
      <Section
        n={++n}
        title="Live vs shadow, per trade"
        desc={`Each live position (both legs) matched to the shadow event it was entered for: the first settlement after entry. All bp are of both legs' entry notional added together, the shadow's unit. Gap = live − shadow, with the shadow at the exchange fee only (${fee} bp), so the price gap is what the page's Slippage setting (${settings.slipBp} bp) stands in for.`}
      >
        <Table
          head={["", "Trades", "Scored", "Live net", "Shadow net", "Gap", "Price gap", "Price gap (median)", "Funding gap", "Fee gap", "Live total"]}
          rows={summary.map((s) => [
            <span key="n" className="font-sans font-medium">
              {s.name} <span className="text-muted-foreground">({s.note})</span>
            </span>,
            s.trades,
            s.scored,
            gapCell(s.liveNet),
            gapCell(s.shadowNet),
            <span key="g" className={cn("font-semibold", tone(s.liveNet != null && s.shadowNet != null ? s.liveNet - s.shadowNet : null))}>
              {bp(s.liveNet != null && s.shadowNet != null ? s.liveNet - s.shadowNet : null)}
            </span>,
            gapCell(s.priceGap),
            gapCell(s.priceGapMed),
            gapCell(s.fundingGap),
            gapCell(s.feeGap),
            gapCell(s.liveTotal),
          ])}
        />
        <p className="text-xs text-muted-foreground">
          Per-trade means over scored trades: matched to the settlement they were entered for, shadow y closed and funding settled.
          Early exits (left before that settlement, e.g. FundingReversal) are scored against the shadow holding through it.{" "}
          {summary.map((s) => `${s.name}: ${s.earlyExit} early exits, ${s.pending} still pending, ${s.multi} held across several (not comparable), ${s.noEvent} with no shadow event`).join(" · ")}.
          Left out everywhere but the trade list: trades from before a strategy ran the model (Newtonz before{" "}
          {fmtTs(LIVE_STRATEGIES.find((s) => s.name === "Newtonz")?.modelSince ?? 0)}) and basis exits — ZReverted (z-score
          reverted, almost always before the settlement) and MaxHoldingTime (held for hours, across several settlements).
          Live total covers every trade, scored or not.
        </p>

        <div className="pt-2 text-xs font-medium">How much of the price gap is execution slippage</div>
        <Table
          head={["", "Trades", "Price gap", "= Exec slippage", "+ Quote / timing", "Slippage share"]}
          rows={summary.map((s) => [
            <span key="n" className="font-sans font-medium">{s.name}</span>,
            s.slipN,
            gapCell(s.slipPriceGap),
            gapCell(s.slipGap),
            gapCell(s.otherGap),
            s.slipShare == null ? "—" : `${(100 * s.slipShare).toFixed(0)}%`,
          ])}
        />
        <p className="text-xs text-muted-foreground">
          Exec slippage is the engine&apos;s own measure per fill (trades.exec_slippage_bps: fill price vs its reference quote, positive = paid),
          summed over the position&apos;s open and close fills and put on the shadow&apos;s unit; shown as a negative gap. The binance leg
          fills as a maker at its limit price, so it adds no slippage. Quote / timing is the rest of the price gap: the engine&apos;s reference
          quotes and fill times differ from the prices and times the shadow&apos;s y is measured on. Per-trade means over scored trades
          whose fills were found.
        </p>
      </Section>

      <Section
        n={++n}
        title="Equity curve: live vs shadow"
        desc={`Cumulative net of the scored trades above, per strategy: live solid, shadow dashed (at the exchange fee ${fee} bp, no slippage). The space between a strategy's two lines is its cumulative gap. bp adds each trade's bp; USD weights by its notional.`}
      >
        <div className="flex gap-1">
          {(["bp", "usd"] as const).map((u) => (
            <Button key={u} size="sm" variant={u === curveUnit ? "default" : "outline"} className="h-7 px-2 text-xs" onClick={() => setCurveUnit(u)}>
              {u === "bp" ? "bp" : "USD"}
            </Button>
          ))}
        </div>
        <CurveChart series={curves.series} timeline={curves.timeline} />
        <div className="text-xs font-medium">Cumulative diff (live − shadow), with the execution slippage part dashed</div>
        <CurveChart series={curves.diffs} timeline={curves.timeline} height={160} />
      </Section>

      <Section
        n={++n}
        title="Gap distribution"
        desc={`Live − shadow per scored trade, in ${GAP_BIN_BP} bp bins (tails beyond ±${GAP_RANGE_BP} bp pooled). Price gap = exec slippage (as a negative gap) + quote / timing; net gap adds the funding and fee gaps, with the shadow at the exchange fee only. The slippage views only count trades whose fills were found.`}
      >
        <div className="flex flex-wrap gap-1">
          {GAP_KINDS.map((k) => (
            <Button key={k.key} size="sm" variant={k.key === gapKind ? "default" : "outline"} className="h-7 px-2 text-xs" onClick={() => setGapKind(k.key)}>
              {k.label}
            </Button>
          ))}
        </div>
        <ChartContainer
          config={Object.fromEntries(shown.map((s) => [s.name, { label: s.name, color: STRATEGY_COLORS[s.name] }]))}
          className="aspect-auto h-[220px] w-full"
        >
          <BarChart data={histogram} margin={{ left: 4, right: 4, top: 8 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} className="text-xs" tick={{ fontSize: 10 }} />
            <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={28} className="text-xs" />
            <ChartTooltip content={<ChartTooltipContent labelFormatter={(_, p) => `${p?.[0]?.payload?.range} bp`} />} />
            <ChartLegend content={<ChartLegendContent />} />
            {shown.map((s) => (
              <Bar key={s.name} dataKey={s.name} fill={`var(--color-${s.name})`} radius={2} isAnimationActive={false} />
            ))}
          </BarChart>
        </ChartContainer>
        <Table
          head={["", "n", "Mean", "Median", "P10", "P90", "Share < 0"]}
          rows={gaps.map((g) => [
            <span key="n" className="font-sans font-medium">{g.name}</span>,
            g.values.length,
            gapCell(mean(g.values)),
            gapCell(median(g.values)),
            gapCell(quantile(g.values, 0.1)),
            gapCell(quantile(g.values, 0.9)),
            g.values.length ? `${((100 * g.values.filter((v) => v < 0).length) / g.values.length).toFixed(0)}%` : "—",
          ])}
        />
      </Section>

      {showRuleCheck && (
      <Section
        n={++n}
        title={`${RULE_STRATEGY} vs the page's model rule`}
        desc={`In the hours ${RULE_STRATEGY} was running: the events the page's model rule (fee ${fee} + margin ${settings.marginBp}) trades, against the ones it actually traded. Newtonz + model runs a rule the page doesn't model, so it isn't checked.`}
      >
        <Table
          head={["", "Trades", "Net bp"]}
          rows={[
            ["Rule trades", ruleCheck.rule, ""],
            ["Both", ruleCheck.both, ""],
            [
              "Rule only (live didn't trade)",
              ruleCheck.shadowOnly,
              <span key="s" className={tone(ruleCheck.shadowOnlyNet)}>{bp(ruleCheck.shadowOnlyNet, 1)} (shadow)</span>,
            ],
            [
              "Live only (rule wouldn't trade)",
              ruleCheck.liveOnly,
              <span key="l" className={tone(ruleCheck.liveOnlyNet)}>{bp(ruleCheck.liveOnlyNet, 1)} (live)</span>,
            ],
          ]}
        />
        <p className="text-xs text-muted-foreground">
          Rule-only events can be capital or position limits, a different model version, or entries the live engine skipped; live-only ones mean its decision
          differs from the page&apos;s (another threshold, exp_funding read at another time).
        </p>
      </Section>

      )}

      <Section n={++n} title="Trades" desc="Every live position in the window, newest first.">
        <Table
          scroll
          head={[
            "Settlement",
            "Strategy",
            "Symbol",
            "Notional (2 legs)",
            "Live price",
            "Shadow y",
            "Price gap",
            "Exec slip",
            "Live funding",
            "Shadow funding",
            "Funding gap",
            "Live fee",
            "Live net",
            "Shadow net",
            "Gap",
          ]}
          rows={detail.slice(0, DETAIL_ROW_CAP).map((t) => {
            const e = t.event;
            const shadowNet = e?.y != null && e.settledFunding != null ? e.y + e.settledFunding - fee : null;
            return [
              t.settleTs != null ? (
                <span key="t" className={cn(t.settlementsCrossed !== 1 && "text-amber-500")}>
                  {fmtTs(t.settleTs)}
                  {t.settlementsCrossed > 1 && ` · ${t.settlementsCrossed} settlements`}
                  {t.settlementsCrossed === 0 && ` · exit ${fmtTs(t.exitMs)}, early`}
                </span>
              ) : (
                <span key="t" className="text-amber-500">exit {fmtTs(t.exitMs)} · no shadow event</span>
              ),
              <span key="s" className="font-sans">
                {t.strategy}
                {excludedReason(t) && <span className="text-muted-foreground"> · {excludedReason(t)}</span>}
              </span>,
              <span key="y" className="font-sans">{t.symbol}</span>,
              Math.round(t.grossUsd).toLocaleString("en-US"),
              bp(t.priceBp),
              bp(e?.y),
              gapCell(e?.y != null ? t.priceBp - e.y : null),
              <span key="x" className={tone(t.execSlipBp == null ? null : -t.execSlipBp)}>
                {t.execSlipBp == null ? "—" : bp(-t.execSlipBp)}
              </span>,
              bp(t.fundingBp),
              bp(e?.settledFunding),
              gapCell(e?.settledFunding != null ? t.fundingBp - e.settledFunding : null),
              bp(t.feeBp),
              <span key="l" className={tone(t.netBp)}>{bp(t.netBp)}</span>,
              <span key="h" className={tone(shadowNet)}>{bp(shadowNet)}</span>,
              gapCell(shadowNet != null ? t.netBp - shadowNet : null),
            ];
          })}
        />
        {detail.length > DETAIL_ROW_CAP && (
          <p className="text-xs text-muted-foreground">Newest {DETAIL_ROW_CAP} of {detail.length} shown.</p>
        )}
      </Section>
    </div>
  );
}
