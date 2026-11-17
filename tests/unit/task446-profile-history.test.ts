import { describe, expect, test } from "bun:test";
import {
  consultSummary,
  shouldShowStartConsultButton,
  withSignedConsultation,
} from "../../lib/patients/profile-history";

describe("task 446 profile history", () => {
  test("signed consult appears immediately when server list is stale", () => {
    const signed = { id: "c1", date: "2026-01-02T00:00:00Z" };
    expect(withSignedConsultation([], signed)).toEqual([signed]);
  });
  test("no duplicate once the server list has the consult", () => {
    const signed = { id: "c1", date: "2026-01-02T00:00:00Z" };
    const server = [{ id: "c1", date: "2026-01-02T00:00:00Z" }];
    expect(withSignedConsultation(server, signed)).toBe(server);
    expect(withSignedConsultation(server, null)).toBe(server);
  });
  test("Start consult hidden while drawer open", () => {
    expect(shouldShowStartConsultButton(true)).toBe(false);
    expect(shouldShowStartConsultButton(false)).toBe(true);
  });
  test("consult summary counts consults and picks newest date", () => {
    expect(consultSummary([])).toEqual({ total: 0, lastDate: null });
    expect(
      consultSummary([{ date: "2026-01-01" }, { date: "2026-03-01" }, { date: null }, { date: "bad" }])
    ).toEqual({ total: 4, lastDate: "2026-03-01" });
  });
});
