import { describe, expect, test } from "bun:test";
import type { Invoice } from "@medplum/fhirtypes";
import { getInvoiceNumber, isOwnVersionOrClinicBump } from "../../lib/fhir/billing-service";
import { checkoutSubtotal, displayInvoiceNumber, hasBillableItems } from "../../lib/billing/checkout-guards";
import {
  CLINIC_IDENTIFIER_SYSTEM,
  assertOrderClinic,
  getClinicIdentifierValue,
  resourceMatchesClinicTenant,
  withClinicIdentifier,
} from "../../lib/fhir/clinic-tenancy";

// Fake data only (Task 629).
const inv = (versionId: string | undefined, over: Partial<Invoice> = {}): Invoice =>
  ({
    resourceType: "Invoice",
    id: "inv-1",
    status: "balanced",
    meta: versionId ? { versionId } : {},
    lineItem: [{ sequence: 1, chargeItemCodeableConcept: { text: "Consult" } }],
    totalNet: { value: 50, currency: "MYR" },
    totalGross: { value: 50, currency: "MYR" },
    ...over,
  }) as Invoice;

describe("isOwnVersionOrClinicBump (stock-deduction concurrency guard)", () => {
  test("same version is our own save", () => {
    expect(isOwnVersionOrClinicBump(inv("1"), inv("1"))).toBe(true);
  });
  test("new version with identical billed content is a metadata-only bump", () => {
    expect(isOwnVersionOrClinicBump(inv("1"), inv("2"))).toBe(true);
  });
  test("new version with different lines/total/status is a concurrent change", () => {
    expect(isOwnVersionOrClinicBump(inv("1"), inv("2", { totalGross: { value: 80, currency: "MYR" } }))).toBe(false);
    expect(isOwnVersionOrClinicBump(inv("1"), inv("2", { status: "cancelled" }))).toBe(false);
    expect(isOwnVersionOrClinicBump(inv("1"), inv("2", { lineItem: [] }))).toBe(false);
  });
  test("current without a versionId cannot prove a change", () => {
    expect(isOwnVersionOrClinicBump(inv("1"), inv(undefined))).toBe(true);
  });
});

describe("invoice number display", () => {
  test("stored number wins; falls back to id; null-safe", () => {
    const i = inv("1", { identifier: [{ system: "https://ucc.emr/invoice/number", value: "INV-20260101-ABC123" }] });
    expect(getInvoiceNumber(i)).not.toBe("");
    expect(getInvoiceNumber(inv("1"))).toBe("inv-1");
    expect(getInvoiceNumber(null)).toBe("");
    expect(displayInvoiceNumber("  ")).toBe("Assigned on completion");
  });
});

describe("checkout totals edge cases", () => {
  test("rounds to sen across many float-unfriendly lines", () => {
    const lines = Array.from({ length: 10 }, () => ({ quantity: 1, price: 0.1 }));
    expect(checkoutSubtotal(lines)).toBe(1);
    expect(checkoutSubtotal([{ quantity: 3, price: 19.99 }, { quantity: 2, price: 0.35 }])).toBe(60.67);
  });
  test("fractional quantity multiplies", () => {
    expect(checkoutSubtotal([{ quantity: 0.5, price: 10 }])).toBe(5);
  });
  test("empty is 0 and not billable; a zero-total mix is not billable", () => {
    expect(checkoutSubtotal([])).toBe(0);
    expect(hasBillableItems([{ quantity: 1, price: 0 }, { quantity: 5, price: 0 }])).toBe(false);
  });
});

describe("clinic scoping helpers", () => {
  test("getClinicIdentifierValue reads only the clinic system", () => {
    expect(getClinicIdentifierValue({ identifier: [{ system: "other", value: "x" }, { system: CLINIC_IDENTIFIER_SYSTEM, value: "clinic-a" }] })).toBe("clinic-a");
    expect(getClinicIdentifierValue({ identifier: [{ system: "other", value: "x" }] })).toBeUndefined();
    expect(getClinicIdentifierValue({})).toBeUndefined();
  });
  test("withClinicIdentifier stamps, replaces a foreign clinic, is idempotent, keeps others", () => {
    const stamped = withClinicIdentifier({ identifier: [{ system: "mrn", value: "1" }] }, "clinic-a");
    expect(getClinicIdentifierValue(stamped)).toBe("clinic-a");
    expect(stamped.identifier).toContainEqual({ system: "mrn", value: "1" });
    expect(withClinicIdentifier(stamped, "clinic-a")).toBe(stamped);
    const moved = withClinicIdentifier(stamped, "clinic-b");
    expect(moved.identifier!.filter((i) => i.system === CLINIC_IDENTIFIER_SYSTEM)).toEqual([{ system: CLINIC_IDENTIFIER_SYSTEM, value: "clinic-b" }]);
    expect(stamped.identifier!.some((i) => i.value === "clinic-a")).toBe(true); // input not mutated
  });
  test("withClinicIdentifier without a clinic id returns the resource unchanged", () => {
    const r = { identifier: [{ system: "mrn", value: "1" }] };
    expect(withClinicIdentifier(r, undefined)).toBe(r);
    expect(withClinicIdentifier(r, null)).toBe(r);
    expect(withClinicIdentifier(r, "")).toBe(r);
  });
  test("resourceMatchesClinicTenant: identifier, org refs, account/accounts/compartment; foreign clinic rejected", () => {
    const a = { identifier: [{ system: CLINIC_IDENTIFIER_SYSTEM, value: "clinic-a" }] };
    expect(resourceMatchesClinicTenant(a, "clinic-a")).toBe(true);
    expect(resourceMatchesClinicTenant(a, "clinic-b")).toBe(false);
    expect(resourceMatchesClinicTenant({ managingOrganization: { reference: "Organization/clinic-a" } }, "clinic-a")).toBe(true);
    expect(resourceMatchesClinicTenant({ serviceProvider: { reference: "Organization/clinic-a" } }, "clinic-b")).toBe(false);
    expect(resourceMatchesClinicTenant({ meta: { account: { reference: "Organization/clinic-a" } } }, "clinic-a")).toBe(true);
    expect(resourceMatchesClinicTenant({ meta: { account: [{ reference: "Organization/clinic-b" }] } }, "clinic-a")).toBe(false);
    expect(resourceMatchesClinicTenant({ meta: { accounts: [{ reference: "Organization/clinic-a" }] } }, "clinic-a")).toBe(true);
    expect(resourceMatchesClinicTenant({ meta: { compartment: [{ reference: "Organization/clinic-a" }] } }, "clinic-a")).toBe(true);
    expect(resourceMatchesClinicTenant({}, "clinic-a")).toBe(false);
  });
  test("assertOrderClinic rejects before any read for a missing clinic or malformed ids", async () => {
    const medplum = { readResource: () => { throw new Error("must not read"); } } as any;
    await expect(assertOrderClinic(medplum, "", "pat-1")).rejects.toBeDefined();
    await expect(assertOrderClinic(medplum, "clinic-a", "Patient/../x")).rejects.toBeDefined();
    await expect(assertOrderClinic(medplum, "clinic-a", "pat-1", "enc 1;drop")).rejects.toBeDefined();
  });
});
