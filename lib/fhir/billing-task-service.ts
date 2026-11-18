import { assertPatientInClinic, assertResourceInClinic } from './write-containment';
import type { MedplumClient } from "@medplum/core";
import type { Annotation, Task } from "@medplum/fhirtypes";
import { searchAllPages } from "@/lib/server/search-all";
import { CLINIC_IDENTIFIER_SYSTEM, withClinicIdentifier, resolveClinicTenant } from "@/lib/fhir/clinic-tenancy";

const BILLING_EXCEPTION_CODE_SYSTEM = "https://ucc.emr/task-type";
const BILLING_EXCEPTION_CODE = "billing-exception";
const BILLING_EXCEPTION_IDENTIFIER_SYSTEM = "https://ucc.emr/task/billing-exception";
const CONSULTATION_ID_EXTENSION_URL = "https://ucc.emr/task/consultation-id";
const CLINIC_ID_EXTENSION_URL = "https://ucc.emr/task/clinic-id";
const PAYMENT_METHOD_EXTENSION_URL = "https://ucc.emr/task/payment-method";
const ERROR_CLASS_EXTENSION_URL = "https://ucc.emr/task/error-class";

export type BillingTaskStatus = "requested" | "in-progress" | "completed" | "cancelled";
export type BillingTaskListStatus = "open" | "all";

export type CreateBillingExceptionTaskInput = {
  consultationId: string;
  patientId: string;
  clinicId: string;
  paymentMethod?: string;
  errorClass: string;
  errorSummary: string;
  invoiceId?: string;
  requesterReference?: string;
};

export function getBillingExceptionIdentifierValue(consultationId: string): string {
  return consultationId.trim();
}

export function getBillingTaskClinicId(task: Task): string {
  const ext = task.extension?.find((item) => item.url === CLINIC_ID_EXTENSION_URL);
  return ext?.valueString || "";
}

function buildBillingExceptionIdentifier(consultationId: string) {
  return {
    system: BILLING_EXCEPTION_IDENTIFIER_SYSTEM,
    value: getBillingExceptionIdentifierValue(consultationId),
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

export function buildBillingExceptionTaskResource(input: CreateBillingExceptionTaskInput): Task {
  const description = `${input.errorSummary.trim()} (${new Date().toISOString()})`;
  return {
    resourceType: "Task",
    status: "requested",
    intent: "order",
    code: {
      coding: [{ system: BILLING_EXCEPTION_CODE_SYSTEM, code: BILLING_EXCEPTION_CODE }],
      text: "Billing exception follow-up",
    },
    identifier: [
      { system: CLINIC_IDENTIFIER_SYSTEM, value: input.clinicId },
      buildBillingExceptionIdentifier(input.consultationId),
    ],
    description,
    authoredOn: nowIso(),
    for: { reference: `Patient/${input.patientId}` },
    focus: input.invoiceId
      ? { reference: `Invoice/${input.invoiceId}` }
      : { reference: `Encounter/${input.consultationId}` },
    requester: input.requesterReference ? { reference: input.requesterReference } : undefined,
    extension: [
      { url: CONSULTATION_ID_EXTENSION_URL, valueString: input.consultationId },
      { url: CLINIC_ID_EXTENSION_URL, valueString: input.clinicId },
      { url: ERROR_CLASS_EXTENSION_URL, valueString: input.errorClass },
      ...(input.paymentMethod
        ? [{ url: PAYMENT_METHOD_EXTENSION_URL, valueString: input.paymentMethod }]
        : []),
    ],
  };
}

export async function findOpenBillingExceptionTask(
  medplum: MedplumClient,
  consultationId: string,
  clinicId: string
): Promise<Task | null> {
  const tenant = await resolveClinicTenant(medplum, clinicId);
  if (!tenant) throw new Error("Clinic context required");
  const identifier = `${BILLING_EXCEPTION_IDENTIFIER_SYSTEM}|${getBillingExceptionIdentifierValue(consultationId)}`;
  const existing = await medplum.searchResources("Task", {
    identifier,
    _compartment: tenant.accountReference,
    _count: "20",
  }, { cache: "no-cache", headers: { "X-Medplum": "extended" } });
  const open = (existing as Task[]).find(
    (task) => task.status === "requested" || task.status === "in-progress"
  );
  return open ?? null;
}

export async function createBillingExceptionTask(
  medplum: MedplumClient,
  input: CreateBillingExceptionTaskInput
): Promise<Task> {
  await assertPatientInClinic(medplum, input.clinicId, input.patientId, input.consultationId);
  const existingOpen = await findOpenBillingExceptionTask(medplum, input.consultationId, input.clinicId);
  if (existingOpen) {
    if (getBillingTaskClinicId(existingOpen) !== input.clinicId ||
        existingOpen.for?.reference !== `Patient/${input.patientId}`) {
      throw new Error('Billing task unavailable');
    }
    return existingOpen;
  }
  const task = buildBillingExceptionTaskResource(input);
  return medplum.createResource<Task>(task);
}

export async function listBillingExceptionTasks(
  medplum: MedplumClient,
  status: BillingTaskListStatus = "open",
  clinicId?: string
): Promise<Task[]> {
  const params: Record<string, string> = {
    code: `${BILLING_EXCEPTION_CODE_SYSTEM}|${BILLING_EXCEPTION_CODE}`,
    _sort: "-_lastUpdated",
  };
  if (clinicId) {
    params.identifier = `${CLINIC_IDENTIFIER_SYSTEM}|${clinicId}`;
  }
  if (status === "open") {
    params.status = "requested,in-progress";
  }
  const tasks = await searchAllPages(medplum, "Task", params);
  const byStatus = status === "open"
    ? tasks.filter((task) => task.status === "requested" || task.status === "in-progress")
    : tasks;

  if (!clinicId) {
    return byStatus;
  }
  return byStatus.filter((task) => getBillingTaskClinicId(task) === clinicId);
}

function getNextAllowedStatuses(current: BillingTaskStatus): BillingTaskStatus[] {
  if (current === "requested") return ["in-progress", "completed", "cancelled"];
  if (current === "in-progress") return ["completed", "cancelled"];
  return [];
}

function coerceTaskStatus(value: string): BillingTaskStatus {
  if (value === "requested" || value === "in-progress" || value === "completed" || value === "cancelled") {
    return value;
  }
  throw new Error(`Unsupported task status: ${value}`);
}

export async function updateBillingExceptionTaskStatus(
  medplum: MedplumClient,
  taskId: string,
  status: BillingTaskStatus,
  note?: string,
  clinicId?: string
): Promise<Task> {
  const task = (await medplum.readResource("Task", taskId, { cache: "no-cache", headers: { "X-Medplum": "extended" } })) as Task;
  assertResourceInClinic(task, clinicId);
  const currentStatus = coerceTaskStatus(task.status || "requested");
  if (currentStatus === status) {
    return task;
  }
  const allowed = getNextAllowedStatuses(currentStatus);
  if (!allowed.includes(status)) {
    throw new Error(`Invalid status transition: ${currentStatus} -> ${status}`);
  }

  const annotations: Annotation[] = task.note ? [...task.note] : [];
  const cleanedNote = note?.trim();
  if (cleanedNote) {
    annotations.push({ time: nowIso(), text: cleanedNote });
  }

  return medplum.updateResource(withClinicIdentifier({
    ...task,
    status,
    note: annotations.length > 0 ? annotations : undefined,
  }, clinicId));
}
