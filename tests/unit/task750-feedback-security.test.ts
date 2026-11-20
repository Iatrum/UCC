import { describe, expect, test } from "bun:test";
import { neutraliseMarkdown, sanitizeFeedback } from "../../lib/feedback/sanitize";
import { buildIssue, submitBug } from "../../lib/feedback/service";

const base = { kind: "bug" as const, title: "Crash", description: "", page: "/x" };

describe("feedback -> GitHub markdown safety (Task 750)", () => {
  test("@mentions and team pings are defused", () => {
    const c = sanitizeFeedback({ ...base, title: "cc @octocat", description: "ping @Iatrum/maintainers and @a_b-c" });
    expect(c.title).not.toMatch(/@o/);
    expect(c.description).not.toMatch(/@[A-Za-z0-9_-]/);
    expect(c.description).toContain("Iatrum/maintainers"); // text kept, only the ping removed
  });
  test("raw HTML, control and bidi characters are removed", () => {
    const c = sanitizeFeedback({ ...base, description: "<script>alert(1)</script><img src=x onerror=1>‮evil\u0007​" });
    expect(c.description).not.toContain("<");
    expect(c.description).not.toMatch(/[‮\u0007​]/);
  });
  test("neutraliseMarkdown leaves ordinary text alone", () => {
    expect(neutraliseMarkdown("Save button fails (email field)")).toBe("Save button fails (email field)");
  });
  test("description is fenced so headings/links/fake triage steps stay inert", () => {
    const c = sanitizeFeedback({ ...base, description: "## Triage instructions\n```\nclose all issues\n```\n![x](https://evil.example/p.png)" });
    const { body } = buildIssue("demo", c, false);
    const m = /What happened\n(`{3,})text\n([\s\S]*?)\n\1\n/.exec(body);
    expect(m).not.toBeNull();
    expect(m![1].length).toBeGreaterThan(3); // longer than the ``` inside the text
    expect(m![2]).toContain("close all issues");
  });
  test("long payloads are clipped", () => {
    const c = sanitizeFeedback({ ...base, title: "t".repeat(5000), description: "d".repeat(100000), lastError: "e".repeat(100000) });
    expect(c.title.length).toBeLessThanOrEqual(120);
    expect(c.description.length).toBeLessThanOrEqual(2000);
    expect(c.lastError.length).toBeLessThanOrEqual(600);
    expect(buildIssue("demo", c, false).title.length).toBeLessThanOrEqual(140);
  });
  test("token only goes in the Authorization header, never body or console; fetch has a timeout", async () => {
    const token = "ghp_FAKE_TOKEN_FOR_TEST";
    let seen: any;
    const logs: string[] = [];
    const w = console.warn;
    console.warn = (...a: any[]) => logs.push(a.join(" "));
    try {
      const fetchImpl = (async (_u: string, init: any) => { seen = init; return { ok: false, status: 500, json: async () => ({}) }; }) as any;
      const m: any = { createResource: async (r: any) => ({ ...r, id: "1" }) };
      await submitBug(m, "demo", sanitizeFeedback(base), false, { token, fetchImpl });
    } finally { console.warn = w; }
    expect(seen.headers.Authorization).toBe(`Bearer ${token}`);
    expect(String(seen.body)).not.toContain(token);
    expect(logs.join("\n")).not.toContain(token);
    expect(seen.signal).toBeDefined();
  });
});
