import { describe, expect, test } from "bun:test";
import { formatMalaysianDate, isIsoDate, parseMalaysianDate, parseMalaysianNricDob } from "../../lib/patient-dob";

describe("Malaysian NRIC DOB", () => {
  test("uses current year's two-digit boundary", () => {
    expect(parseMalaysianNricDob("260101-14-0001", 2026)).toBe("2026-01-01");
    expect(parseMalaysianNricDob("270101-14-0001", 2026)).toBe("1927-01-01");
    expect(parseMalaysianNricDob("920301140001", 2026)).toBe("1992-03-01");
  });
  test("requires a complete NRIC and real calendar date", () => {
    for (const input of ["920301", "920301-14-000", "920301-140001", "920301-14-00011", "990229-14-0001", "001301-14-0001", "000431-14-0001", "000100-14-0001"]) {
      expect(parseMalaysianNricDob(input, 2026)).toBeNull();
    }
    expect(parseMalaysianNricDob("000229-14-0001", 2026)).toBe("2000-02-29");
  });
});

test("Malaysian date input round trips to ISO", () => {
  expect(parseMalaysianDate("29/02/2000")).toBe("2000-02-29");
  expect(formatMalaysianDate("2000-02-29")).toBe("29/02/2000");
  for (const input of ["31/04/2000", "29/02/1900", "1/2/2000", "2000-02-29", ""]) {
    expect(parseMalaysianDate(input)).toBeNull();
  }
  expect(isIsoDate("2026-02-30")).toBe(false);
  expect(formatMalaysianDate("29/0")).toBe("29/0");
});
