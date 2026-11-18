import { describe, expect, test } from "bun:test";
import type { Encounter } from "@medplum/fhirtypes";
import {
  INVESTIGATION_BILLING_URL,
  investigationBillItems,
  investigationBillingExtensions,
  type InvestigationBillItem,
} from "../../lib/fhir/investigation-billing";
import {
  formatMedicationNameWithStrength,
  formatPrescriptionDetails,
  formatPrescriptionLine,
} from "../../lib/prescriptions";

// Fake data only (Task 633).
const enc = (extension: Encounter["extension"]): Encounter =>
  ({ resourceType: "Encounter", status: "in-progress", class: { code: "AMB" }, extension }) as Encounter;

describe("investigation billing extensions", () => {
  const item = { id: "p1", name: "FBC", price: 25 } as unknown as InvestigationBillItem;
  test("round-trips through extensions", () => {
    const exts = investigationBillingExtensions([item]);
    expect(exts[0].url).toBe(INVESTIGATION_BILLING_URL);
    expect(investigationBillItems(enc(exts))).toEqual([item]);
  });
  test("no extensions -> empty", () => {
    expect(investigationBillItems(enc(undefined))).toEqual([]);
  });
  test("ignores foreign urls, bad JSON, missing id, non-string name", () => {
    const out = investigationBillItems(
      enc([
        { url: "https://other", valueString: JSON.stringify(item) },
        { url: INVESTIGATION_BILLING_URL, valueString: "{not json" },
        { url: INVESTIGATION_BILLING_URL },
        { url: INVESTIGATION_BILLING_URL, valueString: JSON.stringify({ name: "no id" }) },
        { url: INVESTIGATION_BILLING_URL, valueString: JSON.stringify({ id: "x", name: 5 }) },
        { url: INVESTIGATION_BILLING_URL, valueString: "null" },
        { url: INVESTIGATION_BILLING_URL, valueString: JSON.stringify(item) },
      ])
    );
    expect(out).toEqual([item]);
  });
});

describe("prescription formatting", () => {
  const rx = (o: any) => o as any;
  test("details join with middle dot, drop blanks and leading 'for'", () => {
    expect(formatPrescriptionDetails(rx({ medication: { strength: "500mg" }, frequency: "  for   twice daily ", duration: "5 days" })))
      .toBe("500mg · twice daily · 5 days");
    expect(formatPrescriptionDetails(rx({ frequency: "for", duration: "for for" }))).toBe("");
  });
  test("line falls back to 'Medication' and omits dash when no details", () => {
    expect(formatPrescriptionLine(rx({}))).toBe("Medication");
    expect(formatPrescriptionLine(rx({ medication: { name: "Amoxicillin", strength: "250mg" }, frequency: "TDS" })))
      .toBe("Amoxicillin — 250mg · TDS");
  });
  test("name+strength does not duplicate strength", () => {
    expect(formatMedicationNameWithStrength("Paracetamol 500mg", "500mg")).toBe("Paracetamol 500mg");
    expect(formatMedicationNameWithStrength("Paracetamol 500mg 500mg", "500mg")).toBe("Paracetamol 500mg");
    expect(formatMedicationNameWithStrength("Paracetamol", "500 mg")).toBe("Paracetamol 500 mg");
    expect(formatMedicationNameWithStrength("Vit C", "")).toBe("Vit C");
    expect(formatMedicationNameWithStrength("", "")).toBe("Medication");
    expect(formatMedicationNameWithStrength("", "10ml")).toBe("10ml");
  });
  test("strength with regex metacharacters is matched literally", () => {
    expect(formatMedicationNameWithStrength("Cream 1.5%", "1.5%")).toBe("Cream 1.5%");
    expect(formatMedicationNameWithStrength("Cream 1x5%", "1.5%")).toBe("Cream 1x5% 1.5%");
  });
});
