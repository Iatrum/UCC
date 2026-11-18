import { Skeleton } from "@/components/ui/skeleton";

/** Placeholder shown while the Analytics page loads its clinic data. */
export default function AnalyticsSkeleton() {
  return (
    <div className="space-y-6 pb-10" role="status" aria-busy="true" aria-label="Loading analytics">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight text-slate-950">Analytics</h1>
        <p className="text-sm text-muted-foreground">Memuatkan angka klinik…</p>
      </div>
      <Skeleton className="h-10 w-full max-w-md rounded-xl" />
      <AnalyticsBodySkeleton />
    </div>
  );
}

/** KPI + chart placeholders for one tab (heading, tabs and range filter are already on screen). */
export function AnalyticsBodySkeleton() {
  return (
    <div className="space-y-4 sm:space-y-6" role="status" aria-busy="true" aria-label="Loading analytics">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4" data-testid="analytics-skeleton-metrics">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[112px] rounded-xl" />
        ))}
      </div>
      <div className="grid gap-4 sm:gap-6 lg:grid-cols-5" data-testid="analytics-skeleton-charts">
        <Skeleton className="h-[280px] rounded-2xl lg:col-span-3" />
        <Skeleton className="h-[280px] rounded-2xl lg:col-span-2" />
        <Skeleton className="h-[280px] rounded-2xl lg:col-span-3" />
        <Skeleton className="h-[280px] rounded-2xl lg:col-span-2" />
      </div>
    </div>
  );
}
