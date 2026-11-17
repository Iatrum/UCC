export const dynamic = 'force-dynamic';

import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Activity, Users, Calendar, TrendingUp } from "lucide-react";
import { getAllPatientsFromMedplum, countPatientsInMedplum } from "@/lib/fhir/patient-service";
import { getPatientConsultationsFromMedplum, getClinicConsultationsFromMedplum } from "@/lib/fhir/consultation-service";
import { computeAnalytics } from "@/lib/analytics/compute";
import { getMedplumForRequest } from "@/lib/server/medplum-auth";
import { resolveClinicIdFromServerScope } from "@/lib/server/clinic";
import AnalyticsCharts from "@/components/analytics/analytics-charts";

export default async function AnalyticsPage() {
  const medplum = await getMedplumForRequest();
  const clinicId = await resolveClinicIdFromServerScope();
  // Task 502: patients + exact count + all clinic consultations in parallel (was one 5-query N+1 per patient).
  const [patients, exactTotal, clinicConsultations] = await Promise.all([
    getAllPatientsFromMedplum(300, clinicId, medplum),
    countPatientsInMedplum(clinicId, medplum).catch(() => null),
    clinicId ? getClinicConsultationsFromMedplum(clinicId, medplum) : Promise.resolve(null),
  ]);
  const patientIds = new Set(patients.map((p) => p.id));
  const consultations = clinicConsultations
    ? clinicConsultations.filter((c) => patientIds.has(c.patientId))
    : (await Promise.all(patients.map((p) => getPatientConsultationsFromMedplum(p.id, clinicId, medplum)))).flat();

  const {
    totalPatients, consultationsThisMonth, avgWait, waitSamples, revenueThisMonth, revenueAllTime,
    genderData, ageData, weeklyVisits, diagnosisTop, revenueMonthly,
  } = computeAnalytics(patients, consultations, exactTotal);

  return (
    <div className="space-y-6 pb-10">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight text-slate-950">Analytics</h1>
        <p className="text-sm text-muted-foreground">
          Clinic performance, patient mix, visit trends, and revenue movement.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <AnalyticsMetricCard
          icon={<Users className="h-4 w-4 text-sky-700" />}
          label="Total patients"
          value={totalPatients.toString()}
          hint="Active patient records"
        />
        <AnalyticsMetricCard
          icon={<Activity className="h-4 w-4 text-emerald-700" />}
          label="Consultations"
          value={consultationsThisMonth.toString()}
          hint="This month"
        />
        <AnalyticsMetricCard
          icon={<Calendar className="h-4 w-4 text-amber-700" />}
          label="Average wait"
          value={`${avgWait} min`}
          hint={`${waitSamples} completed queue samples`}
        />
        <AnalyticsMetricCard
          icon={<TrendingUp className="h-4 w-4 text-violet-700" />}
          label="Revenue"
          value={`RM ${revenueThisMonth.toFixed(2)}`}
          hint={`All-time RM ${revenueAllTime.toFixed(2)}`}
        />
      </div>

      <AnalyticsCharts
        genderData={genderData}
        ageData={ageData}
        weeklyVisits={weeklyVisits}
        diagnosisTop={diagnosisTop}
        revenueMonthly={revenueMonthly}
      />
    </div>
  );
}

function AnalyticsMetricCard({
  icon,
  label,
  value,
  hint,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <Card className="border-slate-200/80 shadow-sm">
      <CardContent className="flex items-center justify-between p-4">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
          <div className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">{value}</div>
          <p className="mt-1 truncate text-xs text-muted-foreground">{hint}</p>
        </div>
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-slate-100">
          {icon}
        </div>
      </CardContent>
    </Card>
  );
}
