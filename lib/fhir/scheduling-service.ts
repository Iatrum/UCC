import type { MedplumClient } from "@medplum/core";
import type { Appointment, Patient, Practitioner, Schedule, Slot } from "@medplum/fhirtypes";

const CLINIC_SCHEDULE_IDENTIFIER_SYSTEM = "urn:iatrum:schedule:clinic-practitioner";

export interface ScheduleSummary {
  id: string;
  practitionerId: string;
  practitionerName: string;
}

export interface SlotSummary {
  id: string;
  scheduleId: string;
  practitionerId: string;
  practitionerName: string;
  status: Slot["status"];
  start: string;
  end: string;
}

export interface EnsureScheduleInput {
  clinicId: string;
  practitionerId: string;
  practitionerName?: string;
}

export interface GenerateSlotsInput {
  scheduleId: string;
  start: string;
  end: string;
  durationMinutes: number;
}

export interface FindSlotsInput {
  scheduleId?: string;
  practitionerId?: string;
  start: string;
  end: string;
  status?: Slot["status"];
  count?: number;
}

export interface BookSlotInput {
  slotId: string;
  patientId: string;
  reason: string;
  clinicianDisplayOverride?: string;
  durationMinutes?: number;
}

function getIdFromReference(reference?: string): string {
  if (!reference) return "";
  const parts = reference.split("/");
  return parts.length >= 2 ? parts[parts.length - 1] : "";
}

function buildScheduleIdentifier(clinicId: string, practitionerId: string): string {
  return `${clinicId}:${practitionerId}`;
}

function parseScheduleIdentifier(schedule: Schedule): { clinicId?: string; practitionerId?: string } {
  const value = schedule.identifier?.find((id) => id.system === CLINIC_SCHEDULE_IDENTIFIER_SYSTEM)?.value;
  if (!value) return {};
  const [clinicId, practitionerId] = value.split(":");
  return { clinicId, practitionerId };
}

function mapSchedule(schedule: Schedule): ScheduleSummary {
  const actor = schedule.actor?.[0];
  const practitionerId = getIdFromReference(actor?.reference);
  return {
    id: schedule.id || "",
    practitionerId,
    practitionerName: actor?.display || practitionerId,
  };
}

function mapSlot(slot: Slot, scheduleById: Map<string, Schedule>): SlotSummary {
  const scheduleId = getIdFromReference(slot.schedule?.reference);
  const schedule = scheduleById.get(scheduleId);
  const practitionerId = getIdFromReference(schedule?.actor?.[0]?.reference);
  return {
    id: slot.id || "",
    scheduleId,
    practitionerId,
    practitionerName: schedule?.actor?.[0]?.display || practitionerId,
    status: slot.status,
    start: slot.start || "",
    end: slot.end || "",
  };
}

export async function listClinicSchedules(
  medplum: MedplumClient,
  clinicId: string
): Promise<ScheduleSummary[]> {
  const schedules = await medplum.searchResources("Schedule", { _count: "200" });
  return (schedules || [])
    .filter((schedule) => parseScheduleIdentifier(schedule).clinicId === clinicId)
    .map(mapSchedule);
}

export async function ensureClinicianSchedule(
  medplum: MedplumClient,
  input: EnsureScheduleInput
): Promise<ScheduleSummary> {
  const identifier = buildScheduleIdentifier(input.clinicId, input.practitionerId);
  const existing = await medplum.searchOne("Schedule", {
    identifier: `${CLINIC_SCHEDULE_IDENTIFIER_SYSTEM}|${identifier}`,
  });

  if (existing?.id) {
    return mapSchedule(existing);
  }

  let practitionerName = input.practitionerName || input.practitionerId;
  try {
    const practitioner = await medplum.readResource("Practitioner", input.practitionerId);
    practitionerName = getPractitionerDisplayName(practitioner);
  } catch {
    // Best effort only; fallback to provided display.
  }

  const created = await medplum.createResource<Schedule>({
    resourceType: "Schedule",
    active: true,
    identifier: [{ system: CLINIC_SCHEDULE_IDENTIFIER_SYSTEM, value: identifier }],
    actor: [{ reference: `Practitioner/${input.practitionerId}`, display: practitionerName }],
    comment: "Slots pilot schedule",
  });

  return mapSchedule(created);
}

export async function generateSlotsForSchedule(
  medplum: MedplumClient,
  clinicId: string,
  input: GenerateSlotsInput
): Promise<{ created: number; existing: number }> {
  const schedule = await medplum.readResource("Schedule", input.scheduleId);
  const { clinicId: scheduleClinicId } = parseScheduleIdentifier(schedule);
  if (scheduleClinicId !== clinicId) {
    throw new Error("Schedule does not belong to this clinic");
  }

  const windowStart = new Date(input.start);
  const windowEnd = new Date(input.end);
  if (isNaN(windowStart.getTime()) || isNaN(windowEnd.getTime()) || windowStart >= windowEnd) {
    throw new Error("Invalid slot generation window");
  }
  if (!Number.isFinite(input.durationMinutes) || input.durationMinutes <= 0) {
    throw new Error("durationMinutes must be a positive number");
  }

  const existingSlots = await medplum.searchResources("Slot", {
    schedule: `Schedule/${input.scheduleId}`,
    _count: "500",
  });

  const existingStarts = new Set(
    (existingSlots || [])
      .map((slot) => slot.start)
      .filter((value): value is string => Boolean(value))
  );

  let created = 0;
  let existing = 0;
  let cursor = new Date(windowStart);

  while (cursor < windowEnd) {
    const slotStart = new Date(cursor);
    const slotEnd = new Date(slotStart);
    slotEnd.setMinutes(slotEnd.getMinutes() + input.durationMinutes);
    if (slotEnd > windowEnd) break;

    const startIso = slotStart.toISOString();
    if (existingStarts.has(startIso)) {
      existing += 1;
    } else {
      await medplum.createResource<Slot>({
        resourceType: "Slot",
        schedule: { reference: `Schedule/${input.scheduleId}` },
        status: "free",
        start: startIso,
        end: slotEnd.toISOString(),
      });
      created += 1;
    }

    cursor = slotEnd;
  }

  return { created, existing };
}

export async function findSlots(
  medplum: MedplumClient,
  clinicId: string,
  input: FindSlotsInput
): Promise<SlotSummary[]> {
  const schedules = await listClinicSchedules(medplum, clinicId);
  const selectedSchedules = schedules.filter((schedule) => {
    if (input.scheduleId && schedule.id !== input.scheduleId) return false;
    if (input.practitionerId && schedule.practitionerId !== input.practitionerId) return false;
    return true;
  });

  if (selectedSchedules.length === 0) {
    return [];
  }

  const scheduleById = new Map<string, Schedule>();
  selectedSchedules.forEach((s) => {
    scheduleById.set(s.id, {
      resourceType: "Schedule",
      id: s.id,
      actor: [{ reference: `Practitioner/${s.practitionerId}`, display: s.practitionerName }],
    });
  });

  const startAt = new Date(input.start).getTime();
  const endAt = new Date(input.end).getTime();
  if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || startAt >= endAt) {
    throw new Error("Invalid slot search window");
  }

  const allSlots = (
    await Promise.all(
      selectedSchedules.map((schedule) =>
        medplum.searchResources("Slot", {
          schedule: `Schedule/${schedule.id}`,
          status: input.status,
          _count: String(input.count ?? 200),
        })
      )
    )
  ).flat();

  const dedup = new Map<string, Slot>();
  for (const slot of allSlots) {
    if (slot.id) dedup.set(slot.id, slot);
  }

  return Array.from(dedup.values())
    .filter((slot) => {
      const start = slot.start ? new Date(slot.start).getTime() : NaN;
      const end = slot.end ? new Date(slot.end).getTime() : NaN;
      if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
      return start >= startAt && end <= endAt;
    })
    .sort((a, b) => (a.start || "").localeCompare(b.start || ""))
    .map((slot) => mapSlot(slot, scheduleById));
}

function getPractitionerDisplayName(practitioner: Practitioner): string {
  const name = practitioner.name?.[0];
  if (!name) return practitioner.id || "Practitioner";
  if (name.text) return name.text;
  const parts = [...(name.given || []), name.family].filter(Boolean);
  return parts.join(" ") || practitioner.id || "Practitioner";
}

function getPatientDisplayName(patient: Patient): string {
  const name = patient.name?.[0];
  if (!name) return patient.id || "Patient";
  if (name.text) return name.text;
  const parts = [...(name.given || []), name.family].filter(Boolean);
  return parts.join(" ") || patient.id || "Patient";
}

export async function bookSlotToAppointment(
  medplum: MedplumClient,
  clinicId: string,
  input: BookSlotInput
): Promise<{ appointmentId: string; slotId: string }> {
  const slot = await medplum.readResource("Slot", input.slotId);
  if (slot.status !== "free") {
    throw new Error("Slot is no longer available");
  }

  const scheduleId = getIdFromReference(slot.schedule?.reference);
  if (!scheduleId) {
    throw new Error("Slot is missing schedule");
  }

  const schedule = await medplum.readResource("Schedule", scheduleId);
  const { clinicId: scheduleClinicId, practitionerId } = parseScheduleIdentifier(schedule);
  if (scheduleClinicId !== clinicId) {
    throw new Error("Slot does not belong to this clinic");
  }

  const patient = await medplum.readResource("Patient", input.patientId);
  const patientName = getPatientDisplayName(patient);
  const clinicianName =
    input.clinicianDisplayOverride ||
    schedule.actor?.[0]?.display ||
    practitionerId ||
    "Clinician";

  const slotStart = slot.start || "";
  const slotEnd = slot.end || "";
  const durationMinutes =
    input.durationMinutes && input.durationMinutes > 0
      ? input.durationMinutes
      : Math.max(1, Math.round((new Date(slotEnd).getTime() - new Date(slotStart).getTime()) / 60000));

  const appointment = await medplum.createResource<Appointment>({
    resourceType: "Appointment",
    status: "booked",
    start: slotStart,
    end: slotEnd,
    minutesDuration: durationMinutes,
    slot: [{ reference: `Slot/${slot.id}` }],
    participant: [
      {
        actor: {
          reference: `Patient/${input.patientId}`,
          display: patientName,
        },
        status: "accepted",
      },
      {
        actor: practitionerId
          ? {
              reference: `Practitioner/${practitionerId}`,
              display: clinicianName,
            }
          : {
              display: clinicianName,
            },
        status: "accepted",
      },
    ],
    reasonCode: input.reason ? [{ text: input.reason }] : undefined,
    comment: "Booked via slots pilot",
  });

  await medplum.updateResource<Slot>({
    ...slot,
    status: "busy",
  });

  return { appointmentId: appointment.id || "", slotId: slot.id || "" };
}

