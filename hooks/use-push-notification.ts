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

  // Re-checks the subscription and quietly restores it when the browser has
  // dropped one. Safe to call repeatedly: it never prompts, and it leaves a
  // deliberate opt-out alone.
  const ensureSubscription = useCallback(async (reg: ServiceWorkerRegistration) => {
    if (Notification.permission === "denied") {
      setState("denied");
      return;
    }
    if (await reg.pushManager.getSubscription()) {
      setState("subscribed");
      return;
    }
    if (Notification.permission === "granted" && !hasOptedOut()) {
      try {
        setState((await createSubscription(reg)) ? "subscribed" : "unsubscribed");
      } catch {
        setState("unsubscribed");
      }
      return;
    }
    setState("unsubscribed");
  }, []);

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setState("unsupported");
      return;
    }

    let disposed = false;
    let checking = false;
    let regRef: ServiceWorkerRegistration | null = null;

    const check = async () => {
      // iOS drops push subscriptions every few days, and pushsubscriptionchange
      // does not fire there to tell us. Checking only on mount means recovery
      // waits for a cold start — resuming the PWA from the app switcher does
      // not remount React — and every notification in between is lost with
      // nothing reporting a failure. So re-check whenever the app comes back to
      // the foreground, which is the soonest we can notice.
      if (disposed || checking || !regRef) return;
      if (document.visibilityState !== "visible") return;
      checking = true;
      try {
        await ensureSubscription(regRef);
      } finally {
        checking = false;
      }
    };

    navigator.serviceWorker
      .register("/sw.js")
      .then(async (reg) => {
        if (disposed) return;
        regRef = reg;
        setRegistration(reg);
        await ensureSubscription(reg);
        document.addEventListener("visibilitychange", check);
      })
      .catch(() => setState("unsupported"));

    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", check);
    };
  }, [ensureSubscription]);

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
