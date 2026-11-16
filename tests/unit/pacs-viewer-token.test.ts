import { describe, expect, test } from "bun:test";
import {
  LAUNCH_TTL_SECONDS, SESSION_TTL_SECONDS, consumeLaunchToken, isDicomUid, mintViewerToken, readViewerSessions,
  scopeDicomwebRequest, verifyViewerToken, viewerCookieName,
} from "@/lib/pacs/viewer-token";
import { generateAccessionNumber, normalizeAccessionNumber, readAccessionNumber, readStudyUid } from "@/lib/pacs/accession";
import { getPacsConfig, isOrthancId, mapOrthancStudy, parseDicomDateTime, pacsServesClinic } from "@/lib/pacs/orthanc-client";

// Fake data only. Task 357: viewer tokens are bound to one clinic + one study and are short-lived.
const SECRET = "fake-viewer-secret-fake-viewer-secret-0001";
const OTHER = "another-fake-secret-another-fake-secret-02";
const UID_A = "1.2.826.0.1.3680043.8.498.111";
const UID_B = "1.2.826.0.1.3680043.8.498.222";
const NOW = 1_800_000_000_000;

describe("viewer tokens", () => {
  test("round-trips claims and expires on time", () => {
    const launch = mintViewerToken({ kind: "launch", clinicId: "clinic-a", studyUid: UID_A }, SECRET, NOW);
    const claims = verifyViewerToken(launch, "launch", SECRET, NOW + 1000);
    expect(claims).toMatchObject({ kind: "launch", clinicId: "clinic-a", studyUid: UID_A });
    expect(verifyViewerToken(launch, "launch", SECRET, NOW + LAUNCH_TTL_SECONDS * 1000)).toBeUndefined();
    const session = mintViewerToken({ kind: "session", clinicId: "clinic-a", studyUid: UID_A }, SECRET, NOW);
    expect(verifyViewerToken(session, "session", SECRET, NOW + (SESSION_TTL_SECONDS - 1) * 1000)).toBeDefined();
    expect(verifyViewerToken(session, "session", SECRET, NOW + SESSION_TTL_SECONDS * 1000)).toBeUndefined();
  });

  test("a launch token is not a session token and vice versa; wrong secret and tampering are refused", () => {
    const launch = mintViewerToken({ kind: "launch", clinicId: "clinic-a", studyUid: UID_A }, SECRET, NOW);
    const session = mintViewerToken({ kind: "session", clinicId: "clinic-a", studyUid: UID_A }, SECRET, NOW);
    expect(verifyViewerToken(launch, "session", SECRET, NOW)).toBeUndefined();
    expect(verifyViewerToken(session, "launch", SECRET, NOW)).toBeUndefined();
    expect(verifyViewerToken(session, "session", OTHER, NOW)).toBeUndefined();
    // Re-point the payload at another study/clinic while keeping the signature.
    const forged = Buffer.from(JSON.stringify({ kind: "session", clinicId: "clinic-b", studyUid: UID_B, exp: NOW / 1000 + 600, jti: "x" })).toString("base64url");
    expect(verifyViewerToken(`${forged}.${session.split(".")[1]}`, "session", SECRET, NOW)).toBeUndefined();
    for (const bad of [undefined, null, 42, "", "a", "a.b.c", `${session}x`, "x".repeat(2000)]) {
      expect(verifyViewerToken(bad, "session", SECRET, NOW)).toBeUndefined();
    }
    expect(verifyViewerToken(session, "session", "short", NOW)).toBeUndefined();
  });

  test("minting refuses a weak secret, a missing clinic or a non-UID study", () => {
    expect(() => mintViewerToken({ kind: "launch", clinicId: "clinic-a", studyUid: UID_A }, "short")).toThrow();
    expect(() => mintViewerToken({ kind: "launch", clinicId: "", studyUid: UID_A }, SECRET)).toThrow();
    expect(() => mintViewerToken({ kind: "launch", clinicId: "clinic-a", studyUid: "../etc" }, SECRET)).toThrow();
    expect(isDicomUid("1.2.3")).toBe(true);
    expect(isDicomUid("1.2.3/..")).toBe(false);
    expect(isDicomUid("1".repeat(65))).toBe(false);
  });

  test("launch tokens are single-use", () => {
    const claims = verifyViewerToken(mintViewerToken({ kind: "launch", clinicId: "clinic-a", studyUid: UID_A }, SECRET), "launch", SECRET)!;
    expect(consumeLaunchToken(claims)).toBe(true);
    expect(consumeLaunchToken(claims)).toBe(false);
  });

  test("session cookies: one per study, read back only when valid and under their own name", () => {
    const a = mintViewerToken({ kind: "session", clinicId: "clinic-a", studyUid: UID_A }, SECRET, NOW);
    const b = mintViewerToken({ kind: "session", clinicId: "clinic-a", studyUid: UID_B }, SECRET, NOW);
    const launch = mintViewerToken({ kind: "launch", clinicId: "clinic-a", studyUid: UID_A }, SECRET, NOW);
    expect(viewerCookieName(UID_A)).not.toBe(viewerCookieName(UID_B));
    const header = `other=1; ${viewerCookieName(UID_A)}=${a}; ${viewerCookieName(UID_B)}=${b}`;
    expect(readViewerSessions(header, SECRET, NOW).map((c) => c.studyUid)).toEqual([UID_A, UID_B]);
    expect(readViewerSessions(header, OTHER, NOW)).toEqual([]);
    expect(readViewerSessions(header, SECRET, NOW + SESSION_TTL_SECONDS * 1000)).toEqual([]);
    // A token for study A parked under study B's cookie name, a launch token, and no header at all.
    expect(readViewerSessions(`${viewerCookieName(UID_B)}=${a}`, SECRET, NOW)).toEqual([]);
    expect(readViewerSessions(`${viewerCookieName(UID_A)}=${launch}`, SECRET, NOW)).toEqual([]);
    expect(readViewerSessions(null, SECRET, NOW)).toEqual([]);
  });
});

describe("DICOMweb scoping", () => {
  const q = (s = "") => new URLSearchParams(s);
  test("study search is forced to the session's study, whatever the caller asks for", () => {
    expect(scopeDicomwebRequest(["studies"], q(`StudyInstanceUID=${UID_B}&PatientID=*&limit=5`), UID_A))
      .toBe(`studies?limit=5&StudyInstanceUID=${UID_A}`);
    expect(scopeDicomwebRequest(["studies"], q(), UID_A)).toBe(`studies?StudyInstanceUID=${UID_A}`);
  });
  test("paths inside the study pass; another study, other roots and traversal are refused", () => {
    expect(scopeDicomwebRequest(["studies", UID_A, "metadata"], q(), UID_A)).toBe(`studies/${UID_A}/metadata`);
    expect(scopeDicomwebRequest(["studies", UID_A, "series", "1.2.3", "instances", "1.2.4", "frames", "1"], q("accept=x"), UID_A))
      .toBe(`studies/${UID_A}/series/1.2.3/instances/1.2.4/frames/1?accept=x`);
    expect(scopeDicomwebRequest(["studies", UID_B, "metadata"], q(), UID_A)).toBeUndefined();
    expect(scopeDicomwebRequest(["series"], q(), UID_A)).toBeUndefined();
    expect(scopeDicomwebRequest(["instances"], q(), UID_A)).toBeUndefined();
    expect(scopeDicomwebRequest(["patients"], q(), UID_A)).toBeUndefined();
    expect(scopeDicomwebRequest([], q(), UID_A)).toBeUndefined();
    expect(scopeDicomwebRequest(["studies", UID_A, "..", UID_B], q(), UID_A)).toBeUndefined();
    expect(scopeDicomwebRequest(["studies", `${UID_A}/../${UID_B}`], q(), UID_A)).toBeUndefined();
    expect(scopeDicomwebRequest(["studies", UID_A, "a b"], q(), UID_A)).toBeUndefined();
    expect(scopeDicomwebRequest(["studies", UID_A], q(), "not-a-uid")).toBeUndefined();
  });
});

describe("accession numbers", () => {
  test("generated numbers fit DICOM SH (<= 16 chars), avoid look-alike characters and differ", () => {
    const seen = new Set(Array.from({ length: 200 }, generateAccessionNumber));
    expect(seen.size).toBe(200);
    for (const acc of seen) {
      expect(acc).toMatch(/^UX[2-9A-HJKMNP-Z]{12}$/);
      expect(normalizeAccessionNumber(acc)).toBe(acc);
    }
  });
  test("normalisation trims and upper-cases; junk is not an accession number", () => {
    expect(normalizeAccessionNumber("  ux12ab  ")).toBe("UX12AB");
    for (const bad of ["", "   ", "A".repeat(17), "A B", "A|B", "*", "-A", undefined, 7]) expect(normalizeAccessionNumber(bad)).toBeUndefined();
  });
  test("identifier readers", () => {
    const r = { identifier: [{ system: "clinic", value: "c" }, { system: "https://ucc.emr/xray/accession", value: "UXAB" }, { system: "urn:dicom:uid", value: "urn:oid:1.2.3" }] };
    expect(readAccessionNumber(r)).toBe("UXAB");
    expect(readStudyUid(r)).toBe("1.2.3");
    expect(readStudyUid({ identifier: [{ system: "urn:dicom:uid", value: "1.2.3" }] })).toBeUndefined();
  });
});

describe("Orthanc client helpers", () => {
  const env = {
    PACS_ORTHANC_URL: "http://127.0.0.1:8042", PACS_ORTHANC_USER: "fake", PACS_ORTHANC_PASSWORD: "fake-password",
    PACS_VIEWER_ORIGIN: "https://viewer.fake-clinic.org", PACS_VIEWER_SECRET: SECRET,
  };
  test("config is all-or-nothing", () => {
    const config = getPacsConfig(env)!;
    expect(config).toMatchObject({ orthancUrl: "http://127.0.0.1:8042", viewerOrigin: "https://viewer.fake-clinic.org", viewerHost: "viewer.fake-clinic.org", viewerSecure: true, clinics: [] });
    for (const key of Object.keys(env)) expect(getPacsConfig({ ...env, [key]: undefined })).toBeUndefined();
    expect(getPacsConfig({ ...env, PACS_VIEWER_SECRET: "short" })).toBeUndefined();
    expect(getPacsConfig({ ...env, PACS_ORTHANC_URL: "http://user:pw@127.0.0.1:8042" })).toBeUndefined();
    expect(getPacsConfig({ ...env, PACS_VIEWER_ORIGIN: "javascript:alert(1)" })).toBeUndefined();
    expect(pacsServesClinic(config, "any")).toBe(true);
    const scoped = getPacsConfig({ ...env, PACS_ORTHANC_CLINICS: "clinic-a, clinic-c" })!;
    expect(pacsServesClinic(scoped, "clinic-a")).toBe(true);
    expect(pacsServesClinic(scoped, "clinic-b")).toBe(false);
  });
  test("ids, dates and study mapping", () => {
    expect(isOrthancId("0038839a-c9916cee-ea6e269b-03390ee8-5fecd176")).toBe(true);
    expect(isOrthancId("../system")).toBe(false);
    expect(parseDicomDateTime("20261116", "093015.123")?.getFullYear()).toBe(2026);
    expect(parseDicomDateTime("2026-11-16", "")).toBeUndefined();
    const id = "0038839a-c9916cee-ea6e269b-03390ee8-5fecd176";
    const study = mapOrthancStudy(id, {
      MainDicomTags: { StudyInstanceUID: UID_A, AccessionNumber: " UXAB ", StudyDescription: "SYNTHETIC", StudyDate: "20261116", StudyTime: "101500" },
      PatientMainDicomTags: { PatientID: "FAKE-1", PatientName: "FAKE^SYNTHETIC" },
    }, [
      { MainDicomTags: { SeriesInstanceUID: "1.2.3.1", SeriesNumber: "1", Modality: "dx", BodyPartExamined: "CHEST" }, Instances: ["a", "b"] },
      { MainDicomTags: { SeriesInstanceUID: "not a uid" }, Instances: ["c"] },
    ])!;
    expect(study).toMatchObject({ orthancStudyId: id, studyUid: UID_A, accessionNumber: "UXAB", modality: "DX", numberOfInstances: 2, dicomPatientId: "FAKE-1" });
    expect(study.series).toHaveLength(1);
    expect(mapOrthancStudy(id, { MainDicomTags: { StudyInstanceUID: "bad uid" } }, [])).toBeUndefined();
  });
});
