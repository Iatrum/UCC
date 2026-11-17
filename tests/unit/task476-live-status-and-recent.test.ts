import { afterEach, describe, expect, test } from "bun:test";
import type { Encounter, Observation, Condition } from "@medplum/fhirtypes";
import { startLabResultUpdates } from "../../lib/poct/live-results";
import { buildSavedConsultation } from "../../lib/fhir/consultation-service";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const results = { success: true, poctEnabled: true, pacsEnabled: false, reports: [], pending: [], xrayPending: [] };
const tick = () => new Promise((r) => setTimeout(r, 20));

describe("Task 476 (b): live updates status", () => {
  test("subscription 503 reports live=false once, results still load", async () => {
    globalThis.fetch = (async (url: string) => {
      if (String(url).startsWith("/api/labs/results")) return new Response(JSON.stringify(results), { status: 200 });
      return new Response(JSON.stringify({ error: "Live updates unavailable" }), { status: 503 });
    }) as unknown as typeof fetch;
    const live: boolean[] = [];
    let got = 0;
    const handle = startLabResultUpdates({
      patientId: "fake-1", onResults: () => { got++; }, onError: () => {}, onLoaded: () => {},
      onLiveStatus: (v) => live.push(v),
    });
    await tick();
    handle.stop();
    expect(got).toBe(1);
    expect(live).toEqual([false]);
  });

  test("no callback after stop", async () => {
    globalThis.fetch = (async () => new Response("{}", { status: 503 })) as unknown as typeof fetch;
    const live: boolean[] = [];
    const handle = startLabResultUpdates({
      patientId: "fake-1", onResults: () => {}, onError: () => {}, onLoaded: () => {}, onLiveStatus: (v) => live.push(v),
    });
    handle.stop();
    await tick();
    expect(live).toEqual([]);
  });
});

describe("Task 476 (c): buildSavedConsultation mapping", () => {
  const enc = (extra: Partial<Encounter> = {}): Encounter => ({
    resourceType: "Encounter", id: "e1", status: "in-progress", class: { code: "AMB" },
    subject: { reference: "Patient/p1", display: "Fake Patient" }, ...extra,
  });
  const obs = { resourceType: "Observation", status: "final", code: { text: "Chief Complaint" }, valueString: "cough" } as Observation;
  const cond = { resourceType: "Condition", subject: { reference: "Patient/p1" }, code: { text: "URTI" } } as Condition;

  test("patientId falls back to the subject Patient id when no firebase-patient identifier", () => {
    expect(buildSavedConsultation(enc(), [], [], [], []).patientId).toBe("p1");
  });
  test("firebase-patient identifier still wins", () => {
    const e = enc({ identifier: [{ system: "firebase-patient", value: "legacy-9" }] });
    expect(buildSavedConsultation(e, [], [], [], []).patientId).toBe("legacy-9");
  });
  test("complaint/diagnosis map when children present, empty when genuinely absent", () => {
    const full = buildSavedConsultation(enc(), [cond], [obs], [], []);
    expect(full.chiefComplaint).toBe("cough");
    expect(full.diagnosis).toBe("URTI");
    const bare = buildSavedConsultation(enc(), [], [], [], []);
    expect(bare.chiefComplaint).toBe("");
    expect(bare.diagnosis).toBe("");
  });
});
