import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendPushNotification, type PushPayload } from "@/lib/web-push";

function getAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY not set");
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key);
}

interface TradeData {
  strategy_name: string;
  action: string;
  side: string;
  symbol: string;
  quantity_actual: number;
  price: number;
  exchange: string;
  trade_id: number;
  run_id: string;
  fee_amount_usdt: number;
}

function buildTradeBody(td: TradeData, shareRatio: number): string {
  const qty = td.quantity_actual * shareRatio;
  return (
    `${td.strategy_name}: ${td.action.toUpperCase()} ${td.side.toUpperCase()} ${td.symbol}` +
    ` ${qty.toFixed(4)} @ ${td.price.toFixed(2)} (${td.exchange})`
  );
}

export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization");
  const apiKey = process.env.NOTIFICATION_API_KEY;
  if (!apiKey || authHeader !== `Bearer ${apiKey}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getAdminClient();

  const { type, user_ids, strategy_id, trade_data, payload } = (await request.json()) as {
    type: "trade_every" | "trade_combined" | "nav_change" | "report";
    user_ids?: string[];
    strategy_id?: string;
    trade_data?: TradeData;
    payload: PushPayload;
  };

  const prefFilters: Record<string, string[]> = {
    trade_every: ["trade_notifications", "trade_every"],
    trade_combined: ["trade_notifications", "trade_combined"],
    nav_change: ["nav_change_notifications"],
    report: ["report_notifications"],
  };

  const columns = prefFilters[type] ?? [type];

  let query = supabase
    .from("notification_preferences")
    .select("user_id");

  for (const col of columns) {
    query = query.eq(col, true);
  }

  if (user_ids?.length) {
    query = query.in("user_id", user_ids);
  }

  const { data: enabledUsers, error: prefError } = await query;
  if (prefError) return NextResponse.json({ error: prefError.message }, { status: 500 });
  if (!enabledUsers?.length) return NextResponse.json({ sent: 0 });

  // Filter by trade_strategy_ids if strategy_id is provided for trade notifications
  let filteredUsers = enabledUsers as { user_id: string; trade_strategy_ids?: string[] }[];
  if (strategy_id && (type === "trade_every" || type === "trade_combined")) {
    const { data: prefsWithStrategies } = await supabase
      .from("notification_preferences")
      .select("user_id, trade_strategy_ids")
      .in("user_id", enabledUsers.map((u: { user_id: string }) => u.user_id));

    filteredUsers = (prefsWithStrategies ?? []).filter((u: { user_id: string; trade_strategy_ids?: string[] }) => {
      const ids = u.trade_strategy_ids ?? [];
      return ids.length === 0 || ids.includes(strategy_id);
    });
  }

  const enabledIds = filteredUsers.map((u: { user_id: string }) => u.user_id);
  if (!enabledIds.length) return NextResponse.json({ sent: 0 });

  // Look up share_ratio per user for trade notifications
  let ratioMap = new Map<string, number>();
  if (strategy_id && trade_data && type === "trade_every") {
    const { data: accessRows } = await supabase
      .from("user_strategy_access")
      .select("user_id, share_ratio")
      .eq("strategy_id", strategy_id)
      .in("user_id", enabledIds);

    for (const row of accessRows ?? []) {
      ratioMap.set(row.user_id, Number(row.share_ratio) || 1);
    }
  }

  const { data: subs, error: subError } = await supabase
    .from("push_subscriptions")
    .select("id, user_id, endpoint, p256dh, auth")
    .in("user_id", enabledIds);

  if (subError) return NextResponse.json({ error: subError.message }, { status: 500 });
  if (!subs?.length) return NextResponse.json({ sent: 0 });

  let sent = 0;
  const staleIds: string[] = [];

  await Promise.allSettled(
    subs.map(async (sub: { id: string; user_id: string; endpoint: string; p256dh: string; auth: string }) => {
      try {
        let userPayload = payload;
        if (trade_data && type === "trade_every") {
          const ratio = ratioMap.get(sub.user_id) ?? 1;
          userPayload = { ...payload, body: buildTradeBody(trade_data, ratio) };
        }
        await sendPushNotification(sub, userPayload);
        sent++;
      } catch (err: unknown) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          staleIds.push(sub.id);
        }
      }
    })
  );

  if (staleIds.length) {
    await supabase.from("push_subscriptions").delete().in("id", staleIds);
  }

  return NextResponse.json({ sent, cleaned: staleIds.length });
}
