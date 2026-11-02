import { describe, expect, test } from "bun:test";
import { appointmentDob, shouldAutofillDob, formatMalaysianDate, isIsoDate, parseMalaysianDate, parseMalaysianNricDob } from "../../lib/patient-dob";

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


test("appointment DOB omits missing and invalid dates without throwing", () => {
  for (const input of [undefined, null, "", new Date(""), new Date(NaN), "invalid", "2026-02-30", "0000-01-01"]) {
    expect(appointmentDob(input)).toBeUndefined();
  }
  expect(appointmentDob(new Date("2000-02-29T00:00:00Z"))).toBe("2000-02-29");
  expect(appointmentDob("2000-02-29")).toBe("2000-02-29");
  expect(appointmentDob("2000-02-29T00:00:00Z")).toBe("2000-02-29");
});

test("year zero is invalid in ISO and Malaysian DOBs", () => {
  expect(isIsoDate("0000-01-01")).toBe(false);
  expect(parseMalaysianDate("01/01/0000")).toBeNull();
  expect(isIsoDate("0001-01-01")).toBe(true);
});

test("NRIC autofill respects manual ownership even when cleared or equal to the derived DOB", () => {
  const auto = "2000-02-29";
  expect(shouldAutofillDob("", null, false)).toBe(true);
  expect(shouldAutofillDob(auto, auto, false)).toBe(true); // NRIC can update an automatic value
  expect(shouldAutofillDob("1999-01-01", null, false)).toBe(false); // existing DOB
  expect(shouldAutofillDob("01/", auto, true)).toBe(false);
  expect(shouldAutofillDob("", auto, true)).toBe(false); // select-all/delete
  expect(shouldAutofillDob(auto, auto, true)).toBe(false); // manual value matches NRIC
  expect(shouldAutofillDob("", null, true)).toBe(false); // later NRIC change
});
