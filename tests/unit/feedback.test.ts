import { describe, expect, test } from "bun:test";
import {
  normalizeRequestKey, sanitizeFeedback, scrubError, scrubText, scrubUrl, summariseBrowser,
} from "../../lib/feedback/sanitize";
import {
  buildIssue, featureDedupeKey, getRequesterCount, parseScreenshot, requesterHash, storeFeatureRequest, submitBug,
} from "../../lib/feedback/service";
import { DEFAULT_BRANCH_ENABLED_MODULE_IDS, KNOWN_BRANCH_MODULE_IDS, getEnabledModuleIdsFromOrganization, normalizeEnabledModuleIds } from "../../lib/module-settings";
import type { Basic } from "@medplum/fhirtypes";

describe("PDPA scrubbing", () => {
  test("removes IC numbers, emails, phones and long identifiers", () => {
    const out = scrubText("IC 900101-14-5678 or 900101145678, mail ali@example.com, call 012-3456789 / +60 12-345 6789, MRN 00123456, id A1234567");
    expect(out).not.toMatch(/900101|ali@|3456789|345 6789|00123456|A1234567/);
  });
  test("removes labelled and honorific names", () => {
    const out = scrubText("Patient name: Ahmad bin Abu crashed. Encik Lim Wei Kiat's chart. Dr Tan was fine. Siti binti Omar");
    expect(out).not.toMatch(/Ahmad|Abu|Lim Wei|Siti|Omar/);
    expect(out).toContain("[REDACTED-NAME]");
  });
  test("redacts caller-supplied known terms", () => {
    expect(scrubText("Faux Patient failed to save", ["Faux Patient"])).not.toContain("Faux");
  });
  test("route shape only: ids, query and hash dropped", () => {
    expect(scrubUrl("https://demo.example.com/patients/3f2b8c1e-1111-4222-8333-444455556666?name=Ali#x")).toBe("/patients/:id");
    expect(scrubUrl("/patients/900101145678/consultations/abc123")).toBe("/patients/:id/consultations/:id");
    expect(scrubUrl("/dashboard")).toBe("/dashboard");
  });
  test("errors are truncated and scrubbed", () => {
    const out = scrubError(`TypeError: bad 900101-14-5678\n${"at x\n".repeat(50)}`);
    expect(out).not.toContain("900101");
    expect(out.split("\n").length).toBeLessThanOrEqual(6);
  });
  test("sanitizeFeedback never keeps raw UA, and clamps lengths", () => {
    const f = sanitizeFeedback({
      kind: "bug", title: "Save fails for 900101-14-5678", description: "x".repeat(5000),
      page: "/patients/12345678/edit?ic=900101145678",
      browser: { userAgent: "Mozilla/5.0 (X11; Linux x86_64) Chrome/126.0.0.0 Safari/537.36", viewport: "1440x900", language: "en-MY" },
      lastError: "Error: boom ali@example.com",
    });
    expect(f.title).not.toContain("900101");
    expect(f.description.length).toBe(2000);
    expect(f.page).toBe("/patients/:id/edit");
    expect(f.browser.name).toBe("Chrome 126 / Linux");
    expect(f.lastError).not.toContain("ali@");
    expect(JSON.stringify(f)).not.toContain("Mozilla");
  });
  test("browser summary handles unknown", () => {
    expect(summariseBrowser(undefined)).toBe("Unknown browser / Unknown OS");
  });
});

describe("feature request dedupe key", () => {
  test("same request in different wording/order/case dedupes, per clinic", () => {
    expect(normalizeRequestKey("Add dark mode!")).toBe(normalizeRequestKey("mode DARK"));
    expect(featureDedupeKey("demo", "Dark mode")).toBe(featureDedupeKey("demo", "dark  MODE."));
    expect(featureDedupeKey("demo", "Dark mode")).not.toBe(featureDedupeKey("clinicb", "Dark mode"));
    expect(featureDedupeKey("demo", "Dark mode")).not.toBe(featureDedupeKey("demo", "Light mode"));
  });
});

// Minimal in-memory Medplum fake supporting what the service uses.
function fakeMedplum() {
  const rows: Basic[] = [];
  let n = 0;
  const idKey = (r: Basic) => r.identifier?.find((i) => i.system?.includes("dedupe"))?.value;
  const m: any = {
    rows,
    searchOne: async (_t: string, q: { identifier: string }) => rows.find((r) => `${r.identifier?.find((i) => i.system?.includes("dedupe"))?.system}|${idKey(r)}` === q.identifier),
    createResourceIfNoneExist: async (r: Basic, q: string) => {
      const found = rows.find((x) => q.endsWith(`|${idKey(x)}`));
      if (found) return found;
      const c = { ...r, id: `b${++n}`, meta: { versionId: "1" } }; rows.push(c); return c;
    },
    createResource: async (r: Basic) => { const c = { ...r, id: `b${++n}`, meta: { versionId: "1" } }; rows.push(c); return c; },
    readResource: async (_t: string, id: string) => rows.find((r) => r.id === id),
    updateResource: async (r: Basic) => { const i = rows.findIndex((x) => x.id === r.id); rows[i] = r; return r; },
  };
  return m;
}
const clean = (title: string) => sanitizeFeedback({ kind: "feature", title, description: "d" });

describe("feature request storage", () => {
  test("first request creates, other staff merge into a requester count, same staff not double counted", async () => {
    const m = fakeMedplum();
    const a = await storeFeatureRequest(m, "demo", "pracA", clean("Dark mode"));
    expect(a).toMatchObject({ status: "created", requesterCount: 1 });
    const b = await storeFeatureRequest(m, "demo", "pracB", clean("mode dark please"));
    expect(b).toMatchObject({ status: "merged", requesterCount: 2 });
    const again = await storeFeatureRequest(m, "demo", "pracB", clean("Dark mode"));
    expect(again).toMatchObject({ status: "already-counted", requesterCount: 2 });
    expect(m.rows).toHaveLength(1);
    expect(getRequesterCount(m.rows[0])).toBe(2);
  });
  test("clinics never share a record and requester ids are stored hashed", async () => {
    const m = fakeMedplum();
    await storeFeatureRequest(m, "demo", "pracA", clean("Dark mode"));
    await storeFeatureRequest(m, "clinicb", "pracA", clean("Dark mode"));
    expect(m.rows).toHaveLength(2);
    expect(m.rows.map((r: Basic) => r.identifier![0].value).sort()).toEqual(["clinicb", "demo"]);
    expect(JSON.stringify(m.rows)).not.toContain("pracA");
    expect(requesterHash("demo", "pracA")).not.toBe(requesterHash("clinicb", "pracA"));
  });
});

describe("bug -> GitHub issue", () => {
  const bug = sanitizeFeedback({ kind: "bug", title: "Save fails", description: "Patient name: Ali Tan, IC 900101-14-5678", page: "/patients/12345678", lastError: "Error: x" });
  test("issue is labelled bug and carries no patient data", () => {
    const issue = buildIssue("demo", bug, false);
    expect(issue.labels).toContain("bug");
    expect(issue.body).toContain("`demo`");
    expect(issue.body).toContain("fake data only");
    expect(issue.body + issue.title).not.toMatch(/Ali Tan|900101/);
  });
  test("posts to GitHub with token and returns the issue url", async () => {
    let seen: any;
    const fetchImpl = (async (url: string, init: any) => {
      seen = { url, init };
      return { ok: true, status: 201, json: async () => ({ html_url: "https://github.com/Iatrum/UCC/issues/1" }) };
    }) as any;
    const r = await submitBug(fakeMedplum(), "demo", bug, true, { token: "t", fetchImpl });
    expect(r).toEqual({ kind: "bug", status: "issue-created", issueUrl: "https://github.com/Iatrum/UCC/issues/1" });
    expect(seen.url).toBe("https://api.github.com/repos/Iatrum/UCC/issues");
    expect(JSON.parse(seen.init.body).labels).toContain("bug");
    expect(seen.init.body).not.toMatch(/Ali Tan|900101/);
  });
  test("no token or GitHub failure queues a sanitized record instead of losing the bug", async () => {
    const m = fakeMedplum();
    const original = process.env.GITHUB_FEEDBACK_TOKEN; delete process.env.GITHUB_FEEDBACK_TOKEN;
    const r1 = await submitBug(m, "demo", bug, false, {});
    const r2 = await submitBug(m, "demo", bug, false, { token: "t", fetchImpl: (async () => ({ ok: false, status: 500 })) as any });
    if (original) process.env.GITHUB_FEEDBACK_TOKEN = original;
    expect(r1.status).toBe("queued"); expect(r2.status).toBe("queued");
    expect(m.rows).toHaveLength(2);
    expect(JSON.stringify(m.rows)).not.toMatch(/Ali Tan|900101/);
  });
});

describe("screenshot validation", () => {
  const png = "data:image/png;base64," + Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]).toString("base64");
  test("accepts real png, rejects mismatched, non-image and oversize", () => {
    expect(parseScreenshot(png)?.contentType).toBe("image/png");
    expect(parseScreenshot(png.replace("image/png", "image/jpeg"))).toBeNull();
    expect(parseScreenshot("data:text/html;base64,PGI+")).toBeNull();
    expect(parseScreenshot("data:image/png;base64," + Buffer.alloc(1_000_001, 0x89).toString("base64"))).toBeNull();
  });
});

describe("feedback module toggle", () => {
  test("known toggle, default off, opt-in only", () => {
    expect(KNOWN_BRANCH_MODULE_IDS).toContain("feedback");
    expect(DEFAULT_BRANCH_ENABLED_MODULE_IDS).not.toContain("feedback");
    expect(getEnabledModuleIdsFromOrganization({ resourceType: "Organization" })).not.toContain("feedback");
    expect(normalizeEnabledModuleIds(["feedback"])).toEqual(["feedback"]);
  });
});
