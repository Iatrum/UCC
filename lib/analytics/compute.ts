import type { SavedConsultation } from "@/lib/fhir/consultation-service";

type PatientLike = {
  id: string;
  gender: string;
  dateOfBirth?: unknown;
  queueAddedAt?: unknown;
};

/** Pure aggregation for the Analytics page (moved verbatim from the page in Task 502). */
export function computeAnalytics(
  patients: PatientLike[],
  consultations: Pick<SavedConsultation, "patientId" | "date" | "diagnosis" | "prescriptions" | "procedures" | "billingItems">[],
  exactTotal: number | null,
  now: Date = new Date()
) {
  const getCurrentTimestamp = () => now.getTime();
  // Overview stats
  const totalPatients = exactTotal ?? patients.length;
  const thisMonth = new Date(now);
  thisMonth.setDate(1);
  const consultationsThisMonth = consultations.filter(c => c.date && new Date(c.date) >= thisMonth).length;

  // Revenue: order prices are UNIT prices (ORDER_PRICE_EXTENSION_URL "unit-price"), so a line is price x quantity
  // (default 1), the same way checkout totals it. Lab/imaging lines live in billingItems (Task 558).
  const lineTotal = (it?: { price?: number; quantity?: number }) => (it?.price ?? 0) * (it?.quantity ?? 1);
  const sumItems = (arr?: Array<{ price?: number; quantity?: number }>) => (arr || []).reduce((s, it) => s + lineTotal(it), 0);
  const consultationRevenue = (c: { prescriptions?: any[]; procedures?: any[]; billingItems?: any[] }) =>
    sumItems(c.prescriptions) + sumItems(c.procedures) + sumItems(c.billingItems);
  const revenueAllTime = consultations.reduce((s, c) => s + consultationRevenue(c), 0);
  const revenueThisMonth = consultations
    .filter(c => c.date && new Date(c.date) >= thisMonth)
    .reduce((s, c) => s + consultationRevenue(c), 0);

  // Compute wait time from queueAddedAt -> first consultation date per patient (if available)
  const waitTimes: number[] = patients
    .map(p => {
      const added = p.queueAddedAt ? new Date(p.queueAddedAt as any).getTime() : null;
      const firstC = consultations.find(c => c.patientId === p.id)?.date as any;
      const firstTime = firstC ? new Date(firstC).getTime() : null;
      return added && firstTime && firstTime > added ? Math.round((firstTime - added) / (60 * 1000)) : null;
    })
    .filter((v): v is number => typeof v === 'number');
  const avgWait = waitTimes.length ? Math.round(waitTimes.reduce((a, b) => a + b, 0) / waitTimes.length) : 0;

  // Gender pie
  const genderCounts: Record<string, number> = {};
  for (const p of patients) {
    genderCounts[p.gender] = (genderCounts[p.gender] ?? 0) + 1;
  }
  const genderData = Object.entries(genderCounts).map(([name, value]) => ({ name, value }));

  // Age buckets
  const buckets: Record<string, number> = { '0-17': 0, '18-39': 0, '40-64': 0, '65+': 0 };
  const nowMs = getCurrentTimestamp();
  for (const p of patients) {
    if (!p.dateOfBirth) continue;
    const dob = new Date(p.dateOfBirth as any);
    if (isNaN(dob.getTime())) continue;
    const age = Math.floor((nowMs - dob.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
    if (age < 18) buckets['0-17']++; else if (age < 40) buckets['18-39']++; else if (age < 65) buckets['40-64']++; else buckets['65+']++;
  }
  const ageData = Object.entries(buckets).map(([name, value]) => ({ name, value }));

  // Weekly visits (last 7 days)
  const days = Array.from({ length: 7 }).map((_, i) => {
    const d = new Date(now);
    d.setDate(d.getDate() - (6 - i));
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const weeklyVisits = days.map(d => ({
    name: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    value: consultations.filter(c => c.date && new Date(c.date).toDateString() === d.toDateString()).length,
  }));

  // Top diagnoses
  const diagnosisCounts: Record<string, number> = {};
  for (const c of consultations) {
    if (!c.diagnosis) continue;
    diagnosisCounts[c.diagnosis] = (diagnosisCounts[c.diagnosis] ?? 0) + 1;
  }
  const diagnosisTop = Object.entries(diagnosisCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([name, value]) => ({ name, value }));

  // Revenue by month (last 12 months)
    const months: { name: string; year: number; month: number }[] = Array.from({ length: 12 }).map((_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (11 - i), 1);
    return { name: d.toLocaleDateString('en-US', { month: 'short' }), year: d.getFullYear(), month: d.getMonth() };
  });
  const revenueMonthly = months.map(({ name, year, month }) => {
    const monthlyRevenue = consultations
      .filter(c => c.date && new Date(c.date).getFullYear() === year && new Date(c.date).getMonth() === month)
      .reduce((s, c) => s + consultationRevenue(c), 0);
    return { name: `${name} ${String(year).slice(2)}`, value: Number(monthlyRevenue.toFixed(2)) };
  });


  return {
    totalPatients,
    consultationsThisMonth,
    avgWait,
    waitSamples: waitTimes.length,
    revenueThisMonth,
    revenueAllTime,
    genderData,
    ageData,
    weeklyVisits,
    diagnosisTop,
    revenueMonthly,
  };
}
