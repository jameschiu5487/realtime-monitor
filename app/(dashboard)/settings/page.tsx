import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Settings, Repeat, Bell, Key } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { NotificationSettings } from "@/components/settings/notification-settings";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const supabase = await createClient();

  const [{ data: strategiesData }, accessResult] = await Promise.all([
    supabase.from("strategies").select("strategy_id, name"),
    supabase.from("user_strategy_access").select("strategy_id") as unknown as Promise<{
      data: { strategy_id: string }[] | null;
    }>,
  ]);

  const accessibleIds = new Set((accessResult.data ?? []).map((r) => r.strategy_id));
  const allStrategies = (strategiesData ?? []) as { strategy_id: string; name: string }[];
  const strategies = allStrategies
    .filter((s) => accessibleIds.has(s.strategy_id))
    .map((s) => ({ strategy_id: s.strategy_id, name: s.name }));

  return (
    <div className="space-y-4 sm:space-y-6">
      <div>
        <h2 className="text-xl sm:text-2xl font-bold tracking-tight">
          Settings
        </h2>
        <p className="text-sm text-muted-foreground">
          Manage your system preferences and account settings
        </p>
      </div>

      <Tabs defaultValue="general" className="space-y-3 sm:space-y-4">
        <TabsList className="w-full sm:w-auto overflow-x-auto">
          <TabsTrigger value="general" className="text-sm">
            General
          </TabsTrigger>
          <TabsTrigger value="trading" className="text-sm">
            Trading
          </TabsTrigger>
          <TabsTrigger value="notifications" className="text-sm">
            Notifications
          </TabsTrigger>
          <TabsTrigger value="api" className="text-sm">
            API Keys
          </TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="space-y-3 sm:space-y-4">
          <Card>
            <CardHeader className="px-4 sm:px-6 py-3 sm:py-4">
              <div className="flex items-center gap-2.5">
                <Settings className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-base sm:text-lg font-medium">
                  General Settings
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="px-4 sm:px-6">
              <div className="flex flex-col h-[140px] sm:h-[180px] items-center justify-center gap-3 text-muted-foreground">
                <Settings className="h-8 w-8 opacity-40" />
                <p className="text-sm">General settings area</p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="trading">
          <Card>
            <CardHeader className="px-4 sm:px-6 py-3 sm:py-4">
              <div className="flex items-center gap-2.5">
                <Repeat className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-base sm:text-lg font-medium">
                  Trading Settings
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="px-4 sm:px-6">
              <div className="flex flex-col h-[140px] sm:h-[180px] items-center justify-center gap-3 text-muted-foreground">
                <Repeat className="h-8 w-8 opacity-40" />
                <p className="text-sm">Trading settings area</p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="notifications">
          <NotificationSettings strategies={strategies} />
        </TabsContent>

        <TabsContent value="api">
          <Card>
            <CardHeader className="px-4 sm:px-6 py-3 sm:py-4">
              <div className="flex items-center gap-2.5">
                <Key className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-base sm:text-lg font-medium">
                  API Key Settings
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="px-4 sm:px-6">
              <div className="flex flex-col h-[140px] sm:h-[180px] items-center justify-center gap-3 text-muted-foreground">
                <Key className="h-8 w-8 opacity-40" />
                <p className="text-sm">API key configuration area</p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
