import { afterAll, afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import { NextRequest } from "next/server";
import { CLINIC_IDENTIFIER_SYSTEM } from "../../lib/fhir/clinic-tenancy";
import { ForbiddenError, NotFoundError } from "../../lib/server/route-helpers";
import { isSafeFhirId, isValidClinicId } from "../../lib/server/clinic-id";

// Task 645: API audit fixes. Fake data only; no network (fetch is spied and must stay unused).
const realHeaders = await import("next/headers");
let cookieJar: Record<string, string> = {};
mock.module("next/headers", () => ({
  ...realHeaders,
  cookies: async () => ({
    get: (name: string) => (name in cookieJar ? { name, value: cookieJar[name] } : undefined),
    set: () => undefined,
    delete: () => undefined,
  }),
  headers: async () => new Headers(),
}));
// Other unit files replace medplum-auth with stubs and bun does not reliably undo that, so load the real
// implementation under a unique specifier and pin the alias to it before the routes are imported.
const realAuth = await import("../../lib/server/medplum-auth.ts?task645");
mock.module("@/lib/server/medplum-auth", () => realAuth);
const { requireClinicAuth } = realAuth;
const registerExtensions = await import("../../app/api/fhir/register-extensions/route");
const auditLog = await import("../../app/api/audit-log/route");
const { updateClinicalCatalogItem } = await import("../../lib/fhir/catalog-service");
const { updateProcedureInMedplum } = await import("../../lib/fhir/procedure-service");
afterAll(() => {
  mock.module("next/headers", () => realHeaders);
});

let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">> | undefined;
afterEach(() => {
  fetchSpy?.mockRestore();
  cookieJar = {};
});
const noNetwork = () => {
  fetchSpy = spyOn(globalThis, "fetch").mockImplementation(async () => {
    throw new Error("unexpected network request");
  });
  return fetchSpy;
};

const req = (url: string, init: RequestInit & { cookie?: string } = {}) => {
  const { cookie, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (cookie) headers.set("cookie", cookie);
  return new NextRequest(url, { ...rest, headers });
};

describe("identifier shape checks", () => {
  it.each(["clinic-a", "clinic.a", "c1", "0123abcd-ef01-4234-8abc-0123456789ab"])("accepts clinic id %s", (id) => {
    expect(isValidClinicId(id)).toBe(true);
  });
  it.each(["", "a,b", "mine,clinic|other", "a|b", "a b", "-lead", "a/b", "a".repeat(65), "x\\,y", "a;b", undefined, 5])(
    "rejects clinic id %p",
    (id) => expect(isValidClinicId(id)).toBe(false)
  );
  it.each(["abc", "a-b.c", "123"])("accepts FHIR id %s", (id) => expect(isSafeFhirId(id)).toBe(true));
  it.each(["", "a,b", "Patient/x", "a|b", "a".repeat(65), null])("rejects FHIR id %p", (id) => expect(isSafeFhirId(id)).toBe(false));
});

describe("requireClinicAuth fails closed on a forged clinic cookie", () => {
  it.each(["mine,clinic|other", "a|b", "../x"])("403 (ForbiddenError) for cookie %s, before any Medplum call", async (forged) => {
    const spy = noNetwork();
    cookieJar = { "medplum-clinic": forged };
    const request = req("http://localhost:3210/api/patients", {
      headers: { authorization: "Bearer opaque-fake-token" },
      cookie: `medplum-clinic=${encodeURIComponent(forged)}`,
    });
    await expect(requireClinicAuth(request)).rejects.toBeInstanceOf(ForbiddenError);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("POST|GET /api/fhir/register-extensions", () => {
  it("is no longer anonymous: 401 without a session, nothing is called", async () => {
    const spy = noNetwork();
    const res = await registerExtensions.POST(req("http://localhost:3210/api/fhir/register-extensions", { method: "POST" }));
    expect(res.status).toBe(401);
    expect(JSON.stringify(await res.json())).not.toContain("details");
    expect(spy).not.toHaveBeenCalled();
  });

  it("GET has no side effects (Task 720): 405, nothing called", async () => {
    const spy = noNetwork();
    expect((await registerExtensions.GET()).status).toBe(405);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("POST /api/audit-log", () => {
  it("401 without a session", async () => {
    const spy = noNetwork();
    const res = await auditLog.POST(
      req("http://localhost:3210/api/audit-log", { method: "POST", body: JSON.stringify({ action: "x", subjectType: "patient" }) })
    );
    expect(res.status).toBe(401);
    expect(spy).not.toHaveBeenCalled();
  });

  it("403 for a signed-in caller with a forged clinic cookie", async () => {
    const spy = noNetwork();
    const res = await auditLog.POST(
      req("http://localhost:3210/api/audit-log", {
        method: "POST",
        headers: { authorization: "Bearer opaque-fake-token" },
        cookie: "medplum-clinic=mine%2Cclinic%7Cother",
        body: JSON.stringify({ action: "x", subjectType: "patient", userId: "Practitioner/spoofed" }),
      })
    );
    expect(res.status).toBe(403);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("id-addressed foreign resources are 404 (Task 422 rule)", () => {
  const foreignDefinition = {
    resourceType: "ChargeItemDefinition",
    id: "def-b",
    identifier: [{ system: CLINIC_IDENTIFIER_SYSTEM, value: "clinic-b" }],
  };
  const fake = { readResource: async () => foreignDefinition } as any;

  it("catalog update of another clinic's item", async () => {
    await expect(updateClinicalCatalogItem(fake, "clinic-a", "def-b", {})).rejects.toBeInstanceOf(NotFoundError);
  });
  it("procedure update of another clinic's item", async () => {
    await expect(updateProcedureInMedplum(fake, "def-b", {}, "clinic-a")).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('Task 646: assertSafeFhirId guard for admin-client id reads', () => {
  it('rejects traversal / search-syntax ids with NotFoundError, accepts real ids', async () => {
    const { assertSafeFhirId } = await import('../../lib/server/clinic-id');
    for (const bad of ['../Patient/1', 'a,b', 'a|b', '', 'x/y', undefined, 42, {}]) {
      expect(() => assertSafeFhirId(bad)).toThrow(NotFoundError);
    }
    for (const ok of ['abc-123', '0f8fad5b-d9cb-469f-a165-70867728950e', 'a.b']) {
      expect(() => assertSafeFhirId(ok)).not.toThrow();
    }
  });
});
