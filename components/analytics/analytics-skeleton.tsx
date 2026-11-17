import { Skeleton } from "@/components/ui/skeleton";

/** Placeholder shown while the Analytics page loads its clinic data. */
export default function AnalyticsSkeleton() {
  return (
    <div className="space-y-6 pb-10" role="status" aria-busy="true" aria-label="Loading analytics">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight text-slate-950">Analytics</h1>
        <p className="text-sm text-muted-foreground">Loading clinic figures…</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4" data-testid="analytics-skeleton-metrics">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[104px] rounded-xl" />
        ))}
      </div>
      <div className="grid gap-6 md:grid-cols-2" data-testid="analytics-skeleton-charts">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[280px] rounded-2xl" />
        ))}
        <Skeleton className="h-[300px] rounded-2xl md:col-span-2" />
      </div>
    </div>
  );
}

/** Cards + charts placeholder only (the heading is already on screen), for the page-level Suspense. */
export function AnalyticsBodySkeleton() {
  return (
    <div className="space-y-6" role="status" aria-busy="true" aria-label="Loading analytics">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4" data-testid="analytics-skeleton-metrics">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[104px] rounded-xl" />
        ))}
      </div>
      <div className="grid gap-6 md:grid-cols-2" data-testid="analytics-skeleton-charts">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[280px] rounded-2xl" />
        ))}
        <Skeleton className="h-[300px] rounded-2xl md:col-span-2" />
      </div>
    </div>
  );
}
