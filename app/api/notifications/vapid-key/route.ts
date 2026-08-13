import { NextResponse } from "next/server";

/**
 * Exposes the VAPID public key to the service worker.
 *
 * The key is already public — it ships inlined in the client bundle via
 * NEXT_PUBLIC_VAPID_PUBLIC_KEY — but a service worker cannot read build-time
 * env vars, and public/sw.js is served as a static file so nothing is
 * substituted into it. The pushsubscriptionchange handler needs the key to
 * create the replacement subscription, hence this endpoint.
 */
export async function GET() {
  const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!key) {
    return NextResponse.json({ error: "VAPID public key not configured" }, { status: 500 });
  }
  return NextResponse.json({ key });
}
