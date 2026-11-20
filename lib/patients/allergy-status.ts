/**
 * Task 760: one place that decides how a patient's recorded allergies are shown.
 * "No known ..." entries are an explicit "no allergies" statement, not an alert;
 * an empty list means nothing was ever recorded and must not read as "none".
 */
export type AllergyStatus =
  | { kind: "alert"; allergies: string[] }
  | { kind: "none-known" }
  | { kind: "not-recorded" };

export function getAllergyStatus(allergies: readonly string[] | null | undefined): AllergyStatus {
  const entries = (allergies ?? []).map((a) => (a ?? "").trim()).filter(Boolean);
  const real = entries.filter((a) => !/^no known/i.test(a));
  if (real.length > 0) return { kind: "alert", allergies: real };
  if (entries.length > 0) return { kind: "none-known" };
  return { kind: "not-recorded" };
}
