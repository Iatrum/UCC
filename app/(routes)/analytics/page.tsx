import AnalyticsDashboard, { type InitialPayload } from "@/components/analytics/analytics-dashboard";
import { getTabData, type SummaryData } from "@/lib/analytics/queries";
import { getMedplumForRequest } from "@/lib/server/medplum-auth";
import { resolveClinicIdFromServerScope } from "@/lib/server/clinic";

// No `force-dynamic` full-table loads: the page reads cookies (so it is per-request), but the shell renders at once and
// the default tab streams in from bounded, briefly-cached queries (see lib/analytics/queries.ts). Other tabs load lazily.
async function loadInitial(): Promise<InitialPayload> {
  try {
    const [medplum, clinicId] = await Promise.all([getMedplumForRequest(), resolveClinicIdFromServerScope()]);
    if (!clinicId) return { range: "7d", data: null, error: "Tiada konteks klinik. Log masuk dari subdomain klinik." };
    return { range: "7d", data: (await getTabData("summary", medplum, clinicId, "7d")) as SummaryData };
  } catch (error) {
    console.error("[analytics] initial summary failed", error instanceof Error ? error.message : error);
    return { range: "7d", data: null, error: "Gagal memuatkan data analitik." };
  }
}

export default function AnalyticsPage() {
  const initial = loadInitial(); // not awaited: lets the heading/tabs paint immediately, data streams via Suspense
  return (
    <div className="space-y-6 pb-10">
      <div className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight text-slate-950">Analytics</h1>
        <p className="text-sm text-muted-foreground">Prestasi klinik, corak klinikal, hasil dan operasi.</p>
      </div>
      <AnalyticsDashboard initial={initial} />
    </div>
  );
}
