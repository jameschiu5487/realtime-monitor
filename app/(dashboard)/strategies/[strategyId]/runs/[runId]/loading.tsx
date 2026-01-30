import { Card, CardContent, CardHeader } from "@/components/ui/card";

export default function RunDetailsLoading() {
  return (
    <div className="space-y-8">
      <div className="flex items-start gap-6 pb-6 border-b">
        <div className="h-10 w-10 bg-muted animate-pulse rounded" />
        <div className="flex-1">
          <div className="h-9 w-48 bg-muted animate-pulse rounded" />
          <div className="h-5 w-64 bg-muted animate-pulse rounded mt-2" />
          <div className="flex gap-6 mt-4">
            <div className="h-5 w-32 bg-muted animate-pulse rounded" />
            <div className="h-5 w-40 bg-muted animate-pulse rounded" />
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <div className="h-8 w-48 bg-muted animate-pulse rounded" />
        <div className="grid gap-6 md:grid-cols-2">
          {[1, 2].map((i) => (
            <Card key={i}>
              <CardHeader>
                <div className="h-6 w-32 bg-muted animate-pulse rounded" />
              </CardHeader>
              <CardContent>
                <div className="h-[250px] w-full bg-muted animate-pulse rounded" />
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="grid gap-6 grid-cols-1">
          {[1, 2].map((i) => (
            <Card key={i}>
              <CardHeader>
                <div className="h-6 w-40 bg-muted animate-pulse rounded" />
              </CardHeader>
              <CardContent>
                <div className="h-[250px] w-full bg-muted animate-pulse rounded" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="h-6 w-24 bg-muted animate-pulse rounded" />
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-10 w-full bg-muted animate-pulse rounded" />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
