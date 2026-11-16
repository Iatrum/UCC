import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { NextRequest } from "next/server";
import { OperationOutcomeError, notFound } from "@medplum/core";
import { createHash } from "node:crypto";

// Fake data only. Task 357 (X-ray phase 3): PACS ingress matched by AccessionNumber inside ONE clinic,
// unmatched studies filed for review (never auto-attached), viewer link clinic-scoped (foreign 403).
const HASH_SYSTEM = "https://ucc.emr/device/api-key-sha256";
const XRAY = "https://ucc.emr/xray";
const ACC = "https://ucc.emr/xray/accession";
const UID_SYS = "urn:dicom:uid";
const KEY_A = "ucc_dk_fake-pacs-clinic-a";
const KEY_B = "ucc_dk_fake-pacs-clinic-b";
const SECRET = "fake-viewer-secret-fake-viewer-secret-0001";
const VIEWER = "http://viewer.fake.test:3320";
const hash = (k: string) => createHash("sha256").update(k).digest("hex");
const uid = (n: number) => `1.2.826.0.1.3680043.8.498.${n}`;
const oid = (n: number) => `${String(n).padStart(8, "0")}-aaaaaaaa-bbbbbbbb-cccccccc-dddddddd`;

let db: any[] = [];
let seq = 0;
const matches = (r: any, key: string, value: string): boolean => {
  if (key === "_count" || key === "_sort") return true;
  if (key === "_id") return value.split(",").includes(r.id);
  if (key === "identifier") { const [s, v] = value.split("|"); return (r.identifier ?? []).some((i: any) => i.system === s && i.value === v); }
  if (key === "_tag") { const [s, c] = value.split("|"); return (r.meta?.tag ?? []).some((t: any) => t.system === s && t.code === c); }
  if (key === "status") return value.split(",").includes(r.status);
  if (key === "code") { const [s, c] = value.split("|"); return (r.code?.coding ?? []).some((x: any) => x.system === s && x.code === c); }
  return true;
};
const fake: any = {
  async searchResources(type: string, query: any) {
    const pairs: [string, string][] = query instanceof URLSearchParams ? [...query.entries()] : Object.entries(query ?? {}) as [string, string][];
    return db.filter((r) => r.resourceType === type && pairs.every(([k, v]) => matches(r, k, String(v))));
  },
  async searchOne(type: string, query: any) { return (await this.searchResources(type, query))[0]; },
  async readResource(type: string, id: string) {
    const r = db.find((x) => x.resourceType === type && x.id === id);
    if (!r) throw new OperationOutcomeError(notFound);
    return r;
  },
  async createResource(r: any) { const saved = { ...r, id: `${r.resourceType.toLowerCase()}-${++seq}` }; db.push(saved); return saved; },
  async updateResource(r: any) { db = db.map((x) => (x.resourceType === r.resourceType && x.id === r.id ? r : x)); return r; },
  async post() { return {}; },
};

const clinic = (c: string) => ({ system: "clinic", value: c });
const order = (id: string, c: string, accession: string | undefined, over: Record<string, unknown> = {}) => ({
  resourceType: "ServiceRequest", id, status: "active", intent: "order", subject: { reference: `Patient/p-${c}` },
  identifier: [clinic(c), ...(accession ? [{ system: ACC, value: accession }] : [])],
  meta: { tag: [{ system: XRAY, code: "xray" }] }, code: { text: "Chest X-ray (PA)" }, ...over,
});
const device = (id: string, c: string, key: string) => ({
  resourceType: "Device", id, status: "active", identifier: [clinic(c), { system: HASH_SYSTEM, value: hash(key) }],
  type: { coding: [{ system: "https://ucc.emr/xray/device-type", code: "xray" }] },
});
const seed = () => {
  seq = 0;
  db = [
    device("dev-a", "clinic-a", KEY_A), device("dev-b", "clinic-b", KEY_B),
    ...["clinic-a", "clinic-b"].flatMap((c) => [
      { resourceType: "Organization", id: `org-${c}`, identifier: [clinic(c)] },
      { resourceType: "HealthcareService", id: `hs-${c}`, identifier: [clinic(c)] },
      { resourceType: "Patient", id: `p-${c}`, identifier: [clinic(c)], name: [{ text: `Fake Patient ${c}` }] },
    ]),
    order("sr-a1", "clinic-a", "UXAAAA2222"),
    order("sr-b1", "clinic-b", "UXBBBB3333"),
    order("sr-a-done", "clinic-a", "UXDONE4444", { status: "completed" }),
    order("sr-a-revoked", "clinic-a", "UXREVK5555", { status: "revoked" }),
    order("sr-a-dup1", "clinic-a", "UXDUPE6666"), order("sr-a-dup2", "clinic-a", "UXDUPE6666"),
    order("sr-a-plain", "clinic-a", "UXPLAIN777", { meta: undefined }), // not an X-ray device order
    order("sr-a-open2", "clinic-a", "UXOPEN8888"),
  ];
};

// Orthanc is faked at the fetch layer: study n has accession ORTHANC[n].
const ORTHANC: Record<number, { accession?: string; images?: number }> = {};
const realFetch = globalThis.fetch;
const archiveReads: string[] = [];
const dicomwebCalls: { url: string; headers: Record<string, string> }[] = [];
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(input);
  if (!url.startsWith("http://orthanc.fake.test")) return realFetch(input, init);
  if (new Headers(init?.headers).get("authorization") !== `Basic ${Buffer.from("fakeuser:fakepass").toString("base64")}`) return new Response("", { status: 401 });
  const path = url.slice("http://orthanc.fake.test".length);
  archiveReads.push(path);
  const m = path.match(/^\/studies\/(\d{8})-[a-f-]+(\/series)?$/);
  if (m) {
    const n = Number(m[1]); const s = ORTHANC[n];
    if (!s) return new Response("", { status: 404 });
    if (m[2]) return Response.json([{ MainDicomTags: { SeriesInstanceUID: `${uid(n)}.1`, SeriesNumber: "1", Modality: "DX", BodyPartExamined: "CHEST" }, Instances: Array.from({ length: s.images ?? 1 }, (_, i) => `i${i}`) }]);
    return Response.json({ MainDicomTags: { StudyInstanceUID: uid(n), AccessionNumber: s.accession ?? "", StudyDescription: "SYNTHETIC TEST X-RAY", StudyDate: "20261116", StudyTime: "101500" }, PatientMainDicomTags: { PatientID: "FAKE-SYNTH-0001", PatientName: "FAKE^SYNTHETIC" } });
  }
  if (path.startsWith("/dicom-web/")) {
    dicomwebCalls.push({ url: path, headers: Object.fromEntries(new Headers(init?.headers).entries()) });
    return new Response("[]", { status: 200, headers: { "content-type": "application/dicom+json", "set-cookie": "orthanc=1", "x-upstream": "leak" } });
  }
  return new Response("", { status: 404 });
}) as typeof fetch;

const ENV = { PACS_ORTHANC_URL: "http://orthanc.fake.test", PACS_ORTHANC_USER: "fakeuser", PACS_ORTHANC_PASSWORD: "fakepass", PACS_VIEWER_ORIGIN: VIEWER, PACS_VIEWER_SECRET: SECRET };
const savedEnv: Record<string, string | undefined> = {};
for (const [k, v] of Object.entries({ ...ENV, PACS_ORTHANC_CLINICS: undefined })) { savedEnv[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; }

let pacsEnabled = true;
let sessionClinic = "clinic-a";
let signedIn = true;
const registry = await import("@/lib/module-registry");
const realAdmin = await import("@/lib/server/medplum-admin");
const realAuth = await import("@/lib/server/medplum-auth");
const { AuthError } = await import("@/lib/server/route-helpers");
mock.module("@/lib/server/medplum-admin", () => ({ ...realAdmin, getAdminMedplum: async () => fake }));
mock.module("@/lib/module-registry", () => ({ ...registry, isModuleEnabledForClinic: async () => pacsEnabled }));
mock.module("@/lib/server/medplum-auth", () => ({
  ...realAuth,
  getCurrentProfile: async () => { if (!signedIn) throw new AuthError("Not authenticated"); return { resourceType: "Practitioner", id: "fake-staff" }; },
  requireClinicAuth: async () => { if (!signedIn) throw new AuthError("Not authenticated"); return { medplum: fake, clinicId: sessionClinic }; },
}));

const ingress = (await import("../../app/api/pacs/orthanc/study/route")).POST;
const link = (await import("../../app/api/pacs/viewer/link/route")).POST;
const launch = (await import("../../app/api/pacs/viewer/launch/route")).GET;
const dicomweb = (await import("../../app/api/pacs/dicomweb/[...path]/route")).GET;
const unmatched = await import("../../app/api/pacs/unmatched/route");

const post = (handler: (r: NextRequest) => Promise<Response>, path: string, body: unknown, headers: Record<string, string> = {}) =>
  handler(new NextRequest(`http://localhost${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }));
// ?wait=1 = do the work before answering (resync mode); the default answers 202 and works after the response.
const notify = (n: number, key = KEY_A, wait = true) => post(ingress, `/api/pacs/orthanc/study${wait ? "?wait=1" : ""}`, { orthancStudyId: oid(n) }, { authorization: `Bearer ${key}` });
const studies = () => db.filter((r) => r.resourceType === "ImagingStudy");
const tasks = () => db.filter((r) => r.resourceType === "Task");
const viewerHost = { "x-pacs-viewer-host": "viewer.fake.test:3320" };

beforeEach(() => { seed(); pacsEnabled = true; sessionClinic = "clinic-a"; signedIn = true; dicomwebCalls.length = 0; archiveReads.length = 0; for (const k of Object.keys(ORTHANC)) delete ORTHANC[Number(k)]; process.env.PACS_ORTHANC_CLINICS = "clinic-a"; });
afterAll(() => {
  globalThis.fetch = realFetch;
  for (const [k, v] of Object.entries(savedEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  mock.module("@/lib/server/medplum-admin", () => realAdmin);
  mock.module("@/lib/module-registry", () => registry);
  mock.module("@/lib/server/medplum-auth", () => realAuth);
});

describe("POST /api/pacs/orthanc/study (PACS ingress)", () => {
  test("fails closed: no key, unknown key, disabled module, clinic not served by this PACS", async () => {
    ORTHANC[1] = { accession: "UXAAAA2222" };
    expect((await post(ingress, "/api/pacs/orthanc/study", { orthancStudyId: oid(1) })).status).toBe(401);
    expect((await notify(1, "ucc_dk_fake-unknown")).status).toBe(401);
    pacsEnabled = false;
    expect((await notify(1)).status).toBe(403);
    pacsEnabled = true;
    process.env.PACS_ORTHANC_CLINICS = "clinic-b";
    expect((await notify(1)).status).toBe(403);
    expect(studies()).toHaveLength(0);
    expect(tasks()).toHaveLength(0);
  });

  test("bad pointer is 400, unknown Orthanc study is 404, unconfigured PACS is 503", async () => {
    expect((await post(ingress, "/api/pacs/orthanc/study", { orthancStudyId: "../system" }, { authorization: `Bearer ${KEY_A}` })).status).toBe(400);
    expect((await notify(99)).status).toBe(404);
    const secret = process.env.PACS_VIEWER_SECRET; delete process.env.PACS_VIEWER_SECRET;
    try { expect((await notify(99)).status).toBe(503); } finally { process.env.PACS_VIEWER_SECRET = secret; }
  });

  test("matching accession in the device clinic creates one ImagingStudy and completes the order", async () => {
    ORTHANC[1] = { accession: "uxaaaa2222 ", images: 2 }; // modality typed it lower-case with a space
    const r = await notify(1);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body).toMatchObject({ outcome: "matched", serviceRequestId: "sr-a1", created: true });
    const [study] = studies();
    expect(study.id).toBe(body.imagingStudyId);
    expect(study.identifier).toContainEqual({ system: "clinic", value: "clinic-a" });
    expect(study.identifier).toContainEqual({ system: UID_SYS, value: `urn:oid:${uid(1)}` });
    expect(study.basedOn).toEqual([{ reference: "ServiceRequest/sr-a1" }]);
    expect(study.subject).toEqual({ reference: "Patient/p-clinic-a" });
    expect(study.numberOfInstances).toBe(2);
    expect(study.meta.tag).toContainEqual({ system: "https://ucc.emr/pacs", code: "orthanc" });
    expect(study.extension).toBeUndefined(); // no device-supplied viewer URL
    expect(db.find((x) => x.id === "sr-a1").status).toBe("completed");
    expect(tasks()).toHaveLength(0);
  });

  test("default (webhook) mode answers 202 without the outcome and still ingests", async () => {
    ORTHANC[1] = { accession: "UXAAAA2222" };
    const r = await notify(1, KEY_A, false);
    expect(r.status).toBe(202);
    expect(await r.json()).toEqual({ accepted: true });
    expect(studies()).toHaveLength(1);
    // A pointer to a study that is gone is accepted and dropped, nothing is created.
    expect((await notify(99, KEY_A, false)).status).toBe(202);
    expect(studies()).toHaveLength(1);
    expect(tasks()).toHaveLength(0);
  });

  test("re-notification updates the same ImagingStudy (more images), never a duplicate", async () => {
    ORTHANC[1] = { accession: "UXAAAA2222", images: 1 };
    const first = await (await notify(1)).json();
    ORTHANC[1].images = 3;
    const second = await (await notify(1)).json();
    expect(second).toMatchObject({ outcome: "matched", imagingStudyId: first.imagingStudyId, created: false });
    expect(studies()).toHaveLength(1);
    expect(studies()[0].numberOfInstances).toBe(3);
  });

  test("unmatched studies go to the device clinic's review list and are never attached", async () => {
    const cases: [number, string | undefined, string][] = [
      [2, undefined, "no-accession"], [3, "UXNOSUCH99", "no-order"], [4, "UXDUPE6666", "ambiguous"],
      [5, "UXDONE4444", "order-has-study"], [6, "UXREVK5555", "order-closed"], [7, "UXPLAIN777", "no-order"],
      [8, "UXBBBB3333", "no-order"], // the accession exists, but on ANOTHER clinic's order
    ];
    for (const [n, accession, reason] of cases) {
      ORTHANC[n] = { accession };
      const body = await (await notify(n)).json();
      expect(body).toMatchObject({ outcome: "unmatched", reason });
    }
    expect(studies()).toHaveLength(0);
    expect(db.find((x) => x.id === "sr-b1").status).toBe("active");
    expect(tasks()).toHaveLength(cases.length);
    expect(tasks().every((t) => t.status === "requested" && t.identifier.some((i: any) => i.system === "clinic" && i.value === "clinic-a"))).toBe(true);
    // Idempotent: the same study notified again does not add a second entry.
    await notify(3);
    expect(tasks()).toHaveLength(cases.length);
  });

  test("foreign Device cannot read the archive even with its own matching accession", async () => {
    ORTHANC[8] = { accession: "UXBBBB3333" };
    expect((await notify(8, KEY_B)).status).toBe(403);
    expect(archiveReads).toHaveLength(0);
    expect(studies()).toHaveLength(0);
    expect(tasks()).toHaveLength(0);
  });

  test("a study in review is never auto-attached when an order appears later", async () => {
    ORTHANC[3] = { accession: "UXLATE9999" };
    const first = await (await notify(3)).json();
    expect(first).toMatchObject({ outcome: "unmatched", reason: "no-order" });
    db.push(order("sr-late", "clinic-a", "UXLATE9999"));
    expect(await (await notify(3)).json()).toMatchObject({ outcome: "unmatched", reviewId: first.reviewId });
    expect(studies()).toHaveLength(0);
    expect(db.find((x) => x.id === "sr-late").status).toBe("active");
    const dismissed = await post(unmatched.POST, "/api/pacs/unmatched", { id: first.reviewId, action: "dismiss" });
    expect(dismissed.status).toBe(200);
    expect(await (await notify(3)).json()).toMatchObject({ outcome: "unmatched", reviewId: first.reviewId });
    expect(studies()).toHaveLength(0);
    expect(tasks()[0].status).toBe("rejected");
  });

  test("clinic B can ingest only when the archive is explicitly bound to clinic B", async () => {
    process.env.PACS_ORTHANC_CLINICS = "clinic-b";
    ORTHANC[8] = { accession: "UXBBBB3333" };
    const body = await (await notify(8, KEY_B)).json();
    expect(body).toMatchObject({ outcome: "matched", serviceRequestId: "sr-b1" });
    expect(studies()[0].identifier).toContainEqual({ system: "clinic", value: "clinic-b" });
  });
});

describe("review list /api/pacs/unmatched", () => {
  const list = async () => (await unmatched.GET(new NextRequest("http://localhost/api/pacs/unmatched"))).json();
  const act = (body: unknown) => post(unmatched.POST, "/api/pacs/unmatched", body);

  test("requires a session and the module; lists only the caller's clinic", async () => {
    ORTHANC[3] = { accession: "UXNOSUCH99" };
    await notify(3);
    signedIn = false;
    expect((await unmatched.GET(new NextRequest("http://localhost/api/pacs/unmatched"))).status).toBe(401);
    signedIn = true; pacsEnabled = false;
    expect((await unmatched.GET(new NextRequest("http://localhost/api/pacs/unmatched"))).status).toBe(403);
    pacsEnabled = true;
    const mine = await list();
    expect(mine.studies).toHaveLength(1);
    expect(mine.studies[0]).toMatchObject({ studyUid: uid(3), accessionNumber: "UXNOSUCH99", reason: "no-order", dicomPatientId: "FAKE-SYNTH-0001" });
    expect(mine.orders.map((o: any) => o.id)).toContain("sr-a1");
    expect(mine.orders.some((o: any) => o.id === "sr-b1")).toBe(false);
    sessionClinic = "clinic-b";
    expect((await list()).studies).toHaveLength(0);
  });

  test("another clinic cannot attach or dismiss the entry; attach refuses a foreign or closed order", async () => {
    ORTHANC[3] = { accession: "UXNOSUCH99" };
    const { reviewId } = await (await notify(3)).json();
    sessionClinic = "clinic-b";
    expect((await act({ id: reviewId, action: "dismiss" })).status).toBe(404);
    expect((await act({ id: reviewId, action: "attach", serviceRequestId: "sr-b1" })).status).toBe(404);
    sessionClinic = "clinic-a";
    expect((await act({ id: reviewId, action: "attach", serviceRequestId: "sr-b1" })).status).toBe(403);
    expect((await act({ id: reviewId, action: "attach", serviceRequestId: "sr-a-done" })).status).toBe(409);
    expect((await act({ id: reviewId, action: "attach", serviceRequestId: "sr-a-plain" })).status).toBe(409);
    expect((await act({ id: reviewId, action: "bogus" })).status).toBe(400);
    expect(studies()).toHaveLength(0);
    expect(tasks()[0].status).toBe("requested");
  });

  test("staff attachment refuses an archive bound to another clinic before reading pixels", async () => {
    ORTHANC[3] = { accession: "UXNOSUCH99" };
    const { reviewId } = await (await notify(3)).json();
    archiveReads.length = 0;
    process.env.PACS_ORTHANC_CLINICS = "clinic-b";
    expect((await act({ id: reviewId, action: "attach", serviceRequestId: "sr-a-open2" })).status).toBe(403);
    expect(archiveReads).toHaveLength(0);
    expect(studies()).toHaveLength(0);
  });

  test("staff attach creates the study on the chosen order and closes the entry; dismiss rejects it", async () => {
    ORTHANC[3] = { accession: "UXNOSUCH99" }; ORTHANC[2] = {};
    const a = await (await notify(3)).json();
    const b = await (await notify(2)).json();
    const attached = await act({ id: a.reviewId, action: "attach", serviceRequestId: "sr-a-open2" });
    expect(attached.status).toBe(200);
    expect(studies()).toHaveLength(1);
    expect(studies()[0].basedOn).toEqual([{ reference: "ServiceRequest/sr-a-open2" }]);
    expect(studies()[0].meta.tag).toContainEqual({ system: "https://ucc.emr/pacs", code: "orthanc" });
    expect(db.find((t) => t.id === a.reviewId)).toMatchObject({ status: "completed", owner: { reference: "Practitioner/fake-staff" } });
    expect((await act({ id: a.reviewId, action: "attach", serviceRequestId: "sr-a1" })).status).toBe(409); // already reviewed
    expect((await act({ id: b.reviewId, action: "dismiss" })).status).toBe(200);
    expect(db.find((t) => t.id === b.reviewId).status).toBe("rejected");
    expect((await list()).studies).toHaveLength(0);
    // A dismissed study stays dismissed when Orthanc notifies again.
    await notify(2);
    expect(db.find((t) => t.id === b.reviewId).status).toBe("rejected");
  });
});

describe("viewer link, launch and DICOMweb proxy", () => {
  const ingestA = async () => { ORTHANC[1] = { accession: "UXAAAA2222" }; return (await (await notify(1)).json()).imagingStudyId as string; };
  const mint = (imagingStudyId: unknown) => post(link, "/api/pacs/viewer/link", { imagingStudyId });
  const open = (url: string, headers: Record<string, string> = viewerHost) =>
    launch(new NextRequest(`http://localhost/api/pacs/viewer/launch${new URL(url).search}`, { headers }));
  const proxy = (path: string, cookie?: string, headers: Record<string, string> = viewerHost) =>
    dicomweb(new NextRequest(`http://localhost/api/pacs/dicomweb/${path}`, { headers: { ...headers, ...(cookie ? { cookie } : {}) } }),
      { params: Promise.resolve({ path: path.split("?")[0].split("/") }) });

  test("link: own clinic gets a viewer-origin URL without any Orthanc detail; foreign clinic is 403", async () => {
    const id = await ingestA();
    const ok = await mint(id);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toBe("no-store");
    const { url, expiresIn } = await ok.json();
    expect(url.startsWith(`${VIEWER}/launch?t=`)).toBe(true);
    expect(expiresIn).toBe(60);
    expect(url).not.toContain("orthanc");
    expect(url).not.toContain("fakepass");

    sessionClinic = "clinic-b";
    expect((await mint(id)).status).toBe(403);
    sessionClinic = "clinic-a"; signedIn = false;
    expect((await mint(id)).status).toBe(401);
    signedIn = true; pacsEnabled = false;
    expect((await mint(id)).status).toBe(403);
    pacsEnabled = true;
    expect((await mint("no-such-study")).status).toBe(403);
    expect((await mint("../x")).status).toBe(400);
  });

  test("link: a study that is not held by the PACS (device-reported only) gets no viewer link", async () => {
    db.push({ resourceType: "ImagingStudy", id: "is-legacy", identifier: [clinic("clinic-a"), { system: UID_SYS, value: `urn:oid:${uid(50)}` }], meta: { tag: [{ system: XRAY, code: "xray" }] } });
    expect((await mint("is-legacy")).status).toBe(404);
  });

  test("launch: single use, sets a study-scoped HttpOnly cookie, redirects only to that study", async () => {
    const { url } = await (await mint(await ingestA())).json();
    expect((await open(url, {})).status).toBe(404); // not through the viewer origin
    const first = await open(url);
    expect(first.status).toBe(303);
    expect(first.headers.get("location")).toBe(`/viewer?StudyInstanceUIDs=${uid(1)}`);
    const cookie = first.headers.get("set-cookie")!;
    expect(cookie).toMatch(/^ucc_pacs_viewer_[0-9a-f]{16}=/);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Path=/dicom-web");
    expect(cookie).toContain("Max-Age=900");
    expect((await open(url)).status).toBe(403); // replay
    expect((await open(`${VIEWER}/launch?t=garbage`)).status).toBe(403);
    expect((await open(`${VIEWER}/launch`)).status).toBe(403);
  });

  test("existing viewer tokens stop working when the archive clinic changes", async () => {
    const { url } = await (await mint(await ingestA())).json();
    const cookie = (await open(url)).headers.get("set-cookie")!.split(";")[0];
    const second = await (await mint(studies()[0].id)).json();
    process.env.PACS_ORTHANC_CLINICS = "clinic-b";
    expect((await open(second.url)).status).toBe(403);
    expect((await proxy(`studies/${uid(1)}/metadata`, cookie)).status).toBe(403);
    expect(dicomwebCalls).toHaveLength(0);
  });

  test("proxy: only the session's study, Orthanc credentials added server-side, nothing upstream leaks back", async () => {
    const { url } = await (await mint(await ingestA())).json();
    const cookie = (await open(url)).headers.get("set-cookie")!.split(";")[0];

    expect((await proxy(`studies/${uid(1)}/metadata`)).status).toBe(401); // no cookie
    expect((await proxy(`studies/${uid(1)}/metadata`, `${cookie}x`)).status).toBe(401); // tampered
    expect((await proxy(`studies/${uid(1)}/metadata`, cookie, {})).status).toBe(404); // not via viewer origin
    expect((await proxy(`studies/${uid(8)}/metadata`, cookie)).status).toBe(403); // another study
    expect((await proxy("series", cookie)).status).toBe(403);
    expect((await proxy("patients", cookie)).status).toBe(403);
    expect(dicomwebCalls).toHaveLength(0);

    const ok = await proxy(`studies/${uid(1)}/metadata`, cookie);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("application/dicom+json");
    expect(ok.headers.get("set-cookie")).toBeNull();
    expect(ok.headers.get("x-upstream")).toBeNull();
    expect(ok.headers.get("cache-control")).toBe("private, no-store");
    expect(dicomwebCalls[0].url).toBe(`/dicom-web/studies/${uid(1)}/metadata`);
    expect(dicomwebCalls[0].headers.forwarded).toBe("host=viewer.fake.test:3320;proto=http");
    expect(dicomwebCalls[0].headers.cookie).toBeUndefined();

    await proxy(`studies?StudyInstanceUID=${uid(8)}&PatientName=*`, cookie);
    expect(dicomwebCalls[1].url).toBe(`/dicom-web/studies?StudyInstanceUID=${uid(1)}`);
  });
});
