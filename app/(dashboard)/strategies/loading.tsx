import { Card, CardContent, CardHeader } from "@/components/ui/card";

export default function StrategiesLoading() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="h-9 w-48 bg-muted animate-pulse rounded" />
          <div className="h-5 w-64 bg-muted animate-pulse rounded mt-2" />
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i}>
            <CardHeader>
              <div className="h-6 w-48 bg-muted animate-pulse rounded" />
              <div className="h-4 w-64 bg-muted animate-pulse rounded mt-2" />
            </CardHeader>
            <CardContent>
              <div className="h-10 w-full bg-muted animate-pulse rounded" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
