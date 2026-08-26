import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { subscription, deviceName } = await request.json();
  if (!subscription?.endpoint || !subscription?.keys) {
    return NextResponse.json({ error: "Invalid subscription" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from("push_subscriptions")
    .upsert(
      {
        user_id: user.id,
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        device_name: deviceName || null,
      },
      { onConflict: "user_id,endpoint" }
    );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Drop this device's superseded rows.
  //
  // Re-subscribing yields a brand new endpoint, and the upsert keys on
  // (user_id, endpoint), so every recovery inserted rather than replaced —
  // one iPhone had four rows. Apple keeps returning 201 for the dead ones
  // instead of the 410 that would clean them up, so they never expire and the
  // "sent" count reports successes that reach nobody.
  //
  // Matching on device_name means a second identical device would be dropped
  // too; it re-registers on its next foreground check, which is cheap now.
  const deviceKey = deviceName || null;
  if (deviceKey) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: pruneError } = await (supabase as any)
      .from("push_subscriptions")
      .delete()
      .eq("user_id", user.id)
      .eq("device_name", deviceKey)
      .neq("endpoint", subscription.endpoint);
    if (pruneError) {
      // The new subscription is already saved; a failed prune only leaves
      // stale rows behind, so log it rather than failing the request.
      console.error("[notifications/subscribe] prune failed", pruneError.message);
    }
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { endpoint } = await request.json();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from("push_subscriptions")
    .delete()
    .eq("user_id", user.id)
    .eq("endpoint", endpoint);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
