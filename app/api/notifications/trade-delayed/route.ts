import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendPushNotification } from "@/lib/web-push";

function getAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY not set");
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key);
}

export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization");
  const apiKey = process.env.NOTIFICATION_API_KEY;
  if (!apiKey || authHeader !== `Bearer ${apiKey}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { combined_trade_id, run_id, symbol, exchange, ts } = await request.json();

  // Wait 10 seconds for potential hedge pair
  await new Promise((resolve) => setTimeout(resolve, 10000));

  const supabase = getAdminClient();

  // Check for hedge pair: same symbol, different exchange, within 1 minute, same run
  const tradeTs = new Date(ts);
  const { data: nearby } = await supabase
    .from("combined_trades")
    .select("*")
    .eq("run_id", run_id)
    .eq("symbol", symbol)
    .neq("exchange", exchange)
    .neq("combined_trade_id", combined_trade_id)
    .gte("ts", new Date(tradeTs.getTime() - 60000).toISOString())
    .lte("ts", new Date(tradeTs.getTime() + 60000).toISOString())
    .limit(1);

  const match = nearby?.[0];

  // If hedge pair found, only the higher ID sends (avoid duplicate)
  if (match && combined_trade_id < match.combined_trade_id) {
    return NextResponse.json({ skipped: true, reason: "other leg will send" });
  }

  // Look up strategy name
  const { data: runData } = await supabase
    .from("strategy_runs")
    .select("strategy_id")
    .eq("run_id", run_id)
    .single();

  let strategyName = "Unknown";
  if (runData) {
    const { data: strat } = await supabase
      .from("strategies")
      .select("name")
      .eq("strategy_id", runData.strategy_id)
      .single();
    if (strat) strategyName = strat.name;
  }

  // Get the current trade data
  const { data: currentTrade } = await supabase
    .from("combined_trades")
    .select("*")
    .eq("combined_trade_id", combined_trade_id)
    .single();

  if (!currentTrade) {
    return NextResponse.json({ error: "Trade not found" }, { status: 404 });
  }

  let title: string;
  let body: string;

  if (match) {
    // Hedge summary
    const totalPnl = Number(currentTrade.total_pnl) + Number(match.total_pnl);
    const totalFee = Number(currentTrade.commission_fee) + Number(match.commission_fee);
    const totalFunding =
      Number(currentTrade.funding_fee_realized ?? 0) +
      Number(match.funding_fee_realized ?? 0);
    const pnlSign = totalPnl >= 0 ? "+" : "";
    const exchanges = `${currentTrade.exchange}/${match.exchange}`;

    title = "Hedge Closed";
    body =
      `${strategyName}: ${symbol} (${exchanges})` +
      ` | PnL: ${pnlSign}${totalPnl.toFixed(2)}` +
      ` | Fee: ${totalFee.toFixed(2)}` +
      ` | Funding: ${totalFunding.toFixed(2)}`;
  } else {
    // Single position
    const pnl = Number(currentTrade.total_pnl);
    const pnlSign = pnl >= 0 ? "+" : "";

    title = "Position Closed";
    body =
      `${strategyName}: ${(currentTrade.side as string).toUpperCase()} ${symbol}` +
      ` (${exchange})` +
      ` | PnL: ${pnlSign}${pnl.toFixed(2)}` +
      ` | Fee: ${Number(currentTrade.commission_fee).toFixed(2)}` +
      ` | Funding: ${Number(currentTrade.funding_fee_realized ?? 0).toFixed(2)}`;
  }

  // Find users with trade_combined enabled
  const { data: enabledUsers } = await supabase
    .from("notification_preferences")
    .select("user_id")
    .eq("trade_notifications", true)
    .eq("trade_combined", true);

  if (!enabledUsers?.length) return NextResponse.json({ sent: 0 });

  const userIds = enabledUsers.map((u: { user_id: string }) => u.user_id);

  const { data: subs } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .in("user_id", userIds);

  if (!subs?.length) return NextResponse.json({ sent: 0 });

  let sent = 0;
  const staleIds: string[] = [];

  await Promise.allSettled(
    subs.map(async (sub: { id: string; endpoint: string; p256dh: string; auth: string }) => {
      try {
        await sendPushNotification(sub, {
          title,
          body,
          tag: match ? `hedge-${combined_trade_id}` : `combined-${combined_trade_id}`,
          url: "/orders",
        });
        sent++;
      } catch (err: unknown) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) staleIds.push(sub.id);
      }
    })
  );

  if (staleIds.length) {
    await supabase.from("push_subscriptions").delete().in("id", staleIds);
  }

  return NextResponse.json({ sent, title, hedged: !!match });
}
