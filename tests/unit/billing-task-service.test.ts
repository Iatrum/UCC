import { beforeEach, describe, expect, it } from "bun:test";
import type { Task } from "@medplum/fhirtypes";
import {
  buildBillingExceptionTaskResource,
  createBillingExceptionTask,
  updateBillingExceptionTaskStatus,
} from "../../lib/fhir/billing-task-service";

type FakeMedplum = {
  createResource: (resource: Task) => Promise<Task>;
  updateResource: (resource: Task) => Promise<Task>;
  readResource: (resourceType: string, id: string) => Promise<Task>;
  searchResources: (resourceType: string, params: Record<string, string>) => Promise<Task[]>;
};

describe("billing-task-service", () => {
  let tasks: Task[];
  let medplum: FakeMedplum;

  beforeEach(() => {
    tasks = [];
    medplum = {
      async createResource(resource: Task) {
        const created = { ...resource, id: resource.id || `task-${tasks.length + 1}` };
        tasks.push(created);
        return created;
      },
      async updateResource(resource: Task) {
        const idx = tasks.findIndex((item) => item.id === resource.id);
        if (idx >= 0) {
          tasks[idx] = resource;
        }
        return resource;
      },
      async readResource(_resourceType: string, id: string) {
        const found = tasks.find((item) => item.id === id);
        if (!found) throw new Error("not found");
        return found;
      },
      async searchResources(_resourceType: string, params: Record<string, string>) {
        const identifier = params.identifier?.split("|")[1];
        if (!identifier) return tasks;
        return tasks.filter((task) =>
          task.identifier?.some((id) => id.value === identifier)
        );
      },
    };
  });

  it("builds valid billing-exception task shape", () => {
    const task = buildBillingExceptionTaskResource({
      consultationId: "enc-1",
      patientId: "pat-1",
      clinicId: "clinic-1",
      paymentMethod: "cash",
      errorClass: "billing-checkout-failed",
      errorSummary: "Invoice create failed",
      requesterReference: "Practitioner/p1",
    });
    expect(task.resourceType).toBe("Task");
    expect(task.status).toBe("requested");
    expect(task.code?.coding?.[0]?.code).toBe("billing-exception");
    expect(task.identifier?.[0]?.system).toBe("https://ucc.emr/task/billing-exception");
    expect(task.for?.reference).toBe("Patient/pat-1");
  });

  it("dedupes open tasks for same consultation", async () => {
    const first = await createBillingExceptionTask(medplum as any, {
      consultationId: "enc-dup",
      patientId: "pat-1",
      clinicId: "clinic-1",
      paymentMethod: "cash",
      errorClass: "billing-checkout-failed",
      errorSummary: "first",
    });
    const second = await createBillingExceptionTask(medplum as any, {
      consultationId: "enc-dup",
      patientId: "pat-1",
      clinicId: "clinic-1",
      paymentMethod: "card",
      errorClass: "queue-update-failed",
      errorSummary: "second",
    });
    expect(first.id).toBe(second.id);
    expect(tasks.length).toBe(1);
  });

  it("blocks invalid status transitions", async () => {
    const created = await createBillingExceptionTask(medplum as any, {
      consultationId: "enc-2",
      patientId: "pat-2",
      clinicId: "clinic-1",
      errorClass: "billing-checkout-failed",
      errorSummary: "failed",
    });

    await updateBillingExceptionTaskStatus(medplum as any, created.id!, "in-progress");
    await updateBillingExceptionTaskStatus(medplum as any, created.id!, "completed");
    await expect(
      updateBillingExceptionTaskStatus(medplum as any, created.id!, "requested")
    ).rejects.toThrow("Invalid status transition");
  });
});

