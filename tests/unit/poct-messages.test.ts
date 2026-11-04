import { describe, expect, test } from "bun:test";
import { buildOruMessage, parseOruMessage, labResultsToOru, oruToLabResults } from "../../lib/poct/hl7";
import { buildAstmResult, parseAstmResult, labResultsToAstm, astmToLabResults } from "../../lib/poct/astm";
import type { LabResult } from "../../lib/fhir/lab-constants";

const SR_ID = "sr-glucose-123";
const PRODUCED_AT = new Date("2026-11-04T10:30:00Z");

const SAMPLE_RESULTS: LabResult[] = [
  { testCode: "14743-9", testName: "Glucose (capillary)", value: 5.4, unit: "mmol/L", referenceRange: "To confirm per analyser", interpretation: "normal", status: "final" },
  { testCode: "1988-5", testName: "CRP", value: 42, unit: "mg/L", referenceRange: "To confirm per analyser", interpretation: "critical", status: "final" },
];

describe("HL7 ORU^R01 round trip", () => {
  test("build then parse reproduces placer order number and results", () => {
    const oruResults = labResultsToOru(SAMPLE_RESULTS);
    const raw = buildOruMessage({ placerOrderNumber: SR_ID, messageControlId: "MSG-1", producedAt: PRODUCED_AT, results: oruResults });

    expect(raw).toContain("MSH|");
    expect(raw).toContain("OBR|1|" + SR_ID);
    expect(raw.split("\r").filter(Boolean)).toHaveLength(2 + SAMPLE_RESULTS.length); // MSH + OBR + one OBX per result

    const parsed = parseOruMessage(raw);
    expect(parsed.placerOrderNumber).toBe(SR_ID);
    expect(parsed.messageControlId).toBe("MSG-1");
    expect(parsed.producedAt.toISOString().slice(0, 19)).toBe(PRODUCED_AT.toISOString().slice(0, 19));
    expect(parsed.results).toHaveLength(2);

    const backToLabResults = oruToLabResults(parsed.results);
    expect(backToLabResults).toEqual(SAMPLE_RESULTS.map((r) => ({ ...r, value: r.value })));
  });

  test("abnormal flags map both ways: normal/high/low/critical <-> N/H/L/HH", () => {
    const results: LabResult[] = [
      { testCode: "x", testName: "x", value: 1, interpretation: "high", status: "final" },
      { testCode: "y", testName: "y", value: 1, interpretation: "low", status: "preliminary" },
    ];
    const raw = buildOruMessage({ placerOrderNumber: SR_ID, messageControlId: "MSG-2", producedAt: PRODUCED_AT, results: labResultsToOru(results) });
    expect(raw).toContain("|H|");
    expect(raw).toContain("|L|");
    const back = oruToLabResults(parseOruMessage(raw).results);
    expect(back[0].interpretation).toBe("high");
    expect(back[0].status).toBe("final");
    expect(back[1].interpretation).toBe("low");
    expect(back[1].status).toBe("preliminary");
  });

  test("rejects a message missing OBR", () => {
    expect(() => parseOruMessage("MSH|^~\\&|A|B|C|D|20261104000000||ORU^R01|1|P|2.5.1\r")).toThrow();
  });
});

describe("ASTM E1394 round trip", () => {
  test("build then parse reproduces placer order number and results", () => {
    const astmResults = labResultsToAstm(SAMPLE_RESULTS);
    const raw = buildAstmResult({ placerOrderNumber: SR_ID, producedAt: PRODUCED_AT, results: astmResults });

    expect(raw).toContain("O|1|" + SR_ID);
    expect(raw).toContain("L|1|N");

    const parsed = parseAstmResult(raw);
    expect(parsed.placerOrderNumber).toBe(SR_ID);
    expect(parsed.results).toHaveLength(2);

    const backToLabResults = astmToLabResults(parsed.results);
    expect(backToLabResults).toEqual(SAMPLE_RESULTS);
  });

  test("abnormal flags map both ways: normal/high/low/critical <-> N/H/L/HH", () => {
    const results: LabResult[] = [
      { testCode: "x", testName: "x", value: 1, interpretation: "high", status: "final" },
      { testCode: "y", testName: "y", value: 1, interpretation: "low", status: "corrected" },
    ];
    const raw = buildAstmResult({ placerOrderNumber: SR_ID, producedAt: PRODUCED_AT, results: labResultsToAstm(results) });
    const back = astmToLabResults(parseAstmResult(raw).results);
    expect(back[0].interpretation).toBe("high");
    expect(back[1].interpretation).toBe("low");
    expect(back[1].status).toBe("corrected");
  });

  test("rejects a message missing O (order) record", () => {
    expect(() => parseAstmResult("H|^\\&|||SIM||||||||P|E1394-97|20261104000000\rL|1|N\r")).toThrow();
  });

  test("string-valued results survive as strings, not NaN", () => {
    const results: LabResult[] = [{ testCode: "24357-6", testName: "Urine dipstick", value: "trace", status: "final" }];
    const raw = buildAstmResult({ placerOrderNumber: SR_ID, producedAt: PRODUCED_AT, results: labResultsToAstm(results) });
    const back = astmToLabResults(parseAstmResult(raw).results);
    expect(back[0].value).toBe("trace");
  });
});
