"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { DEFAULT_BASIS_CAP, modelTrades, net, prepare, eventKey, type EvalConfig } from "@/lib/model-eval";
import { LIVE_STRATEGIES, matchTrades, type LiveTrade, type MatchedTrade, type ShadowEvent } from "@/lib/live-recon";
import type { ModelRow, ScoredRow } from "@/lib/model-metrics";
import { Section, Table, bp, fmtTs, tone, type EvalSettings } from "./model-evaluation";

/** Live strategy whose entry rule is the page's model rule; Newtonz + model's rule isn't on the page. */
const RULE_STRATEGY = "Super_Newtonz";
const DETAIL_ROW_CAP = 1000;

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, v) => a + v, 0) / xs.length : null);
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * A trade comparable to one shadow event: its outcome is in (y closed, funding
 * settled) and it held through exactly one settlement. A hold across several
 * collects several fundings and several hours of price drift against a
 * single-event shadow — one 4 h SANDUSDT hold alone moved the funding gap by
 * −3.6 bp per trade (2026-10-05) — so those are counted, not averaged.
 */
type Scored = MatchedTrade & { event: ShadowEvent & { y: number; settledFunding: number } };
const isScored = (t: MatchedTrade): t is Scored =>
  t.settlementsCrossed === 1 && t.event?.y != null && t.event.settledFunding != null;

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
  const [strategy, setStrategy] = useState<string>("all");

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
      LIVE_STRATEGIES.map((s) => {
        const all = matched.filter((t) => t.strategy === s.name);
        const ok = all.filter(isScored);
        const priceGaps = ok.map((t) => t.priceBp - t.event.y);
        return {
          ...s,
          trades: all.length,
          scored: ok.length,
          noSettlement: all.filter((t) => t.settlementsCrossed === 0).length,
          pending: all.filter((t) => t.settlementsCrossed === 1 && !isScored(t)).length,
          multi: all.filter((t) => t.settlementsCrossed > 1).length,
          liveNet: mean(ok.map((t) => t.netBp)),
          shadowNet: mean(ok.map((t) => t.event.y + t.event.settledFunding - fee)),
          priceGap: mean(priceGaps),
          priceGapMed: median(priceGaps),
          fundingGap: mean(ok.map((t) => t.fundingBp - t.event.settledFunding)),
          feeGap: mean(ok.map((t) => t.feeBp + fee)),
          liveTotal: all.reduce((a, t) => a + t.netBp, 0),
        };
      }),
    [matched, fee]
  );

  // Does the live strategy trade what the page's model rule trades, in the hours it ran?
  const ruleCheck = useMemo(() => {
    const windows = liveWindows[RULE_STRATEGY] ?? [];
    const inWindow = (ts: number) => windows.some(([a, b]) => ts >= a && ts <= b);
    const cfg: EvalConfig = {
      feeBp: cost,
      marginBp: settings.marginBp,
      period: settings.period,
      basisCap: settings.capOn ? DEFAULT_BASIS_CAP : null,
    };
    const rule = modelTrades(prepare(modelRows, cfg.basisCap).rows, cfg).filter((r) => inWindow(r.ts));
    const ruleKeys = new Set(rule.map(eventKey));
    const live = matched.filter((t) => t.strategy === RULE_STRATEGY && t.settleTs != null);
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
  }, [liveWindows, modelRows, matched, cost, settings.marginBp, settings.period, settings.capOn]);

  const detail = useMemo(() => matched.filter((t) => strategy === "all" || t.strategy === strategy), [matched, strategy]);

  const gapCell = (v: number | null): ReactNode => <span className={tone(v)}>{bp(v)}</span>;

  return (
    <div className="space-y-4 sm:space-y-6">
      <Section
        n={1}
        title="Live vs shadow, per trade"
        desc={`Each live position (both legs) matched to the shadow event it traded: the settlement hour inside its hold. All bp are of both legs' entry notional added together, the shadow's unit. Gap = live − shadow, with the shadow at the exchange fee only (${fee} bp): the price gap is the measured slippage, which the page's Slippage setting (${settings.slipBp} bp) stands in for.`}
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
          Per-trade means over scored trades: one settlement held, shadow y closed and funding settled.{" "}
          {summary.map((s) => `${s.name}: ${s.noSettlement} closed before any settlement, ${s.pending} still pending, ${s.multi} held across several (not comparable)`).join(" · ")}.
          Live total covers every trade, scored or not.
        </p>
      </Section>

      <Section
        n={2}
        title={`${RULE_STRATEGY} vs the page's model rule`}
        desc={`In the hours ${RULE_STRATEGY} was running: the events the page's model rule (cost ${cost.toFixed(2)} + margin ${settings.marginBp}) trades, against the ones it actually traded. Newtonz + model runs a rule the page doesn't model, so it isn't checked.`}
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

      <Section n={3} title="Trades" desc="Every live position in the window, newest first.">
        <div className="flex flex-wrap gap-1">
          {["all", ...LIVE_STRATEGIES.map((s) => s.name)].map((s) => (
            <Button key={s} size="sm" variant={s === strategy ? "default" : "outline"} className="h-7 px-2 text-xs" onClick={() => setStrategy(s)}>
              {s === "all" ? "All" : s}
            </Button>
          ))}
        </div>
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
                <span key="t" className={cn(t.settlementsCrossed > 1 && "text-amber-500")}>
                  {fmtTs(t.settleTs)}
                  {t.settlementsCrossed > 1 && ` · ${t.settlementsCrossed} settlements`}
                </span>
              ) : (
                <span key="t" className="text-amber-500">exit {fmtTs(t.exitMs)} · no settlement</span>
              ),
              <span key="s" className="font-sans">{t.strategy}</span>,
              <span key="y" className="font-sans">{t.symbol}</span>,
              Math.round(t.grossUsd).toLocaleString("en-US"),
              bp(t.priceBp),
              bp(e?.y),
              gapCell(e?.y != null ? t.priceBp - e.y : null),
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
