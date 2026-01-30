"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle, ArrowLeft } from "lucide-react";

export default function StrategyDetailError({
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
      <div className="flex items-center gap-4">
        <Link href="/strategies">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>
        <h2 className="text-3xl font-bold tracking-tight">Strategy Details</h2>
      </div>

      <Card>
        <CardContent className="py-8">
          <div className="flex flex-col items-center gap-4 text-center">
            <AlertCircle className="h-10 w-10 text-destructive" />
            <div>
              <h3 className="font-semibold">Failed to load strategy</h3>
              <p className="text-sm text-muted-foreground">
                An error occurred while loading this strategy.
              </p>
            </div>
            <div className="flex gap-2">
              <Button onClick={reset}>Try again</Button>
              <Link href="/strategies">
                <Button variant="outline">Back to strategies</Button>
              </Link>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
