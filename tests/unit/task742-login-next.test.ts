import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { safeNext } from "@/lib/login-redirect";

describe("Task 742: login `next` is same-origin only", () => {
  test.each(["//evil.example", "///evil.example", "/\\evil.example", "/\t/evil.example", "https://evil.example", "evil.example", "/\n/evil.example"])(
    "rejects %j",
    (value) => expect(safeNext(value)).toBeUndefined()
  );

  test.each(["/dashboard", "/patients?x=1", "/admin/users#top"])("keeps %j", (value) => expect(safeNext(value)).toBe(value));

  test("the login route and client both sanitise with safeNext (server must not trust the body)", () => {
    expect(readFileSync("app/api/auth/login/route.ts", "utf8")).toMatch(/safeNext\(rawNext\)/);
    expect(readFileSync("lib/auth-medplum.tsx", "utf8")).toMatch(/safeNext\(payload\.redirectUrl\)/);
  });
});
