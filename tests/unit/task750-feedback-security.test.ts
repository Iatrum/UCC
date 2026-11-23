import { describe, expect, test } from "bun:test";
import type { MedplumClient } from "@medplum/core";
import type { Basic } from "@medplum/fhirtypes";
import { neutraliseMarkdown, sanitizeFeedback } from "../../lib/feedback/sanitize";
import { buildIssue, submitBug } from "../../lib/feedback/service";

const base = { kind: "bug" as const, title: "Crash", description: "", page: "/x" };

describe("feedback -> GitHub markdown safety (Task 750)", () => {
  test("@mentions and team pings are defused", () => {
    const c = sanitizeFeedback({ ...base, title: "cc @octocat", description: "ping @Iatrum/maintainers and @a_b-c" });
    expect(buildIssue("demo", c, false).title).toBe("[Feedback bug] cc ＠octocat");
    expect(c.description).not.toMatch(/@[A-Za-z0-9_-]/);
    expect(c.description).toContain("Iatrum/maintainers"); // text kept, only the ping removed
  });
  test("raw HTML, control and bidi characters are removed", () => {
    const c = sanitizeFeedback({ ...base, description: "Unexpected <tag>\u202E text\u0007\u200B" });
    expect(c.description).not.toContain("<");
    expect(c.description).toBe("Unexpected ‹tag> text");
  });
  test("neutraliseMarkdown leaves ordinary text alone", () => {
    expect(neutraliseMarkdown("Save button fails (email field)")).toBe("Save button fails (email field)");
  });
  test("browser metadata only accepts strings with the expected shape", () => {
    const c = sanitizeFeedback({ ...base, browser: { viewport: ["1440x900"], language: { toString: "en-MY" } } });
    expect(c.browser).toMatchObject({ viewport: "unknown", language: "unknown" });
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
    let seen: RequestInit | undefined;
    const logs: string[] = [];
    const w = console.warn;
    console.warn = (...values: unknown[]) => logs.push(values.join(" "));
    try {
      const fetchImpl = (async (_url, init) => {
        seen = init;
        throw new Error(token);
      }) satisfies typeof fetch;
      const medplum = { createResource: async (record: Basic) => ({ ...record, id: "1" }) } as unknown as MedplumClient;
      const result = await submitBug(medplum, "demo", sanitizeFeedback(base), false, { token, fetchImpl, repo: "Iatrum/UCC" });
      expect(result).toEqual({ kind: "bug", status: "queued", recordId: "1" });
    } finally { console.warn = w; }
    expect(new Headers(seen?.headers).get("Authorization")).toBe(`Bearer ${token}`);
    expect(String(seen?.body)).not.toContain(token);
    expect(logs.join("\n")).not.toContain(token);
    expect(seen?.signal).toBeInstanceOf(AbortSignal);
  });
});
