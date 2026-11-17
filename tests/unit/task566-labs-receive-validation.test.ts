import { describe, expect, it } from "bun:test";
import { validateLabReceiveResults } from "../../lib/fhir/lab-receive-validation";

const good = { testCode: "2339-0", testName: "Glucose", value: 5.6, unit: "mmol/L", status: "final" };

describe("Task 566: validateLabReceiveResults", () => {
  it("accepts a valid result and converts performedAt string to Date", () => {
    const r = validateLabReceiveResults([{ ...good, interpretation: "normal", performedAt: "2026-06-01T08:00:00Z" }]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.results[0].performedAt).toBeInstanceOf(Date);
      expect(r.results[0].status).toBe("final");
    }
  });
  it("rejects missing status with a clear 400 message (was a 500)", () => {
    const { status, ...noStatus } = good;
    const r = validateLabReceiveResults([noStatus]);
    expect(r).toEqual({ ok: false, error: expect.stringContaining("results[0].status is required") });
  });
  it("rejects invalid status / interpretation", () => {
    expect(validateLabReceiveResults([{ ...good, status: "done" }]).ok).toBe(false);
    expect(validateLabReceiveResults([{ ...good, interpretation: "weird" }]).ok).toBe(false);
  });
  it("rejects empty / non-array results", () => {
    expect(validateLabReceiveResults([]).ok).toBe(false);
    expect(validateLabReceiveResults(undefined).ok).toBe(false);
    expect(validateLabReceiveResults("x").ok).toBe(false);
  });
  it("rejects bad entries, missing code/name, bad value types", () => {
    expect(validateLabReceiveResults([null]).ok).toBe(false);
    expect(validateLabReceiveResults([{ ...good, testCode: " " }]).ok).toBe(false);
    expect(validateLabReceiveResults([{ ...good, testName: undefined }]).ok).toBe(false);
    expect(validateLabReceiveResults([{ ...good, value: undefined }]).ok).toBe(false);
    expect(validateLabReceiveResults([{ ...good, value: NaN }]).ok).toBe(false);
    expect(validateLabReceiveResults([{ ...good, value: {} }]).ok).toBe(false);
    expect(validateLabReceiveResults([{ ...good, value: "" }]).ok).toBe(false);
  });
  it("accepts value 0 and string values", () => {
    expect(validateLabReceiveResults([{ ...good, value: 0 }]).ok).toBe(true);
    expect(validateLabReceiveResults([{ ...good, value: "Negative" }]).ok).toBe(true);
  });
  it("rejects invalid performedAt and non-string unit", () => {
    expect(validateLabReceiveResults([{ ...good, performedAt: "not-a-date" }]).ok).toBe(false);
    expect(validateLabReceiveResults([{ ...good, performedAt: 123 }]).ok).toBe(false);
    expect(validateLabReceiveResults([{ ...good, unit: 5 }]).ok).toBe(false);
  });
  it("reports the index of the failing entry", () => {
    const r = validateLabReceiveResults([good, { ...good, status: undefined }]);
    expect(r.ok === false && r.error).toContain("results[1]");
  });
});
