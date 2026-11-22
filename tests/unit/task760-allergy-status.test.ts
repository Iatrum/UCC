import { describe, expect, test } from "bun:test";
import { getAllergyStatus } from "../../lib/patients/allergy-status";

describe("task 760 allergy status", () => {
  test("nothing recorded is not shown as none", () => {
    expect(getAllergyStatus([])).toEqual({ kind: "not-recorded" });
    expect(getAllergyStatus(undefined)).toEqual({ kind: "not-recorded" });
    expect(getAllergyStatus(["  ", ""])).toEqual({ kind: "not-recorded" });
  });
  test("explicit NKDA is not an alert", () => {
    expect(getAllergyStatus(["No known drug allergies"])).toEqual({ kind: "none-known" });
  });
  test("real allergies alert and drop NKDA text", () => {
    expect(getAllergyStatus(["Penicillin", "No known food allergies", " Latex "])).toEqual({
      kind: "alert",
      allergies: ["Penicillin", "Latex"],
    });
  });
});
