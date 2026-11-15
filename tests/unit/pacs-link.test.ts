import { describe, expect, test } from "bun:test";
import type { ImagingStudy } from "@medplum/fhirtypes";
import {
  PACS_VIEWER_URL_EXTENSION,
  gateXrayStudies,
  isXrayStudy,
  pacsViewerUrlExtension,
  readPacsViewerUrl,
  sanitizePacsViewerUrl,
} from "../../lib/fhir/pacs-link";

describe("PACS viewer link (fake metadata only)", () => {
  test("accepts plain http(s) URLs", () => {
    expect(sanitizePacsViewerUrl("https://pacs.example.test/viewer?studyUid=1.2.3")).toBe("https://pacs.example.test/viewer?studyUid=1.2.3");
    expect(sanitizePacsViewerUrl("http://pacs.example.test/v")).toBe("http://pacs.example.test/v");
  });

  test("rejects dangerous, credentialed, malformed or oversized URLs", () => {
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "file:///etc/passwd", "https://user:pw@pacs.example.test/", "not a url", "", "  ", 42, undefined, null, "https://a.test/" + "x".repeat(2100)]) {
      expect(sanitizePacsViewerUrl(bad)).toBeUndefined();
    }
  });

  test("extension round-trips and unsafe stored values are ignored on read", () => {
    const ext = pacsViewerUrlExtension("https://pacs.example.test/v");
    const study: ImagingStudy = { resourceType: "ImagingStudy", status: "available", subject: { reference: "Patient/x" }, extension: ext };
    expect(readPacsViewerUrl(study)).toBe("https://pacs.example.test/v");
    expect(pacsViewerUrlExtension("javascript:alert(1)")).toBeUndefined();
    expect(readPacsViewerUrl({ ...study, extension: [{ url: PACS_VIEWER_URL_EXTENSION, valueUrl: "javascript:alert(1)" }] })).toBeUndefined();
  });

  test("X-ray tag detection and clinic toggle gate", () => {
    const tagged: ImagingStudy = { resourceType: "ImagingStudy", status: "available", subject: { reference: "Patient/x" }, meta: { tag: [{ system: "https://ucc.emr/xray", code: "xray" }] } };
    expect(isXrayStudy(tagged)).toBe(true);
    expect(isXrayStudy({ ...tagged, meta: undefined })).toBe(false);
    const rows = [{ id: "a", xray: true }, { id: "b" }];
    expect(gateXrayStudies(rows, false).map((r) => r.id)).toEqual(["b"]);
    expect(gateXrayStudies(rows, true)).toHaveLength(2);
  });
});
