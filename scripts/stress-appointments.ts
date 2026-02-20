import { getAllPatientsFromMedplum } from "@/lib/fhir/patient-service";
import {
  getAppointmentFromMedplum,
  getAppointmentsFromMedplum,
  saveAppointmentToMedplum,
  updateAppointmentStatus,
} from "@/lib/fhir/appointment-service";
import type { AppointmentStatus } from "@/lib/models";

const RUN_ID = process.env.STRESS_RUN_ID ?? new Date().toISOString().replace(/[:.]/g, "-");
const COUNT = Number(process.env.STRESS_APPOINTMENT_COUNT ?? 5);
const STATUSES: AppointmentStatus[] = ["scheduled", "checked_in", "completed", "cancelled", "no_show", "in_progress"];

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log(`🔧 Stress test run ${RUN_ID}`);
  console.log(`Creating ${COUNT} appointments`);

  const patients = await getAllPatientsFromMedplum(Math.max(COUNT, 5));
  assert(patients.length > 0, "No patients found in Medplum. Seed patients first.");

  const now = new Date();
  const clinicians = ["Dr. Wong", "Dr. Patel", "Dr. Rahman"];

  const createdIds = await Promise.all(
    Array.from({ length: COUNT }, async (_, index) => {
      const patient = patients[index % patients.length];
      const scheduledAt = new Date(now.getTime() + index * 15 * 60 * 1000);
      const id = await saveAppointmentToMedplum({
        patientId: patient.id,
        patientName: patient.fullName,
        patientContact: patient.phone || undefined,
        clinician: clinicians[index % clinicians.length],
        reason: `Stress test ${RUN_ID} #${index + 1}`,
        type: "Stress",
        location: "Clinic A",
        notes: "Automated stress test appointment",
        status: "scheduled",
        scheduledAt,
        durationMinutes: 30,
      });
      return id;
    })
  );

  assert(createdIds.length === COUNT, "Failed to create all appointments.");
  console.log(`✅ Created ${createdIds.length} appointments`);

  const listed = await getAppointmentsFromMedplum(STATUSES);
  const matched = listed.filter((appt) => appt.reason?.includes(`Stress test ${RUN_ID}`));
  console.log(`🔎 Found ${matched.length}/${COUNT} created appointments in list`);

  for (const id of createdIds) {
    const checkInTime = new Date();
    await updateAppointmentStatus(id, "checked_in", { checkInTime });
    await sleep(50);
    const completedAt = new Date();
    await updateAppointmentStatus(id, "completed", { completedAt });

    const fetched = await getAppointmentFromMedplum(id);
    assert(fetched, `Appointment ${id} not found after update`);
    assert(fetched.status === "completed", `Appointment ${id} status mismatch: ${fetched.status}`);
    assert(!!fetched.checkInTime, `Appointment ${id} missing checkInTime`);
    assert(!!fetched.completedAt, `Appointment ${id} missing completedAt`);
  }

  console.log("✅ Status updates verified");
  console.log("🏁 Stress test completed successfully");
}

main().catch((error) => {
  console.error("❌ Stress test failed:", error);
  process.exit(1);
});
