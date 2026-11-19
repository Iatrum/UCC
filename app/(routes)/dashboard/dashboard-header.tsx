// Shared by the dashboard page and its loading fallback so the page title and
// description paint with the first streamed shell instead of waiting for the
// server-rendered queue (keeps LCP early without delaying the queue).
export function DashboardHeader() {
  return (
    <div className="space-y-2">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight text-slate-950">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Live clinic queue, upcoming appointments, and documents ready for billing.
        </p>
      </div>
    </div>
  );
}
