import { describe, expect, it, spyOn } from "bun:test";
import { getTriageQueueForToday } from "../../lib/fhir/triage-service";
import { CLINIC_IDENTIFIER_SYSTEM } from "../../lib/fhir/clinic-tenancy";

const EXT = "https://ucc.emr/triage-encounter";

function patient(id: string, clinic: string) {
  return {
    resourceType: "Patient", id, name: [{ text: `Fake ${id}` }], gender: "unknown",
    identifier: [{ system: CLINIC_IDENTIFIER_SYSTEM, value: clinic }],
  };
}

function encounter(i: number, clinic: string, status: string, queueStatus?: string) {
  const start = new Date(); start.setHours(0, 0, 1 + Math.floor(i / 60), i % 60, 0);
  return {
    resourceType: "Encounter", id: `e-${clinic}-${i}`, status,
    class: { code: "AMB" }, period: { start: start.toISOString() },
    subject: { reference: `Patient/p-${clinic}-${i}` },
    identifier: [{ system: CLINIC_IDENTIFIER_SYSTEM, value: clinic }],
    extension: queueStatus ? [{ url: EXT, extension: [{ url: "queueStatus", valueString: queueStatus }] }] : [],
  };
}

/** Fake client: honours _count/_offset with a `next` link; `leaky` ignores the clinic filter. */
function makeClient(encounters: any[], patients: any[], leaky = false) {
  const stats = { searches: 0, gets: 0 };
  const page = (q: URLSearchParams) => {
    const clinic = (q.get("identifier") ?? "").split("|")[1];
    let all = encounters.filter((e) => leaky || e.identifier.some((i: any) => i.value === clinic));
    all = all.filter((e) => (q.get("status") ?? "").split(",").includes(e.status))
      .sort((a, b) => a.period.start.localeCompare(b.period.start));
    const count = Number(q.get("_count") ?? 20), offset = Number(q.get("_offset") ?? 0);
    const slice = all.slice(offset, offset + count);
    const entry = slice.map((resource) => ({ resource }));
    for (const e of slice) {
      const p = patients.find((x) => `Patient/${x.id}` === e.subject.reference);
      if (p) entry.push({ resource: p });
    }
    const link: any[] = [];
    if (offset + count < all.length) {
      q.set("_offset", String(offset + count));
      link.push({ relation: "next", url: `http://fake/fhir/R4/Encounter?${q.toString()}` });
    }
    return { resourceType: "Bundle", entry, link };
  };
  return {
    stats,
    async readResource(type: string, id: string) {
      if (type === "Organization") return { resourceType: "Organization", id };
      throw new Error("not found");
    },
    async searchOne(type: string) { return { resourceType: type, id: "hs-1" }; },
    async search(_t: string, query: string) { stats.searches++; return page(new URLSearchParams(query)); },
    async get(url: string) { stats.gets++; return page(new URL(url).searchParams); },
  } as any;
}

describe("getTriageQueueForToday pagination", () => {
  it("shows a new check-in after 250 finished encounters", async () => {
    const enc: any[] = [], pts: any[] = [];
    for (let i = 0; i < 250; i++) { enc.push(encounter(i, "clinic-a", "finished", "completed")); pts.push(patient(`p-clinic-a-${i}`, "clinic-a")); }
    enc.push(encounter(300, "clinic-a", "arrived")); pts.push(patient("p-clinic-a-300", "clinic-a"));
    const client = makeClient(enc, pts);
    const q = await getTriageQueueForToday(200, client, "clinic-a");
    expect(q.map((p) => p.id)).toEqual(["p-clinic-a-300"]);
    expect(client.stats.gets).toBeGreaterThan(0);
  });

  it("keeps finished meds_and_bills visits in the queue", async () => {
    const enc = [encounter(1, "clinic-a", "finished", "meds_and_bills")];
    const q = await getTriageQueueForToday(200, makeClient(enc, [patient("p-clinic-a-1", "clinic-a")]), "clinic-a");
    expect(q).toHaveLength(1);
  });

  it("never returns clinic B encounters", async () => {
    const enc = [encounter(1, "clinic-a", "arrived"), encounter(2, "clinic-b", "arrived")];
    const pts = [patient("p-clinic-a-1", "clinic-a"), patient("p-clinic-b-2", "clinic-b")];
    for (const leaky of [false, true]) {
      const q = await getTriageQueueForToday(200, makeClient(enc, pts, leaky), "clinic-a");
      expect(q.map((p) => p.id)).toEqual(["p-clinic-a-1"]);
    }
  });

  it("returns empty without a clinicId", async () => {
    expect(await getTriageQueueForToday(200, makeClient([], []), undefined)).toEqual([]);
  });

  it("logs when the safety cap is hit", async () => {
    const enc: any[] = [], pts: any[] = [];
    for (let i = 0; i < 60; i++) { enc.push(encounter(i, "clinic-a", "arrived")); pts.push(patient(`p-clinic-a-${i}`, "clinic-a")); }
    const err = spyOn(console, "error").mockImplementation(() => {});
    const client = makeClient(enc, pts);
    // page size 1 => 60 pages > cap of 50
    const q = await getTriageQueueForToday(1, client, "clinic-a");
    expect(err).toHaveBeenCalled();
    expect(q.length).toBe(50);
    err.mockRestore();
  });
});
