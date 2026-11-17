import { Skeleton } from "@/components/ui/skeleton";

/**
 * Generic list-page placeholder used by route-level loading.tsx files (Task 547).
 * Streams immediately inside the sidebar chrome while the page's own data loads; also lets
 * Next prefetch a loading boundary for the existing sidebar links. Server component, no JS.
 */
export default function PageLoading({ label = "Loading" }: { label?: string }) {
  return (
    <div className="space-y-6" role="status" aria-busy="true" aria-label={label}>
      <div className="space-y-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-72" />
      </div>
      <div className="rounded-lg border">
        <div className="space-y-3 p-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}
