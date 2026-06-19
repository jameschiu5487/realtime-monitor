"use client";

import { useState, useEffect, useCallback } from "react";
import { Bell, BellOff, Loader2, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { usePushNotification, type PushState } from "@/hooks/use-push-notification";

interface Strategy {
  strategy_id: string;
  name: string;
}

interface NotificationPrefs {
  trade_notifications: boolean;
  trade_every: boolean;
  trade_combined: boolean;
  trade_strategy_ids: string[];
  nav_change_notifications: boolean;
  nav_change_threshold: number;
  nav_strategy_ids: string[];
  report_notifications: boolean;
}

const defaultPrefs: NotificationPrefs = {
  trade_notifications: false,
  trade_every: true,
  trade_combined: false,
  trade_strategy_ids: [],
  nav_change_notifications: false,
  nav_change_threshold: 5,
  nav_strategy_ids: [],
  report_notifications: true,
};

export function NotificationSettings({ strategies }: { strategies: Strategy[] }) {
  const { state: pushState, subscribe, unsubscribe } = usePushNotification();
  const [prefs, setPrefs] = useState<NotificationPrefs>(defaultPrefs);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    fetch("/api/notifications/preferences")
      .then((r) => r.json())
      .then((data) => {
        if (!data.error) {
          setPrefs({
            trade_notifications: data.trade_notifications ?? false,
            trade_every: data.trade_every ?? true,
            trade_combined: data.trade_combined ?? false,
            trade_strategy_ids: data.trade_strategy_ids ?? [],
            nav_change_notifications: data.nav_change_notifications ?? false,
            nav_change_threshold: data.nav_change_threshold ?? 5,
            nav_strategy_ids: data.nav_strategy_ids ?? [],
            report_notifications: data.report_notifications ?? true,
          });
        }
      })
      .finally(() => setIsLoading(false));
  }, []);

  const updatePref = useCallback(
    <K extends keyof NotificationPrefs>(key: K, value: NotificationPrefs[K]) => {
      setPrefs((prev) => ({ ...prev, [key]: value }));
      setDirty(true);
    },
    []
  );

  const toggleTradeStrategy = useCallback((strategyId: string) => {
    setPrefs((prev) => {
      const ids = prev.trade_strategy_ids.includes(strategyId)
        ? prev.trade_strategy_ids.filter((id) => id !== strategyId)
        : [...prev.trade_strategy_ids, strategyId];
      return { ...prev, trade_strategy_ids: ids };
    });
    setDirty(true);
  }, []);

  const toggleNavStrategy = useCallback((strategyId: string) => {
    setPrefs((prev) => {
      const ids = prev.nav_strategy_ids.includes(strategyId)
        ? prev.nav_strategy_ids.filter((id) => id !== strategyId)
        : [...prev.nav_strategy_ids, strategyId];
      return { ...prev, nav_strategy_ids: ids };
    });
    setDirty(true);
  }, []);

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    try {
      const res = await fetch("/api/notifications/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(prefs),
      });
      if (res.ok) setDirty(false);
    } finally {
      setIsSaving(false);
    }
  }, [prefs]);

  const handleTogglePush = async () => {
    if (pushState === "subscribed") {
      await unsubscribe();
    } else {
      await subscribe();
    }
  };

  const pushStateLabel: Record<PushState, string> = {
    loading: "Loading...",
    unsupported: "Not supported on this browser",
    denied: "Blocked by browser — enable in browser settings",
    prompt: "Not enabled",
    subscribed: "Enabled on this device",
    unsubscribed: "Not enabled",
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Push Subscription */}
      <Card>
        <CardHeader className="px-4 sm:px-6 py-3 sm:py-4">
          <div className="flex items-center gap-2.5">
            <Smartphone className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base sm:text-lg font-medium">
              Push Notifications
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="px-4 sm:px-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="space-y-1">
              <p className="text-sm font-medium">
                {pushState === "subscribed" ? "Notifications Active" : "Enable Push Notifications"}
              </p>
              <p className="text-xs text-muted-foreground">
                {pushStateLabel[pushState]}
              </p>
            </div>
            <Button
              variant={pushState === "subscribed" ? "outline" : "default"}
              size="sm"
              onClick={handleTogglePush}
              disabled={pushState === "unsupported" || pushState === "denied" || pushState === "loading"}
            >
              {pushState === "subscribed" ? (
                <>
                  <BellOff className="mr-1.5 h-3.5 w-3.5" />
                  Disable
                </>
              ) : (
                <>
                  <Bell className="mr-1.5 h-3.5 w-3.5" />
                  Enable
                </>
              )}
            </Button>
          </div>
          {pushState === "denied" && (
            <p className="text-xs text-destructive">
              Notifications are blocked. Please go to your browser settings to allow notifications for this site.
            </p>
          )}
          {pushState === "unsupported" && (
            <p className="text-xs text-muted-foreground">
              iOS: Add this page to your Home Screen first, then enable notifications.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Notification Types */}
      <Card>
        <CardHeader className="px-4 sm:px-6 py-3 sm:py-4">
          <div className="flex items-center gap-2.5">
            <Bell className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base sm:text-lg font-medium">
              Notification Types
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="px-4 sm:px-6 space-y-6">
          {/* Trade Notifications */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-sm font-medium">Trade Notifications</Label>
                <p className="text-xs text-muted-foreground">Get notified when a trade is executed</p>
              </div>
              <Switch
                checked={prefs.trade_notifications}
                onCheckedChange={(v) => updatePref("trade_notifications", v)}
              />
            </div>

            {prefs.trade_notifications && (
              <div className="space-y-2 pl-0 sm:pl-4">
                <label className="flex items-center gap-2 p-2 rounded-md border hover:bg-accent transition-colors cursor-pointer">
                  <Checkbox
                    checked={prefs.trade_every}
                    onCheckedChange={(v) => updatePref("trade_every", !!v)}
                  />
                  <div>
                    <span className="text-sm">Every Trade</span>
                    <p className="text-xs text-muted-foreground">Notify on each individual trade execution</p>
                  </div>
                </label>
                <label className="flex items-center gap-2 p-2 rounded-md border hover:bg-accent transition-colors cursor-pointer">
                  <Checkbox
                    checked={prefs.trade_combined}
                    onCheckedChange={(v) => updatePref("trade_combined", !!v)}
                  />
                  <div>
                    <span className="text-sm">Combined Trades</span>
                    <p className="text-xs text-muted-foreground">Notify on position close with PnL</p>
                  </div>
                </label>

                <div className="space-y-2 pt-2">
                  <Label className="text-sm text-muted-foreground">Watched Strategies (empty = all)</Label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {strategies.map((s) => (
                      <label
                        key={s.strategy_id}
                        className="flex items-center gap-2 p-2 rounded-md border hover:bg-accent transition-colors cursor-pointer"
                      >
                        <Checkbox
                          checked={prefs.trade_strategy_ids.includes(s.strategy_id)}
                          onCheckedChange={() => toggleTradeStrategy(s.strategy_id)}
                        />
                        <span className="text-sm truncate">{s.name}</span>
                      </label>
                    ))}
                  </div>
                  {strategies.length === 0 && (
                    <p className="text-xs text-muted-foreground">No strategies available</p>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="border-t" />

          {/* NAV Change Notifications */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-sm font-medium">NAV Change Alerts</Label>
                <p className="text-xs text-muted-foreground">Alert when strategy NAV changes dramatically</p>
              </div>
              <Switch
                checked={prefs.nav_change_notifications}
                onCheckedChange={(v) => updatePref("nav_change_notifications", v)}
              />
            </div>

            {prefs.nav_change_notifications && (
              <div className="space-y-3 pl-0 sm:pl-4">
                <div className="flex items-center gap-2">
                  <Label className="text-sm text-muted-foreground shrink-0">Threshold</Label>
                  <Input
                    type="number"
                    min={1}
                    max={100}
                    className="w-20 h-8 text-sm"
                    value={prefs.nav_change_threshold}
                    onChange={(e) => updatePref("nav_change_threshold", Number(e.target.value) || 5)}
                  />
                  <span className="text-sm text-muted-foreground">%</span>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm text-muted-foreground">Watched Strategies</Label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {strategies.map((s) => (
                      <label
                        key={s.strategy_id}
                        className="flex items-center gap-2 p-2 rounded-md border hover:bg-accent transition-colors cursor-pointer"
                      >
                        <Checkbox
                          checked={prefs.nav_strategy_ids.includes(s.strategy_id)}
                          onCheckedChange={() => toggleNavStrategy(s.strategy_id)}
                        />
                        <span className="text-sm truncate">{s.name}</span>
                      </label>
                    ))}
                  </div>
                  {strategies.length === 0 && (
                    <p className="text-xs text-muted-foreground">No strategies available</p>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="border-t" />

          {/* Report Notifications */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="text-sm font-medium">Report Notifications</Label>
              <p className="text-xs text-muted-foreground">Get notified when someone shares a report with you</p>
            </div>
            <Switch
              checked={prefs.report_notifications}
              onCheckedChange={(v) => updatePref("report_notifications", v)}
            />
          </div>

          {/* Save */}
          {dirty && (
            <div className="flex justify-end pt-2">
              <Button size="sm" onClick={handleSave} disabled={isSaving}>
                {isSaving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                Save Preferences
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Status */}
      {pushState === "subscribed" && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="outline" className="text-xs gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
            Connected
          </Badge>
          <span>Push notifications are active on this device</span>
        </div>
      )}
    </div>
  );
}
