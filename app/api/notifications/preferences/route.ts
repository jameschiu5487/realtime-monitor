import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("notification_preferences")
    .select("*")
    .eq("user_id", user.id)
    .single();

  if (error && error.code !== "PGRST116") {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(
    data || {
      trade_notifications: false,
      trade_every: true,
      trade_combined: false,
      trade_strategy_ids: [],
      nav_change_notifications: false,
      nav_change_threshold: 5,
      nav_strategy_ids: [],
      report_notifications: true,
    }
  );
}

export async function PUT(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const prefs = {
    user_id: user.id,
    trade_notifications: body.trade_notifications ?? false,
    trade_every: body.trade_every ?? true,
    trade_combined: body.trade_combined ?? false,
    trade_strategy_ids: body.trade_strategy_ids ?? [],
    nav_change_notifications: body.nav_change_notifications ?? false,
    nav_change_threshold: body.nav_change_threshold ?? 5,
    nav_strategy_ids: body.nav_strategy_ids ?? [],
    report_notifications: body.report_notifications ?? true,
    updated_at: new Date().toISOString(),
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from("notification_preferences")
    .upsert(prefs, { onConflict: "user_id" });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
