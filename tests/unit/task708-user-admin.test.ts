import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { readFileSync } from "node:fs";
import * as nextHeaders from "next/headers";
import { NextRequest } from "next/server";
import { env } from "@/lib/env";
import * as admin from "@/lib/server/medplum-admin";
import * as auth from "@/lib/server/medplum-auth";

// Bun shares the module cache across test files. Bind the real auth functions during these tests.
const realAuth = await import("../../lib/server/medplum-auth.ts?task708");
const users = await import("../../app/api/admin/users/route");
const user = await import("../../app/api/admin/users/[id]/route");
const invite = await import("../../app/api/admin/users/invite/route");
const proxyOrigin = "http://medplum-proxy.invalid";
const projectId = "fake-task708-project";
const organizationId = "fake-invite-organization";
const accountId = "fake-invite-healthcare-account";
const practitionerId = "fake-invited-practitioner";
const membershipId = "fake-invited-membership";
const practitionerRef = `Practitioner/${practitionerId}`;
const clinicRef = `Organization/${organizationId}`;
const accountRef = `HealthcareService/${accountId}`;
const policyId = "fake-invite-staff-policy";
const adminToken = "fake-task708-platform-admin-session";
const invitation = {
  firstName: " Fake ",
  lastName: " Invitee ",
  email: " TEST-INVITEE@EXAMPLE.INVALID ",
  clinicId: ` ${organizationId} `,
  sendEmail: false,
  password: "fake-test-password",
};
const proxyConfig = readFileSync(
  new URL("../../infra/staging/rehearsal/dynamic/medplum-allowlist.yml", import.meta.url),
  "utf8"
);
const inviteRule = proxyConfig.match(/medplum-invite:\s[\s\S]*?Method\(`([^`]+)`\) && PathRegexp\(`([^`]+)`\)/);
const restorers: (() => void)[] = [];

function request(method: string, path: string, token?: string, body?: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function setFakeEnv(name: string, value: string) {
  const original = process.env[name];
  process.env[name] = value;
  restorers.push(() => {
    if (original === undefined) delete process.env[name];
    else process.env[name] = original;
  });
}

const bundle = (resources: unknown[]) => Response.json({
  resourceType: "Bundle",
  type: "searchset",
  entry: resources.map((resource) => ({ resource })),
});

const role = {
  resourceType: "PractitionerRole",
  active: true,
  practitioner: { reference: practitionerRef },
  organization: { reference: clinicRef },
};
const membership = {
  resourceType: "ProjectMembership",
  id: membershipId,
  project: { reference: `Project/${projectId}` },
  user: { reference: "User/fake-invitee" },
  profile: { reference: practitionerRef },
};

type UpstreamCall = {
  path: string;
  method: string;
  authorization: string | null;
  query: URLSearchParams;
  body?: unknown;
};
let calls: UpstreamCall[];
let roleSaved: boolean;
let hasDuplicate: boolean;
let adminClientSpy: ReturnType<typeof spyOn<typeof admin, "getAdminMedplum">>;

beforeEach(() => {
  calls = [];
  roleSaved = false;
  hasDuplicate = false;
  const originalBase = env.MEDPLUM_BASE_URL;
  env.MEDPLUM_BASE_URL = proxyOrigin;
  restorers.push(() => { env.MEDPLUM_BASE_URL = originalBase; });
  setFakeEnv("MEDPLUM_PROJECT_ID", projectId);
  setFakeEnv("MEDPLUM_POLICY_CLINIC_STAFF", policyId);
  const guardSpy = spyOn(auth, "requirePlatformAdmin").mockImplementation(realAuth.requirePlatformAdmin);
  const requestClientSpy = spyOn(auth, "getMedplumForRequest").mockImplementation(realAuth.getMedplumForRequest);
  const cookiesSpy = spyOn(nextHeaders, "cookies").mockResolvedValue(new Map() as never);
  adminClientSpy = spyOn(admin, "getAdminMedplum").mockRejectedValue(new Error("Unexpected privileged client"));
  const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const upstream = new Request(input, init);
    const url = new URL(upstream.url);
    if (url.origin !== proxyOrigin) throw new Error("Test attempted to use a non-mock Medplum origin");
    const { pathname: path, searchParams: query } = url;
    const method = upstream.method;
    const authorization = upstream.headers.get("authorization");
    const body = upstream.body ? await upstream.json() : undefined;
    calls.push({ path, method, authorization, query, body });

    if (path === "/auth/me" && method === "GET") {
      return Response.json({
        profile: { resourceType: "Practitioner", id: "fake-caller" },
        membership: { admin: authorization === `Bearer ${adminToken}` },
      });
    }
    if (path.startsWith("/admin/")) {
      if (inviteRule && method === inviteRule[1] && new RegExp(inviteRule[2]).test(path)) {
        return Response.json(membership);
      }
      return new Response(null, { status: 404 });
    }
    if (path === "/fhir/R4/Practitioner" && method === "GET") {
      return bundle(hasDuplicate ? [{ resourceType: "Practitioner", id: "fake-existing-practitioner" }] : []);
    }
    if (path === `/fhir/R4/${clinicRef}` && method === "GET") {
      return Response.json({
        resourceType: "Organization",
        id: organizationId,
        name: "Fake Invite Clinic",
        identifier: [{ system: "clinic", value: "fake-invite-clinic" }],
      });
    }
    if (path === "/fhir/R4/HealthcareService" && method === "POST") {
      return Response.json({ ...body, id: accountId });
    }
    if (path === `/fhir/R4/ProjectMembership/${membershipId}`) {
      if (method === "GET") return Response.json(membership);
      if (method === "PUT") return Response.json(body);
    }
    if (path === "/fhir/R4/PractitionerRole") {
      if (method === "GET") return bundle(roleSaved ? [{ ...role, id: "fake-role" }] : []);
      if (method === "POST") {
        roleSaved = true;
        return Response.json({ ...body, id: "fake-role" });
      }
    }
    if (path === `/fhir/R4/${practitionerRef}/$set-accounts` && method === "POST") {
      return Response.json({ resourceType: "Parameters" });
    }
    throw new Error("Unexpected request to the mocked Medplum proxy");
  });
  restorers.push(
    () => guardSpy.mockRestore(),
    () => requestClientSpy.mockRestore(),
    () => cookiesSpy.mockRestore(),
    () => adminClientSpy.mockRestore(),
    () => fetchSpy.mockRestore(),
  );
});

afterEach(() => {
  restorers.splice(0).reverse().forEach((restore) => restore());
});

const params = { params: Promise.resolve({ id: "fake-staff" }) };
const userPath = "/api/admin/users/fake-staff";
const invitePath = "/api/admin/users/invite";

describe("admin user route role checks", () => {
  const staffRequests = {
    list: (token: string) => users.GET(request("GET", "/api/admin/users", token)),
    read: (token: string) => user.GET(request("GET", userPath, token), params),
    update: (token: string) => user.PATCH(request("PATCH", userPath, token, { firstName: "Fake", lastName: "Staff" }), params),
    delete: (token: string) => user.DELETE(request("DELETE", userPath, token), params),
    invite: (token: string) => invite.POST(request("POST", invitePath, token, invitation)),
  };

  test.each(Object.entries(staffRequests))("denies non-admin staff access to %s", async (action, handler) => {
    const token = `fake-task708-staff-${action}`;
    const response = await handler(token);

    expect(response.status).toBe(403);
    expect(adminClientSpy).not.toHaveBeenCalled();
    expect(calls).toEqual([{
      path: "/auth/me",
      method: "GET",
      authorization: `Bearer ${token}`,
      query: new URLSearchParams(),
      body: undefined,
    }]);
  });

  test("requires authentication before inviting a user", async () => {
    const response = await invite.POST(request("POST", invitePath, undefined, invitation));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Authentication required. Please log in." });
    expect(adminClientSpy).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });
});

describe("POST /api/admin/users/invite", () => {
  test("uses the proxy's allowed POST and grants access to the selected clinic only", async () => {
    const response = await invite.POST(request("POST", invitePath, adminToken, {
      ...invitation,
      organizationIds: ["fake-unrequested-organization"],
      admin: true,
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(adminClientSpy).not.toHaveBeenCalled();
    const adminCalls = calls.filter(({ path }) => path.startsWith("/admin/"));
    expect(adminCalls).toEqual([{
      path: `/admin/projects/${projectId}/invite`,
      method: "POST",
      authorization: `Bearer ${adminToken}`,
      query: new URLSearchParams(),
      body: {
        resourceType: "Practitioner",
        firstName: "Fake",
        lastName: "Invitee",
        email: "test-invitee@example.invalid",
        sendEmail: false,
        password: "fake-test-password",
        upsert: false,
      },
    }]);
    expect(calls.filter(({ path, method }) => path === "/fhir/R4/PractitionerRole" && method === "POST")
      .map(({ body }) => body)).toEqual([role]);
    const membershipPath = `/fhir/R4/ProjectMembership/${membershipId}`;
    expect(calls.filter(({ path, method }) => path === membershipPath && method === "PUT")
      .map(({ body }) => body)).toEqual([{
      ...membership,
      access: [{
        policy: { reference: `AccessPolicy/${policyId}` },
        parameter: [
          { name: "clinicAccount", valueReference: { reference: accountRef } },
          { name: "clinicOrganization", valueReference: { reference: clinicRef } },
          { name: "clinicWriteAccounts", valueString: `^(${accountRef})$` },
        ],
      }],
    }]);
    expect(calls.find(({ path }) => path.endsWith("/$set-accounts"))?.body).toEqual({
      resourceType: "Parameters",
      parameter: [
        { name: "accounts", valueReference: { reference: accountRef } },
        { name: "propagate", valueBoolean: false },
      ],
    });
  });

  test("rejects duplicate email addresses before calling the invite proxy rule", async () => {
    hasDuplicate = true;
    const response = await invite.POST(request("POST", invitePath, adminToken, invitation));

    expect(response.status).toBe(409);
    expect(calls.find(({ path }) => path === "/fhir/R4/Practitioner")?.query.get("telecom"))
      .toBe("test-invitee@example.invalid");
    expect(calls.every(({ method }) => method === "GET")).toBe(true);
  });
});
