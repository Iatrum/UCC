import { describe, expect, test } from "bun:test";
import { resolveOrganizationDetails } from "../../lib/org";

// Task 605: the Documents tab (MC / Time Chit / referral) must never print a blank letterhead
// because it was opened before the organization fetch finished or after it failed.
describe("resolveOrganizationDetails", () => {
  test("uses the already loaded organization without fetching", async () => {
    let calls = 0;
    const org = await resolveOrganizationDetails({ name: "Klinik Bravo" }, async () => { calls++; return { name: "Other" }; });
    expect(org?.name).toBe("Klinik Bravo");
    expect(calls).toBe(0);
  });
  test("fetches when the page state is still empty", async () => {
    const org = await resolveOrganizationDetails(null, async () => ({ name: "Klinik Bravo", phone: "03-1" }));
    expect(org).toEqual({ name: "Klinik Bravo", phone: "03-1" });
  });
  test("stays null when the fetch fails (default template renders without a letterhead)", async () => {
    expect(await resolveOrganizationDetails(null, async () => null)).toBeNull();
  });
});
