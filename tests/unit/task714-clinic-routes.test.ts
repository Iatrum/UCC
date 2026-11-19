import { afterAll, afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import type { Extension, Resource } from "@medplum/fhirtypes";
import { NextRequest } from "next/server";
import { clearAnalyticsCache } from "@/lib/analytics/queries";
import { env } from "@/lib/env";
import { getDefaultTemplate } from "@/lib/fhir/document-template-service";
import { MODULE_SETTINGS_EXTENSION_URL } from "@/lib/module-settings";
import { invalidateModuleIdsMemo } from "@/lib/server/module-ids-memo";
import { AuthError, ForbiddenError } from "@/lib/server/route-helpers";
import { CLINIC_A, CLINIC_B, createMockMedplum } from "./helpers/mock-medplum";

const templateUrl = "https://ucc.emr/document-template/mc";
const reviewUrl = "https://ucc.emr/organization/follow-up-review-template";

function tagged(clinicId: string) {
  return [{ system: "clinic", value: clinicId }];
}

function clinicOrg(clinicId: string, extension: Extension[] = []) {
  return { resourceType: "Organization", id: `org-${clinicId}`, name: clinicId, identifier: tagged(clinicId), extension };
}

let medplum = createMockMedplum();
let clinicId = CLINIC_A;
let authenticated = true;
let admin = false;
const realAuth = { ...(await import("@/lib/server/medplum-auth")) };
const realAdmin = { ...(await import("@/lib/server/medplum-admin")) };
const previousRegistry = { ...(await import("@/lib/module-registry")) };
// Some ingress suites leave this export mocked. Load the real lookup for the toggle tests.
const { isModuleEnabledForClinic } = await import("../../lib/module-registry?task714");

async function getSession() {
  if (!authenticated) throw new AuthError("Fake session required");
  return medplum.client;
}

mock.module("@/lib/server/medplum-auth", () => ({
  ...realAuth,
  requireClinicAuth: async () => ({ clinicId, medplum: await getSession() }),
  requirePlatformAdmin: async () => {
    const session = await getSession();
    if (!admin) throw new ForbiddenError("Platform admin access required");
    return session;
  },
  getCurrentProfile: async () => {
    await getSession();
    return { resourceType: "Practitioner", id: "fake-staff" };
  },
}));
mock.module("@/lib/server/medplum-admin", () => ({ ...realAdmin, getAdminMedplum: async () => medplum.client }));
mock.module("@/lib/module-registry", () => ({ ...previousRegistry, isModuleEnabledForClinic }));

const templates = await import("@/app/api/document-templates/route");
const settings = await import("@/app/api/settings/follow-up/route");
const clinics = await import("@/app/api/admin/clinics/[id]/route");
const devices = await import("@/app/api/pacs/devices/route");
const followUps = await import("@/app/api/follow-up/route");
const followUpById = await import("@/app/api/follow-up/[id]/route");
const due = await import("@/app/api/follow-up/process-due/route");
const analytics = await import("@/app/api/analytics/[tab]/route");

afterAll(() => {
  mock.module("@/lib/server/medplum-auth", () => realAuth);
  mock.module("@/lib/server/medplum-admin", () => realAdmin);
  mock.module("@/lib/module-registry", () => previousRegistry);
  clearAnalyticsCache();
  invalidateModuleIdsMemo();
});

beforeEach(() => {
  clinicId = CLINIC_A;
  authenticated = true;
  admin = false;
  medplum = createMockMedplum([
    clinicOrg(CLINIC_A, [{ url: templateUrl, valueString: "<p>Fake A</p>" }]),
    clinicOrg(CLINIC_B, [
      { url: templateUrl, valueString: "<p>Fake B</p>" },
      { url: reviewUrl, valueString: "Fake B review" },
    ]),
  ]);
  clearAnalyticsCache();
  invalidateModuleIdsMemo();
});

function request(path: string, method = "GET", body?: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const templatePath = "/api/document-templates";
const settingsPath = "/api/settings/follow-up";

describe("clinic document templates and follow-up settings", () => {
  test("member reads only their clinic's template, with a default for a missing type", async () => {
    const res = await templates.GET(request(`${templatePath}?type=mc&clinicId=${CLINIC_B}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ html: "<p>Fake A</p>" });
    const fallback = await templates.GET(request(`${templatePath}?type=referral`));
    expect(await fallback.json()).toEqual({ html: getDefaultTemplate("referral") });
    expect((await templates.GET(request(`${templatePath}?type=other`))).status).toBe(400);
  });

  test("only an admin can save a valid template, scoped to the active clinic", async () => {
    const body = { clinicId: CLINIC_B, type: "mc", html: "<p>Fake A updated</p>" };
    const save = () => templates.POST(request(templatePath, "POST", body));
    expect((await save()).status).toBe(403);
    expect(medplum.writes).toEqual([]);

    admin = true;
    expect((await templates.POST(request(templatePath, "POST", { ...body, html: " " }))).status).toBe(400);
    expect(medplum.writes).toEqual([]);
    expect((await save()).status).toBe(200);
    expect(medplum.updates("Organization").map((org) => org.id)).toEqual([`org-${CLINIC_A}`]);
    expect(await (await templates.GET(request(`${templatePath}?type=mc`))).json()).toEqual({ html: body.html });

    clinicId = CLINIC_B;
    expect(await (await templates.GET(request(`${templatePath}?type=mc`))).json()).toEqual({ html: "<p>Fake B</p>" });
  });

  test("follow-up settings ignore a foreign Organization with a colliding resource ID", async () => {
    medplum.db.set(`Organization/${CLINIC_A}`, {
      ...clinicOrg(CLINIC_B, [{ url: reviewUrl, valueString: "Foreign ID collision" }]),
      id: CLINIC_A,
    });
    const read = () => settings.GET(request(settingsPath));
    const save = () => settings.PUT(request(settingsPath, "PUT", {
      clinicId: CLINIC_B,
      deliveryMode: "manual",
      reviewTemplate: "Fake A review",
    }));
    expect((await (await read()).json()).settings.reviewTemplate).not.toBe("Foreign ID collision");
    expect((await save()).status).toBe(403);
    expect(medplum.writes).toEqual([]);

    admin = true;
    expect((await settings.PUT(request(settingsPath, "PUT", { deliveryMode: "other" }))).status).toBe(400);
    const saved = await save();
    expect(saved.status).toBe(200);
    expect((await saved.json()).settings).toMatchObject({ deliveryMode: "manual", reviewTemplate: "Fake A review" });
    expect((await (await read()).json()).settings.reviewTemplate).toBe("Fake A review");
    expect(medplum.updates("Organization").map((org) => org.id)).toEqual([`org-${CLINIC_A}`]);
    expect(medplum.stored("Organization", CLINIC_A)?.extension).toEqual([{ url: reviewUrl, valueString: "Foreign ID collision" }]);
    clinicId = CLINIC_B;
    expect((await (await read()).json()).settings.reviewTemplate).toBe("Fake B review");
  });

  test("anonymous requests cannot read or write clinic settings", async () => {
    authenticated = false;
    expect((await templates.GET(request(`${templatePath}?type=mc`))).status).toBe(401);
    expect((await templates.POST(request(templatePath, "POST", { type: "mc", html: "<p>Fake</p>" }))).status).toBe(401);
    expect((await settings.GET(request(settingsPath))).status).toBe(401);
    expect((await settings.PUT(request(settingsPath, "PUT", { deliveryMode: "manual" }))).status).toBe(401);
    expect(medplum.writes).toEqual([]);
  });
});

test("a saved clinic toggle gates the X-ray device route and leaves Time Chit available", async () => {
  const listDevices = mock(async function* (_type: string, params: { identifier: string }) {
    expect(params.identifier).toBe(`clinic|${CLINIC_A}`);
    yield [CLINIC_A, CLINIC_B].map((clinic) => ({
      resourceType: "Device",
      id: `device-${clinic}`,
      identifier: tagged(clinic),
      type: { coding: [{ system: "https://ucc.emr/xray/device-type", code: "orthanc" }] },
    }));
  });
  Object.assign(medplum.client, { searchResourcePages: listDevices });

  const list = () => devices.GET(request("/api/pacs/devices"));
  const setModules = (enabledModuleIds: string[]) => clinics.PATCH(
    request(`/api/admin/clinics/org-${CLINIC_A}`, "PATCH", { name: "Fake Clinic A", enabledModuleIds }),
    { params: Promise.resolve({ id: `org-${CLINIC_A}` }) },
  );

  expect((await list()).status).toBe(404);
  expect(listDevices).not.toHaveBeenCalled();
  expect((await setModules(["pacs"])).status).toBe(403);
  expect(medplum.writes).toEqual([]);

  admin = true;
  const enabled = await setModules(["pacs", "time-chit"]);
  expect(enabled.status).toBe(200);
  expect((await enabled.json()).clinic.enabledModuleIds).toEqual(["pacs"]);
  const visible = await list();
  expect(visible.status).toBe(200);
  expect((await visible.json()).devices).toMatchObject([{ id: `device-${CLINIC_A}` }]);

  clinicId = CLINIC_B;
  expect((await list()).status).toBe(404);
  clinicId = CLINIC_A;
  expect((await setModules([])).status).toBe(200);
  expect((await list()).status).toBe(404);
  expect(listDevices).toHaveBeenCalledTimes(1);
  expect(medplum.stored("Organization", `org-${CLINIC_A}`)?.extension).toContainEqual({
    url: MODULE_SETTINGS_EXTENSION_URL,
    valueString: "[]",
  });
  const chit = await templates.GET(request(`${templatePath}?type=time-chit`));
  expect(chit.status).toBe(200);
  expect(await chit.json()).toEqual({ html: getDefaultTemplate("time-chit") });
});

describe("follow-up send and scheduling", () => {
  const path = "/api/follow-up";
  const payload = {
    patientName: "Fake Patient",
    patientPhone: "+12025550123",
    type: "appointment-reminder",
    message: "Fake appointment reminder",
    deliveryMode: "twilio",
    dueDate: "2099-01-01T00:00:00.000Z",
  };
  const twilioConfig = {
    TWILIO_ACCOUNT_SID: "ACfake",
    TWILIO_AUTH_TOKEN: "fake-token",
    TWILIO_WHATSAPP_FROM: "+12025550124",
    TWILIO_STATUS_CALLBACK_URL: "https://clinic.example.test/api/follow-up/twilio/status",
  };
  const originalTwilioConfig = Object.fromEntries(Object.keys(twilioConfig).map((key) => [key, env[key as keyof typeof twilioConfig]]));
  const send = mock(async (_url: string, _options?: RequestInit) =>
    Response.json({ sid: "SMfake", status: "queued" }, { status: 201 }));
  let restoreFetch: () => void;

  beforeEach(() => {
    Object.assign(env, twilioConfig);
    send.mockClear();
    const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(send);
    restoreFetch = () => fetchSpy.mockRestore();
  });

  afterEach(() => {
    restoreFetch();
    Object.assign(env, originalTwilioConfig);
  });

  async function schedule(overrides: Partial<typeof payload> = {}) {
    const res = await followUps.POST(request(path, "POST", { ...payload, ...overrides }));
    expect(res.status).toBe(201);
    return (await res.json()).followUp;
  }

  function patch(id: string, body: unknown) {
    return followUpById.PATCH(request(`${path}/${id}`, "PATCH", body), { params: Promise.resolve({ id }) });
  }

  test("scheduling stays pending and only the owning clinic can list or send it", async () => {
    const scheduled = await schedule();
    expect(scheduled).toMatchObject({ clinicId: CLINIC_A, dueDate: payload.dueDate, deliveryStatus: "pending" });
    expect(medplum.creates("Communication")[0].identifier).toContainEqual(tagged(CLINIC_A)[0]);
    expect(send).not.toHaveBeenCalled();

    clinicId = CLINIC_B;
    expect((await (await followUps.GET(request(path))).json()).followUps).toEqual([]);
    expect((await patch(scheduled.id, { action: "send-twilio" })).status).toBe(404);
    expect(medplum.updates()).toEqual([]);
    expect(send).not.toHaveBeenCalled();

    clinicId = CLINIC_A;
    expect((await (await followUps.GET(request(path))).json()).followUps).toMatchObject([{ id: scheduled.id }]);
    const response = await patch(scheduled.id, { action: "send-twilio" });
    expect(response.status).toBe(200);
    expect((await response.json()).followUp).toMatchObject({ status: "in-progress", deliveryStatus: "queued", twilioMessageSid: "SMfake" });
    expect(send).toHaveBeenCalledTimes(1);
    const [url, options] = send.mock.calls[0];
    expect(url).toBe("https://api.twilio.com/2010-04-01/Accounts/ACfake/Messages.json");
    expect(options?.method).toBe("POST");
    const form = options?.body as URLSearchParams;
    expect(form.get("To")).toBe(`whatsapp:${payload.patientPhone}`);
    expect(form.get("Body")).toBe(payload.message);
    expect(new URL(form.get("StatusCallback")!).searchParams.get("clinic")).toBe(CLINIC_A);
  });

  test.each(["invalid", "2026-02-30", 1])("invalid due date %p returns 400 without creating a record", async (dueDate) => {
    expect((await followUps.POST(request(path, "POST", { ...payload, dueDate }))).status).toBe(400);
    expect(medplum.writes).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });

  test("scheduling accepts the date-only value from the reminder form", async () => {
    const dueDate = "2099-01-01";
    expect(await schedule({ dueDate })).toMatchObject({ dueDate, deliveryStatus: "pending" });
    expect(send).not.toHaveBeenCalled();
  });

  test("unknown actions return 400 without changing the record or sending", async () => {
    const { id } = await schedule();
    expect((await patch(id, { action: "unknown" })).status).toBe(400);
    expect(medplum.updates()).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });

  test("process-due queues only eligible records from the active clinic and skips queued sends on the next run", async () => {
    const eligible = await schedule();
    const manual = await schedule({ deliveryMode: "manual" });
    const future = await schedule();
    const stopped = await schedule();
    const completed = await schedule();
    medplum.stored("Communication", stopped.id)!.status = "stopped";
    medplum.stored("Communication", completed.id)!.status = "completed";
    clinicId = CLINIC_B;
    const foreign = await schedule();
    clinicId = CLINIC_A;

    for (const id of [eligible.id, manual.id, foreign.id, stopped.id, completed.id]) {
      const record = medplum.stored("Communication", id)!;
      const date = (record.extension as Extension[]).find((ext) => ext.valueDateTime === payload.dueDate)!;
      date.valueDateTime = "2000-01-01T00:00:00.000Z";
    }

    const process = () => due.POST(request(`${path}/process-due`, "POST"));
    const sent = await process();
    expect(sent.status).toBe(200);
    expect(await sent.json()).toMatchObject({ count: 1, followUps: [{ id: eligible.id, deliveryStatus: "queued" }] });
    expect(await (await process()).json()).toMatchObject({ count: 0, followUps: [] });
    expect(send).toHaveBeenCalledTimes(1);
    expect(medplum.updates().map((row) => row.id)).toEqual([eligible.id]);
    expect(medplum.stored("Communication", future.id)?.status).toBe("preparation");
  });
});

describe("clinic analytics tabs", () => {
  test("both tabs scope searches and keep foreign aggregates out of responses and cache entries", async () => {
    const date = new Date().toISOString();
    const resources: Resource[] = [
      { resourceType: "Condition", id: "condition-a", identifier: tagged(CLINIC_A), recordedDate: date, code: { text: "Fake A diagnosis" } },
      { resourceType: "Condition", id: "condition-b", identifier: tagged(CLINIC_B), recordedDate: date, code: { text: "Fake B diagnosis" } },
      { resourceType: "Invoice", id: "invoice-a", identifier: tagged(CLINIC_A), date, status: "issued", totalGross: { value: 25, currency: "MYR" } },
      { resourceType: "Invoice", id: "invoice-b", identifier: tagged(CLINIC_B), date, status: "issued", totalGross: { value: 90, currency: "MYR" } },
    ];
    const searchResources = mock(async (type: string, _params: URLSearchParams | { identifier?: string }) => {
      if (type === "Organization") return [clinicOrg(clinicId)];
      return resources.filter((row) => row.resourceType === type);
    });
    const search = mock(async (type: string, params: URLSearchParams) => {
      const completed = type === "Communication" && params.get("status") === "completed";
      return { total: completed ? (params.get("identifier") === `clinic|${CLINIC_A}` ? 1 : 3) : 0 };
    });
    Object.assign(medplum.client, { searchResources, search });

    const tab = (name: "clinical" | "money") =>
      analytics.GET(request(`/api/analytics/${name}?range=7d&clinicId=${CLINIC_B}`), { params: Promise.resolve({ tab: name }) });

    async function expectClinic(diagnosis: string, completed: number, revenue: number) {
      searchResources.mockClear();
      search.mockClear();
      const clinical = await tab("clinical");
      const money = await tab("money");
      expect(clinical.status).toBe(200);
      expect(money.status).toBe(200);
      const data = await clinical.json();
      expect(data.diagnoses).toMatchObject([{ name: diagnosis, value: 1 }]);
      expect(data.followUps).toMatchObject({ completed });
      expect((await money.json()).revenue).toMatchObject({ value: revenue });
      for (const [, query] of [...searchResources.mock.calls, ...search.mock.calls]) {
        const identifier = query instanceof URLSearchParams ? query.get("identifier") : query.identifier;
        expect(identifier).toBe(`clinic|${clinicId}`);
      }
      for (const [, query] of search.mock.calls) expect(query.get("_summary")).toBe("count");
    }

    await expectClinic("Fake A diagnosis", 1, 25);
    clinicId = CLINIC_B;
    await expectClinic("Fake B diagnosis", 3, 90);
    clinicId = CLINIC_A;
    await expectClinic("Fake A diagnosis", 1, 25);
  });
});
