import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendPushNotification, type PushPayload } from "@/lib/web-push";

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

  const supabase = getAdminClient();

  const { type, user_ids, payload } = (await request.json()) as {
    type: "trade" | "nav_change" | "report";
    user_ids?: string[];
    payload: PushPayload;
  };

  const prefColumn = {
    trade: "trade_notifications",
    nav_change: "nav_change_notifications",
    report: "report_notifications",
  }[type];

  let query = supabase
    .from("notification_preferences")
    .select("user_id")
    .eq(prefColumn, true);

  if (user_ids?.length) {
    query = query.in("user_id", user_ids);
  }

  const { data: enabledUsers, error: prefError } = await query;
  if (prefError) return NextResponse.json({ error: prefError.message }, { status: 500 });
  if (!enabledUsers?.length) return NextResponse.json({ sent: 0 });

  const enabledIds = enabledUsers.map((u: { user_id: string }) => u.user_id);

  const { data: subs, error: subError } = await supabase
    .from("push_subscriptions")
    .select("id, user_id, endpoint, p256dh, auth")
    .in("user_id", enabledIds);

  if (subError) return NextResponse.json({ error: subError.message }, { status: 500 });
  if (!subs?.length) return NextResponse.json({ sent: 0 });

  let sent = 0;
  const staleIds: string[] = [];

  await Promise.allSettled(
    subs.map(async (sub: { id: string; endpoint: string; p256dh: string; auth: string }) => {
      try {
        await sendPushNotification(sub, payload);
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
