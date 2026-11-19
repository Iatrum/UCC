import { afterAll, beforeEach, describe, expect, spyOn, test, setSystemTime } from "bun:test";
import {
  completeCheckoutInvoice,
  deleteInvoice,
  generateInvoiceNumber,
  getConsultationInvoice,
  getInvoice,
  getInvoiceNumber,
  getPatientInvoices,
  voidInvoice,
  type CompleteCheckoutInput,
} from "../../lib/fhir/billing-service";
import { readStock } from "../../lib/fhir/dispense-service";
import { CLINIC_A, CLINIC_B, createMockMedplum, tenantResources } from "./helpers/mock-medplum";

// Task 643: checkout totals, invoice creation, auto-deduct at checkout and clinic scoping. Fake data only.
// Clock is fixed with setSystemTime to a mid-day UTC literal so the local calendar date is stable in any TZ.
const NOW = "2030-03-05T12:00:00.000Z";
const INV_NUM = "https://ucc.emr/invoice/number";
const INV_CONSULT = "https://ucc.emr/invoice/consultation";
// The service formats the invoice number from the server-local calendar date, so derive the expectation the same way.
const d = new Date(NOW);
const LOCAL_YMD = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
const clinicIdent = (c: string) => ({ system: "clinic", value: c });
const ext = (r: any, url: string) => r.extension?.find((e: any) => e.url === url);

function medication(id: string, name: string, stock: number, clinic = CLINIC_A) {
  return {
    resourceType: "Medication",
    id,
    identifier: [{ system: "https://ucc.emr/inventory/medication", value: "catalog-item" }, clinicIdent(clinic)],
    code: { text: name },
    extension: [{ url: "https://ucc.emr/inventory", extension: [{ url: "stock", valueInteger: stock }] }],
  };
}

const seed = () => [
  ...tenantResources(CLINIC_A),
  ...tenantResources(CLINIC_B),
  { resourceType: "Patient", id: "p1", identifier: [clinicIdent(CLINIC_A)] },
  { resourceType: "Patient", id: "p2", identifier: [clinicIdent(CLINIC_A)] },
  { resourceType: "Patient", id: "pb", identifier: [clinicIdent(CLINIC_B)] },
  { resourceType: "Encounter", id: "enc1", subject: { reference: "Patient/p1" }, identifier: [clinicIdent(CLINIC_A)] },
  { resourceType: "Encounter", id: "enc2", subject: { reference: "Patient/p2" }, identifier: [clinicIdent(CLINIC_A)] },
  { resourceType: "Encounter", id: "encb", subject: { reference: "Patient/pb" }, identifier: [clinicIdent(CLINIC_B)] },
  medication("m1", "Fake Paracetamol", 10),
  medication("mb", "Fake Paracetamol", 10, CLINIC_B),
];

const items = [
  { id: "s1", name: "Consultation", type: "Service" as const, quantity: 1, price: 50 },
  { id: "i1", name: "Fake Paracetamol", type: "Item" as const, quantity: 3, price: 2.5 },
  { id: "d1", name: "MC", type: "Document" as const, quantity: 2, price: 10.05 },
];
const TOTAL = 77.6; // 50 + 7.5 + 20.10

function input(over: Partial<CompleteCheckoutInput> = {}): CompleteCheckoutInput {
  return {
    consultationId: "enc1",
    patientId: "p1",
    clinicId: CLINIC_A,
    paymentMethod: "card",
    items,
    totalAmount: TOTAL,
    paidAmount: TOTAL,
    ...over,
  };
}

let mock: ReturnType<typeof createMockMedplum>;
beforeEach(() => {
  spyOn(console, "error").mockImplementation(() => {}); // expected: no triage encounter in the fake
  setSystemTime(new Date(NOW));
  mock = createMockMedplum(seed(), { versioning: true });
});
afterAll(() => setSystemTime());

const run = (over: Partial<CompleteCheckoutInput> = {}) => completeCheckoutInvoice(mock.client, input(over));

describe("checkout totals validation", () => {
  const rejects: Array<[string, Partial<CompleteCheckoutInput>, RegExp]> = [
    ["missing consultation id", { consultationId: " " }, /required/],
    ["unknown payment method", { paymentMethod: "cheque" as any }, /Invalid payment method/],
    ["no items", { items: [] }, /At least one invoice item/],
    ["blank item name", { items: [{ ...items[0], name: "  " }], totalAmount: 50, paidAmount: 50 }, /valid name, type, quantity, and price/],
    ["unknown item type", { items: [{ ...items[0], type: "Gift" as any }] }, /valid name, type/],
    ["zero quantity", { items: [{ ...items[0], quantity: 0 }], totalAmount: 0, paidAmount: 0 }, /valid name, type/],
    ["negative price", { items: [{ ...items[0], price: -1 }], totalAmount: 0, paidAmount: 0 }, /valid name, type/],
    ["NaN quantity", { items: [{ ...items[0], quantity: Number.NaN }] }, /valid name, type/],
    ["total does not match items", { totalAmount: 70, paidAmount: 70 }, /does not match invoice items/],
    ["non-numeric total", { totalAmount: "abc" as any }, /totalAmount must be a valid amount/],
    ["negative total", { totalAmount: -5 }, /totalAmount must be a valid amount/],
    ["partial payment", { paidAmount: 77.5 }, /Full payment is required/],
    ["non-numeric paid amount", { paidAmount: "x" as any }, /paidAmount must be a valid amount/],
    ["negative paid amount", { paidAmount: -1 }, /paidAmount must be a valid amount/],
  ];
  for (const [label, over, message] of rejects) {
    test(`rejects ${label} and writes nothing`, async () => {
      await expect(run(over)).rejects.toThrow(message);
      expect(mock.writes).toHaveLength(0);
    });
  }

  test("a missing queue entry is reported but never blocks the saved invoice", async () => {
    const r = await run();
    expect(r.invoice.id).toBeDefined();
    expect(r.queueUpdateError).toMatch(/No active triage encounter/);
  });

  test("every payment method is accepted", async () => {
    for (const method of ["cash", "card", "qr", "panel"] as const) {
      const r = await run({ paymentMethod: method });
      expect(ext(r.invoice, "https://ucc.emr/invoice/payment-method").valueCode).toBe(method);
      expect(r.invoice.paymentTerms).toBe(`Paid by ${method.toUpperCase()} at checkout`);
    }
  });
});

describe("invoice creation", () => {
  test("stores rounded totals, line items, identifiers and payment extensions", async () => {
    const { invoice } = await run({ paidAmount: 100 });
    expect(invoice.status).toBe("balanced");
    expect(invoice.subject?.reference).toBe("Patient/p1");
    expect(invoice.date).toBe(NOW);
    expect(invoice.totalNet?.value).toBe(TOTAL);
    expect(invoice.totalGross).toEqual({ value: TOTAL, currency: "MYR" });
    expect(invoice.totalPriceComponent?.[0].amount?.value).toBe(TOTAL);
    expect(invoice.lineItem?.map((l) => l.priceComponent?.[0].amount?.value)).toEqual([50, 7.5, 20.1]);
    expect(invoice.lineItem?.map((l) => l.sequence)).toEqual([1, 2, 3]);
    expect(invoice.lineItem?.[1].chargeItemCodeableConcept?.coding?.[0].code).toBe("item");
    expect(ext(invoice.lineItem![1], "https://ucc.emr/invoice/line-item-quantity").valueDecimal).toBe(3);
    expect(ext(invoice.lineItem![1], "https://ucc.emr/invoice/line-item-source-id").valueString).toBe("i1");
    // Overpayment: paid is recorded as given, balance never goes negative.
    expect(ext(invoice, "https://ucc.emr/invoice/paid-amount").valueMoney.value).toBe(100);
    expect(ext(invoice, "https://ucc.emr/invoice/balance").valueMoney.value).toBe(0);
    expect(ext(invoice, "https://ucc.emr/invoice/clinic-id").valueString).toBe(CLINIC_A);
    expect(invoice.identifier).toEqual(
      expect.arrayContaining([
        { system: INV_CONSULT, value: "enc1" },
        { system: "clinic", value: CLINIC_A },
      ])
    );
  });

  test("invoice number uses the (local) date of the fixed clock and a 6-char suffix", async () => {
    const { invoice } = await run();
    expect(getInvoiceNumber(invoice)).toMatch(new RegExp(`^INV-${LOCAL_YMD}-[A-F0-9]{6}$`));
  });

  test("a valid proposed number is upper-cased and used; invalid or taken ones are replaced", async () => {
    expect(getInvoiceNumber((await run({ invoiceNumber: " inv/2030-001 " })).invoice)).toBe("INV/2030-001");

    mock = createMockMedplum(seed(), { versioning: true });
    expect(getInvoiceNumber((await run({ invoiceNumber: "bad number!" })).invoice)).toMatch(new RegExp(`^INV-${LOCAL_YMD}-`));

    mock = createMockMedplum(
      [...seed(), { resourceType: "Invoice", id: "other", identifier: [{ system: INV_NUM, value: "TAKEN-1" }, clinicIdent(CLINIC_A)] }],
      { versioning: true }
    );
    expect(getInvoiceNumber((await run({ invoiceNumber: "taken-1" })).invoice)).toMatch(new RegExp(`^INV-${LOCAL_YMD}-`));
  });

  test("generateInvoiceNumber fails after 5 collisions instead of reusing a number", async () => {
    const always = { searchResources: async () => [{ id: "x" }] } as any;
    await expect(generateInvoiceNumber(always, new Date(NOW))).rejects.toThrow(/unique invoice number/);
  });

  test("re-checkout updates the same invoice, keeps its number and recomputes totals", async () => {
    const first = await run();
    const number = getInvoiceNumber(first.invoice);
    const second = await run({
      invoiceNumber: "NEW-1",
      items: [{ ...items[0], price: 80 }],
      totalAmount: 80,
      paidAmount: 80,
    });
    expect(second.invoice.id).toBe(first.invoice.id);
    expect(mock.creates("Invoice")).toHaveLength(1);
    expect(getInvoiceNumber(second.invoice)).toBe(number);
    expect(second.invoice.totalGross?.value).toBe(80);
    expect(second.invoice.lineItem).toHaveLength(1);
    expect(second.invoice.identifier?.filter((i) => i.system === INV_CONSULT)).toHaveLength(1);
  });
});

describe("auto-deduct inventory at checkout (no separate dispense step)", () => {
  const stock = (id = "m1") => readStock(mock.stored("Medication", id) as any);

  test("checkout alone deducts billed Item quantity and records one MedicationDispense", async () => {
    const r = await run();
    expect(stock()).toBe(7);
    expect(r.stock?.adjusted).toEqual([expect.objectContaining({ medicationId: "m1", delta: 3, stockAfter: 7 })]);
    expect(r.dispenseError).toBeUndefined();
    const dispenses = mock.creates("MedicationDispense");
    expect(dispenses).toHaveLength(1);
    expect(dispenses[0].context?.reference).toBe("Encounter/enc1");
  });

  test("fractional billed quantity rounds up to whole units; services/documents never touch stock", async () => {
    await run({
      items: [{ id: "i1", name: "Fake Paracetamol", type: "Item", quantity: 2.2, price: 10 }, items[0], items[2]],
      totalAmount: 22 + 50 + 20.1,
      paidAmount: 92.1,
    });
    expect(stock()).toBe(7);
  });

  test("re-checkout is idempotent and does not deduct twice", async () => {
    await run();
    await run();
    expect(stock()).toBe(7);
    expect(mock.creates("MedicationDispense").length).toBe(1); // second run must not add another audit record
  });

  test("the same medicine on two lines is summed", async () => {
    await run({
      items: [
        { id: "a", name: "Fake Paracetamol", type: "Item", quantity: 2, price: 1 },
        { id: "b", name: "fake  paracetamol", type: "Item", quantity: 4, price: 1 },
      ],
      totalAmount: 6,
      paidAmount: 6,
    });
    expect(stock()).toBe(4);
  });

  test("another clinic's identically named medicine is never matched or changed", async () => {
    await run();
    expect(stock("mb")).toBe(10);
    expect(mock.updates("Medication").map((m) => m.id)).toEqual(["m1"]);
  });

  test("out-of-stock never blocks the invoice; stock goes negative and is reported", async () => {
    mock = createMockMedplum([...seed().filter((r) => r.id !== "m1"), medication("m1", "Fake Paracetamol", 1)], { versioning: true });
    const r = await run();
    expect(r.invoice.id).toBeDefined();
    expect(stock()).toBe(-2);
    expect(r.stock?.negativeStock).toEqual(["Fake Paracetamol"]);
  });

  test("an unknown medicine name is reported unmatched and the invoice still saves", async () => {
    const r = await run({
      items: [{ id: "x", name: "No Such Drug", type: "Item", quantity: 1, price: 5 }],
      totalAmount: 5,
      paidAmount: 5,
    });
    expect(r.stock?.unmatched).toEqual(["No Such Drug"]);
    expect(r.stock?.adjusted).toEqual([]);
    expect(stock()).toBe(10);
  });
});

describe("clinic scoping on checkout and invoice reads", () => {
  test("a patient from another clinic is rejected with zero writes", async () => {
    await expect(run({ patientId: "pb", consultationId: "encb" })).rejects.toThrow();
    expect(mock.writes).toHaveLength(0);
  });

  test("another clinic's encounter, or one that belongs to a different patient, is rejected", async () => {
    await expect(run({ consultationId: "encb" })).rejects.toThrow();
    await expect(run({ consultationId: "enc2" })).rejects.toThrow();
    expect(mock.writes).toHaveLength(0);
  });

  test("a foreign clinic's invoice for the same consultation id is not adopted or overwritten", async () => {
    const foreign = {
      resourceType: "Invoice",
      id: "foreign-inv",
      status: "balanced",
      identifier: [{ system: INV_CONSULT, value: "enc1" }, clinicIdent(CLINIC_B)],
      totalGross: { value: 1, currency: "MYR" },
    };
    mock = createMockMedplum([...seed(), foreign], { versioning: true });
    const r = await run();
    expect(r.invoice.id).not.toBe("foreign-inv");
    expect(mock.updates("Invoice")).toHaveLength(0);
    expect((mock.stored("Invoice", "foreign-inv") as any).totalGross.value).toBe(1);
  });

  describe("reads, void and delete", () => {
    const foreignInv = {
      resourceType: "Invoice",
      id: "inv-b",
      status: "balanced",
      subject: { reference: "Patient/p1" },
      identifier: [{ system: INV_CONSULT, value: "enc1" }, clinicIdent(CLINIC_B)],
    };
    beforeEach(() => {
      mock = createMockMedplum([...seed(), foreignInv], { versioning: true });
    });

    test("getInvoice / getConsultationInvoice / getPatientInvoices hide other clinics", async () => {
      expect(await getInvoice(mock.client, "inv-b", CLINIC_A)).toBeNull();
      expect(await getInvoice(mock.client, "inv-b", CLINIC_B)).not.toBeNull();
      expect(await getInvoice(mock.client, "missing", CLINIC_A)).toBeNull();
      expect(await getConsultationInvoice(mock.client, "enc1", CLINIC_A)).toBeNull();
      expect((await getConsultationInvoice(mock.client, "enc1", CLINIC_B))?.id).toBe("inv-b");
      expect(await getPatientInvoices(mock.client, "p1", CLINIC_A)).toEqual([]);
      expect((await getPatientInvoices(mock.client, "p1", CLINIC_B)).map((i) => i.id)).toEqual(["inv-b"]);
    });

    test("void/delete of another clinic's invoice is denied and changes nothing", async () => {
      await expect(voidInvoice(mock.client, "inv-b", CLINIC_A)).rejects.toThrow(/Invoice not found/);
      await expect(deleteInvoice(mock.client, "inv-b", CLINIC_A)).rejects.toThrow(/Invoice not found/);
      expect((mock.stored("Invoice", "inv-b") as any).status).toBe("balanced");
      expect(mock.writes).toHaveLength(0);
    });

    test("void cancels the own invoice once and returns the checkout stock; repeating is a no-op for stock", async () => {
      const { invoice } = await run();
      expect(readStock(mock.stored("Medication", "m1") as any)).toBe(7);
      const voided = await voidInvoice(mock.client, invoice.id!, CLINIC_A);
      expect(voided.status).toBe("cancelled");
      expect(readStock(mock.stored("Medication", "m1") as any)).toBe(10);
      await voidInvoice(mock.client, invoice.id!, CLINIC_A);
      expect(readStock(mock.stored("Medication", "m1") as any)).toBe(10);
      expect(readStock(mock.stored("Medication", "mb") as any)).toBe(10);
    });

    test("delete removes the invoice after restoring stock", async () => {
      const { invoice } = await run();
      await deleteInvoice(mock.client, invoice.id!, CLINIC_A);
      expect(mock.stored("Invoice", invoice.id!)).toBeUndefined();
      expect(readStock(mock.stored("Medication", "m1") as any)).toBe(10);
    });
  });
});
