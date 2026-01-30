"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle } from "lucide-react";

export default function StrategiesError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Strategies</h2>
        <p className="text-muted-foreground">
          Manage and monitor your trading strategies
        </p>
      </div>

      <Card>
        <CardContent className="py-8">
          <div className="flex flex-col items-center gap-4 text-center">
            <AlertCircle className="h-10 w-10 text-destructive" />
            <div>
              <h3 className="font-semibold">Failed to load strategies</h3>
              <p className="text-sm text-muted-foreground">
                An error occurred while loading your strategies.
              </p>
            </div>
            <Button onClick={reset}>Try again</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
