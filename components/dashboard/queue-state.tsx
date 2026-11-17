import type { ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface QueueStateProps {
  /** Session still resolving or a fetch is in flight with nothing loaded yet. */
  loading: boolean;
  /** At least one successful load has happened (keep showing the list while refetching). */
  loaded: boolean;
  error: string | null;
  onRetry: () => void;
  children: ReactNode;
}

/** Loading -> error (+Retry) -> content, same pattern as the Billing/Appointments tabs (Task 430). */
export default function QueueState({ loading, loaded, error, onRetry, children }: QueueStateProps) {
  if (loading && !loaded) {
    return (
      <div role="status" aria-live="polite" className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 p-10 text-center text-sm text-muted-foreground">
        Loading queue...
      </div>
    );
  }
  if (error && !loaded) {
    return (
      <div role="status" aria-live="polite" className="flex flex-col items-center gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-6 text-center text-sm text-rose-800">
        <p>{error}</p>
        <Button variant="outline" size="sm" onClick={onRetry} className="gap-2">
          <RefreshCw className="h-4 w-4" />
          Retry
        </Button>
      </div>
    );
  }
  return <>{children}</>;
}
