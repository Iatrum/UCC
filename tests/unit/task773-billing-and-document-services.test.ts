import { describe, expect, mock, spyOn, test } from "bun:test";
import type { MedplumClient } from "@medplum/core";
import type { Resource, Task } from "@medplum/fhirtypes";
import {
  createBillingExceptionTask,
  listBillingExceptionTasks,
  updateBillingExceptionTaskStatus,
} from "@/lib/fhir/billing-task-service";
import { createPatientDocument } from "@/lib/fhir/document-service";
import { STORAGE_PATH_EXTENSION_URL } from "@/lib/fhir/structure-definitions";

const clinicId = "clinic-a";
const clinicIdentifier = { system: "clinic", value: clinicId };
const patientId = "fake-patient";
const consultationId = "fake-encounter";
const patientReference = { reference: `Patient/${patientId}` };
const clinicExtension = { url: "https://ucc.emr/task/clinic-id", valueString: clinicId };

function billingTask(overrides: Partial<Task> = {}): Task {
  return {
    resourceType: "Task",
    id: "fake-task",
    status: "requested",
    intent: "order",
    identifier: [clinicIdentifier],
    extension: [clinicExtension],
    for: patientReference,
    ...overrides,
  };
}

function clinicClient(task?: Task) {
  const readResource = mock(async (resourceType: string, id: string): Promise<Resource> => {
    if (resourceType === "Organization" && id === clinicId) return { resourceType, id };
    if (resourceType === "Patient" && id === patientId) {
      return { resourceType, id, identifier: [clinicIdentifier] };
    }
    if (resourceType === "Encounter" && id === consultationId) {
      return { resourceType, id, status: "finished", class: { code: "AMB" }, identifier: [clinicIdentifier], subject: patientReference };
    }
    if (resourceType === "Task" && task?.id === id) return task;
    throw new Error(`Unavailable synthetic resource ${resourceType}/${id}`);
  });
  const searchOne = mock(async (resourceType: string, query: { identifier?: string }): Promise<Resource> => {
    if (query.identifier === `clinic|${clinicId}`) {
      if (resourceType === "Organization") return { resourceType, id: clinicId };
      if (resourceType === "HealthcareService") return { resourceType, id: "clinic-a-account" };
    }
    throw new Error(`Unexpected synthetic directory lookup for ${resourceType}`);
  });
  const searchResources = mock(async (_resourceType: string, _query: Record<string, string>) => task ? [task] : []);
  const createResource = mock(async (resource: Resource): Promise<Resource> => ({ ...resource, id: "new-record" }));
  const updateResource = mock(async (resource: Resource): Promise<Resource> => resource);
  const client = { readResource, searchOne, searchResources, createResource, updateResource } as unknown as MedplumClient;
  return { client, readResource, searchResources, createResource, updateResource };
}

describe("billing exception tasks", () => {
  const input = {
    consultationId,
    patientId,
    clinicId,
    paymentMethod: "cash",
    errorClass: "SyntheticFailure",
    errorSummary: "  Synthetic payment failure  ",
    invoiceId: "fake-invoice",
    requesterReference: "Practitioner/fake-practitioner",
  };

  test("creates a clinic-tagged follow-up for the invoice when prior tasks are closed", async () => {
    const { client, searchResources, createResource } = clinicClient(billingTask({ status: "completed" }));

    expect(await createBillingExceptionTask(client, input)).toMatchObject({ id: "new-record", status: "requested" });
    const [[resourceType, query]] = searchResources.mock.calls;
    expect(resourceType).toBe("Task");
    expect(query).toMatchObject({
      identifier: `https://ucc.emr/task/billing-exception|${consultationId}`,
      _compartment: "HealthcareService/clinic-a-account",
    });
    expect(createResource).toHaveBeenCalledTimes(1);
    expect(createResource).toHaveBeenCalledWith(expect.objectContaining({
      resourceType: "Task",
      status: "requested",
      intent: "order",
      focus: { reference: "Invoice/fake-invoice" },
      for: patientReference,
      requester: { reference: input.requesterReference },
      description: expect.stringMatching(/^Synthetic payment failure\b/),
      identifier: expect.arrayContaining([
        clinicIdentifier,
        { system: "https://ucc.emr/task/billing-exception", value: consultationId },
      ]),
      extension: expect.arrayContaining([
        clinicExtension,
        { url: "https://ucc.emr/task/payment-method", valueString: "cash" },
      ]),
    }));
  });

  test("reuses an in-progress follow-up for the same clinic and patient", async () => {
    const existing = billingTask({ status: "in-progress" });
    const { client, createResource } = clinicClient(existing);

    expect(await createBillingExceptionTask(client, input)).toEqual(existing);
    expect(createResource).not.toHaveBeenCalled();
  });

  test.each([
    ["clinic", billingTask({ extension: [{ ...clinicExtension, valueString: "clinic-b" }] })],
    ["patient", billingTask({ for: { reference: "Patient/fake-other" } })],
  ] as const)("refuses to reuse a follow-up for a different %s", async (_field, existing) => {
    const { client, createResource } = clinicClient(existing);

    await expect(createBillingExceptionTask(client, input)).rejects.toThrow("Billing task unavailable");
    expect(createResource).not.toHaveBeenCalled();
  });

  test("filters foreign tasks and applies the open status filter across pages", async () => {
    const requested = billingTask({ id: "fake-requested" });
    const inProgress = billingTask({ id: "fake-in-progress", status: "in-progress" });
    const completed = billingTask({ id: "fake-completed", status: "completed" });
    const foreign = billingTask({
      id: "fake-foreign",
      identifier: [{ ...clinicIdentifier, value: "clinic-b" }],
      extension: [{ ...clinicExtension, valueString: "clinic-b" }],
    });
    const searchResourcePages = mock(async function* (type: string, query: URLSearchParams) {
      expect(type).toBe("Task");
      expect(query.get("identifier")).toBe("clinic|clinic-a");
      expect(query.get("code")).toBe("https://ucc.emr/task-type|billing-exception");
      yield [requested, foreign];
      yield [completed, inProgress];
    });
    const client = { searchResourcePages } as unknown as MedplumClient;

    expect(await listBillingExceptionTasks(client, "open", clinicId)).toEqual([requested, inProgress]);
    expect(await listBillingExceptionTasks(client, "all", clinicId)).toEqual([requested, completed, inProgress]);
    const [openQuery, allQuery] = searchResourcePages.mock.calls.map(([, query]) => query);
    expect(openQuery.get("status")?.split(",").sort()).toEqual(["in-progress", "requested"]);
    expect(allQuery.has("status")).toBe(false);
  });

  test("keeps prior notes when finishing an in-progress task with a blank note", async () => {
    const notes = [{ text: "Synthetic existing note" }];
    const { client, updateResource } = clinicClient(billingTask({ status: "in-progress", note: notes }));

    await updateBillingExceptionTaskStatus(client, "fake-task", "completed", "  ", clinicId);
    expect(updateResource).toHaveBeenCalledTimes(1);
    expect(updateResource).toHaveBeenCalledWith(expect.objectContaining({
      status: "completed",
      note: notes,
      identifier: [clinicIdentifier],
    }));
  });

  test.each(["completed", "cancelled"] as const)("cannot reopen a %s task", async (status) => {
    const { client, updateResource } = clinicClient(billingTask({ status }));

    await expect(updateBillingExceptionTaskStatus(client, "fake-task", "in-progress", undefined, clinicId))
      .rejects.toThrow(`Invalid status transition: ${status} -> in-progress`);
    expect(updateResource).not.toHaveBeenCalled();
  });
});

describe("patient document registration", () => {
  const document = {
    patientId,
    clinicId,
    title: "Synthetic PDF",
    url: "https://example.invalid/fake.pdf",
    contentType: "application/pdf",
    size: 123,
    uploadedBy: "Synthetic uploader",
    storagePath: "fake-patient/fake.pdf",
  };

  test("registers the attachment and storage path on a clinic-tagged DocumentReference", async () => {
    const { client, createResource } = clinicClient();

    expect(await createPatientDocument(client, document)).toBe("new-record");
    expect(createResource).toHaveBeenCalledTimes(1);
    expect(createResource).toHaveBeenCalledWith(expect.objectContaining({
      resourceType: "DocumentReference",
      status: "current",
      identifier: [clinicIdentifier],
      subject: patientReference,
      author: [{ display: document.uploadedBy }],
      content: [{
        attachment: {
          title: document.title,
          url: document.url,
          contentType: document.contentType,
          size: document.size,
          creation: expect.any(String),
        },
      }],
      extension: [{ url: STORAGE_PATH_EXTENSION_URL, valueString: document.storagePath }],
    }));
  });

  test("rejects an attachment with no URL before writing a DocumentReference", async () => {
    const { client, createResource } = clinicClient();
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      await expect(createPatientDocument(client, { ...document, url: "" }))
        .rejects.toThrow("attachment missing url or data");
      expect(createResource).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  test("rejects a create response without a resource id", async () => {
    const { client, createResource } = clinicClient();
    createResource.mockImplementationOnce(async (resource) => resource);

    await expect(createPatientDocument(client, document)).rejects.toThrow("missing id");
    expect(createResource).toHaveBeenCalledTimes(1);
  });

  test("returns the created id if the audit service cannot read back the document", async () => {
    const { client, readResource, createResource } = clinicClient();
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(await createPatientDocument(client, { ...document, practitionerId: "fake-practitioner" })).toBe("new-record");
      expect(createResource).toHaveBeenCalledTimes(1);
      expect(readResource.mock.calls.some(([type, id]) => type === "DocumentReference" && id === "new-record")).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });
});
