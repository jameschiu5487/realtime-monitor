import { Card, CardContent, CardHeader } from "@/components/ui/card";

export default function StrategyDetailLoading() {
  return (
    <div className="space-y-8">
      <div className="flex items-start gap-6 pb-6 border-b">
        <div className="h-10 w-10 bg-muted animate-pulse rounded" />
        <div className="flex-1">
          <div className="h-10 w-64 bg-muted animate-pulse rounded" />
          <div className="h-5 w-96 bg-muted animate-pulse rounded mt-2" />
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="h-6 w-32 bg-muted animate-pulse rounded" />
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-12 w-full bg-muted animate-pulse rounded" />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
