import { describe, expect, test } from "bun:test";
import {
  addClinicDays,
  clinicDateOf,
  formatClinicDate,
  hoursLabel,
  mcDaysLabel,
  mcEndDate,
  toClinicDate,
} from "../../lib/clinic-dates";

// Fake data only (Task 633). Follow-up / MC date arithmetic across month, year, leap boundaries.
describe("addClinicDays", () => {
  test("month, year and leap-day boundaries", () => {
    expect(addClinicDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addClinicDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addClinicDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addClinicDays("2026-12-31", 1)).toBe("2027-01-01");
  });
  test("zero and negative offsets", () => {
    expect(addClinicDays("2026-11-18", 0)).toBe("2026-11-18");
    expect(addClinicDays("2026-03-01", -1)).toBe("2026-02-28");
  });
  test("invalid dates -> null", () => {
    for (const d of ["2026-02-30", "2026-13-01", "18-11-2026", "", "2026-1-1"]) expect(addClinicDays(d, 1)).toBeNull();
  });
});

describe("clinicDateOf / toClinicDate (MYT = UTC+8)", () => {
  test("16:00Z rolls to next MYT day; 15:59Z does not", () => {
    expect(clinicDateOf(new Date("2026-11-17T15:59:59Z"))).toBe("2026-11-17");
    expect(clinicDateOf(new Date("2026-11-17T16:00:00Z"))).toBe("2026-11-18");
  });
  test("plain dates are kept; impossible plain dates are null", () => {
    expect(toClinicDate(" 2026-11-18 ")).toBe("2026-11-18");
    expect(toClinicDate("2026-02-29")).toBeNull();
  });
  test("ISO datetime converted to MYT day; garbage/empty/invalid Date -> null", () => {
    expect(toClinicDate("2026-11-17T20:00:00Z")).toBe("2026-11-18");
    expect(toClinicDate("garbage")).toBeNull();
    expect(toClinicDate(null)).toBeNull();
    expect(toClinicDate(undefined)).toBeNull();
    expect(toClinicDate(new Date("nope"))).toBeNull();
  });
  test("formatClinicDate pads day and empties unparseable", () => {
    expect(formatClinicDate("2026-03-05")).toBe("05 Mar 2026");
    expect(formatClinicDate("bad")).toBe("");
  });
});

describe("mcEndDate (inclusive)", () => {
  test("1 day ends on start; fractional floors; <=0/NaN empty", () => {
    expect(mcEndDate("2026-11-18", 1)).toBe("18 Nov 2026");
    expect(mcEndDate("2026-11-18", 2.9)).toBe("19 Nov 2026");
    expect(mcEndDate("2026-11-18", 0)).toBe("");
    expect(mcEndDate("2026-11-18", -3)).toBe("");
    expect(mcEndDate("2026-11-18", NaN)).toBe("");
    expect(mcEndDate(null, 2)).toBe("");
  });
  test("crosses a leap day", () => {
    expect(mcEndDate("2028-02-28", 3)).toBe("01 Mar 2028");
  });
  // Task 637: partial day (0<n<1) = same-day MC; end date is never before the start.
  test("fractional 0<n<1 is a same-day MC (end never before start)", () => {
    expect(mcEndDate("2026-11-18", 0.5)).toBe("18 Nov 2026");
    expect(mcEndDate("2026-11-18", 0.01)).toBe("18 Nov 2026");
    expect(mcEndDate("2026-11-18", 0.99)).toBe("18 Nov 2026");
    expect(mcEndDate("2026-11-18", 1.5)).toBe("18 Nov 2026");
  });
  test("non-finite and invalid start -> empty", () => {
    expect(mcEndDate("2026-11-18", Infinity)).toBe("");
    expect(mcEndDate("2026-11-18", -Infinity)).toBe("");
    expect(mcEndDate("2026-02-30", 2)).toBe("");
  });
  test("end date is never before start for any positive n", () => {
    for (const n of [0.001, 0.5, 1, 1.9, 2, 7, 30]) {
      const end = mcEndDate("2026-12-31", n);
      expect(end).not.toBe("");
      expect(end).not.toBe("30 Dec 2026");
    }
    expect(mcEndDate("2026-12-31", 2)).toBe("01 Jan 2027");
  });
});

describe("labels", () => {
  test("mcDaysLabel pluralises, defaults to 1 day", () => {
    expect(mcDaysLabel(1)).toBe("1 day");
    expect(mcDaysLabel("3")).toBe("3 days");
    expect(mcDaysLabel("")).toBe("1 day");
  });
  test("hoursLabel", () => {
    expect(hoursLabel(1)).toBe("1 hour");
    expect(hoursLabel("1.5")).toBe("1.5 hours");
    expect(hoursLabel(0)).toBe("—");
    expect(hoursLabel("abc")).toBe("abc hour(s)");
  });
});
