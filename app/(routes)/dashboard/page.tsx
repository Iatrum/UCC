import { setTimeout } from "node:timers/promises";
import type { MedplumClient } from "@medplum/core";
import DashboardClient from "./dashboard-client";
import { getTriageQueueForToday } from "@/lib/fhir/triage-service";
import { isLocalAuthDisabled, requireClinicPageAuth } from "@/lib/server/medplum-auth";
import { QUEUE_TIMEOUT_MS, type QueuePatient } from "@/lib/dashboard/queue-load";

async function getInitialQueue(
  medplum: MedplumClient,
  clinicId: string,
): Promise<QueuePatient[] | null> {
  const deadline = new AbortController();
  try {
    const patients = await Promise.race([
      getTriageQueueForToday(200, medplum, clinicId),
      setTimeout(QUEUE_TIMEOUT_MS, null, { signal: deadline.signal }),
    ]);
    return patients?.map(({ id, fullName, nric, visitIntent, payerType, assignedClinician, queueAddedAt, queueStatus, queueNumber, triage }) => ({
      id, fullName, nric, visitIntent, payerType, assignedClinician, queueAddedAt, queueStatus, queueNumber,
      triage: triage ? { chiefComplaint: triage.chiefComplaint, isTriaged: triage.isTriaged } : undefined,
    })) ?? null;
  } catch {
    // The browser's existing queue loader handles retry and reports errors.
    return null;
  } finally {
    deadline.abort();
  }
}

export default async function DashboardPage() {
  if (isLocalAuthDisabled()) return <DashboardClient initialQueue={null} />;

  const { medplum, clinicId } = await requireClinicPageAuth("/dashboard");
  const initialQueue = await getInitialQueue(medplum, clinicId);
  return <DashboardClient key={clinicId} initialQueue={initialQueue} />;
}
