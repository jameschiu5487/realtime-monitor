import { createClient } from "@/lib/supabase/server";
import { sendPushNotification } from "@/lib/web-push";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { targetEmail, reportName } = await request.json();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: prefs } = await (supabase as any)
    .rpc("get_user_push_info_by_email", { target_email: targetEmail });

  if (!prefs?.length) return NextResponse.json({ sent: 0 });

  const enabledUsers = prefs.filter((p: { report_notifications: boolean }) => p.report_notifications);
  if (!enabledUsers.length) return NextResponse.json({ sent: 0 });

  let sent = 0;
  for (const sub of enabledUsers) {
    try {
      await sendPushNotification(
        { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
        {
          title: "Report Shared",
          body: `${user.email} shared "${reportName}" with you`,
          tag: "report-shared",
          url: "/report",
        }
      );
      sent++;
    } catch {
      // ignore stale subscriptions
    }
  }

  return NextResponse.json({ sent });
}
