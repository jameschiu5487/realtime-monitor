"use client";

import { useState, useEffect, useCallback } from "react";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

/**
 * Creates a push subscription and registers it server-side. Assumes permission
 * has already been granted — it deliberately does not prompt, so it is safe to
 * call on load during silent recovery.
 */
async function createSubscription(registration: ServiceWorkerRegistration): Promise<boolean> {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!publicKey) return false;

  const keyBytes = urlBase64ToUint8Array(publicKey);
  const sub = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: keyBytes.buffer as ArrayBuffer,
  });

  const res = await fetch("/api/notifications/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      subscription: sub.toJSON(),
      deviceName: navigator.userAgent.slice(0, 100),
    }),
  });
  return res.ok;
}

/**
 * Records that the user turned notifications off on purpose.
 *
 * Needed because switching off only drops the subscription — the browser
 * permission stays "granted". Without this flag the silent recovery below
 * cannot tell a deliberate opt-out from a subscription the browser discarded,
 * and would helpfully turn notifications back on at the next page load.
 */
const OPT_OUT_KEY = "push-opt-out";

function hasOptedOut(): boolean {
  try {
    return localStorage.getItem(OPT_OUT_KEY) === "1";
  } catch {
    return false;
  }
}

function setOptedOut(value: boolean): void {
  try {
    if (value) localStorage.setItem(OPT_OUT_KEY, "1");
    else localStorage.removeItem(OPT_OUT_KEY);
  } catch {
    // Private mode or blocked storage: recovery just stays manual.
  }
}

export type PushState = "unsupported" | "denied" | "prompt" | "subscribed" | "unsubscribed" | "loading";

export function usePushNotification() {
  const [state, setState] = useState<PushState>("loading");
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setState("unsupported");
      return;
    }

    navigator.serviceWorker
      .register("/sw.js")
      .then(async (reg) => {
        setRegistration(reg);
        const sub = await reg.pushManager.getSubscription();

        if (Notification.permission === "denied") {
          setState("denied");
          return;
        }
        if (sub) {
          setState("subscribed");
          return;
        }
        if (Notification.permission === "granted" && !hasOptedOut()) {
          // Permission is still granted, the user has not switched this off,
          // yet the subscription is gone. That is the browser's doing — key
          // rotation, or iOS reclaiming storage for a PWA that sat unused —
          // and left alone it reads as "Not enabled" until someone notices and
          // taps again, which is the reported "it disables itself" behaviour.
          // Re-subscribing needs no prompt, so just do it.
          try {
            setState((await createSubscription(reg)) ? "subscribed" : "unsubscribed");
          } catch {
            setState("unsubscribed");
          }
          return;
        }
        setState("unsubscribed");
      })
      .catch(() => setState("unsupported"));
  }, []);

  const subscribe = useCallback(async () => {
    if (!registration) return false;
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState("denied");
        return false;
      }
      if (!(await createSubscription(registration))) {
        throw new Error("Failed to save subscription");
      }
      setOptedOut(false);
      setState("subscribed");
      return true;
    } catch {
      return false;
    }
  }, [registration]);

  const unsubscribe = useCallback(async () => {
    if (!registration) return false;
    try {
      const sub = await registration.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/notifications/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      // Remember this was deliberate so the recovery path leaves it alone.
      setOptedOut(true);
      setState("unsubscribed");
      return true;
    } catch {
      return false;
    }
  }, [registration]);

  return { state, subscribe, unsubscribe };
}
