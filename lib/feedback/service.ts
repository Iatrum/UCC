// Storage + GitHub hand-off for the in-app Feedback feature.
// Input MUST already be sanitized (lib/feedback/sanitize.ts); this module never sees raw patient text.
import { createHash } from "node:crypto";
import type { Basic, Extension } from "@medplum/fhirtypes";
import type { MedplumClient } from "@medplum/core";
import { getAdminMedplum } from "@/lib/server/medplum-admin";
import { normalizeRequestKey, type SanitizedFeedback } from "./sanitize";

export const FEEDBACK_KIND_SYSTEM = "https://ucc.emr/feedback/kind";
export const FEEDBACK_DEDUPE_SYSTEM = "https://ucc.emr/feedback/dedupe-key";
const EXT = "https://ucc.emr/feedback/";

export const DEFAULT_GITHUB_REPO = "Iatrum/UCC";

export type FeedbackResult =
  | { kind: "bug"; status: "issue-created"; issueUrl: string }
  | { kind: "bug"; status: "queued"; recordId: string }
  | { kind: "feature"; status: "created" | "merged" | "already-counted"; recordId: string; requesterCount: number };

export function requesterHash(clinicId: string, profileId: string): string {
  return createHash("sha256").update(`${clinicId}:${profileId}`).digest("hex").slice(0, 16);
}

export function featureDedupeKey(clinicId: string, title: string): string {
  const hash = createHash("sha256").update(normalizeRequestKey(title)).digest("hex").slice(0, 24);
  return `${clinicId}:${hash}`;
}

const str = (url: string, v: string | undefined): Extension[] => (v ? [{ url: EXT + url, valueString: v }] : []);

function baseRecord(kind: "bug" | "feature-request", clinicId: string, f: SanitizedFeedback): Basic {
  return {
    resourceType: "Basic",
    code: { coding: [{ system: FEEDBACK_KIND_SYSTEM, code: kind }] },
    created: new Date().toISOString().slice(0, 10),
    identifier: [{ system: "clinic", value: clinicId }],
    extension: [
      ...str("title", f.title),
      ...str("description", f.description),
      ...str("page", f.page),
      ...str("browser", `${f.browser.name}; ${f.browser.viewport}; ${f.browser.language}`),
      ...str("last-error", f.lastError),
    ],
  };
}

export function getRequesterHashes(record: Basic): string[] {
  return (record.extension ?? []).filter((e) => e.url === EXT + "requester" && e.valueString).map((e) => e.valueString!);
}
export const getRequesterCount = (record: Basic) => getRequesterHashes(record).length;

/** Store a feature request: one record per (clinic, normalized title); repeat requests add a requester. */
export async function storeFeatureRequest(
  medplum: MedplumClient,
  clinicId: string,
  profileId: string,
  f: SanitizedFeedback
): Promise<FeedbackResult> {
  const key = featureDedupeKey(clinicId, f.title);
  const me = requesterHash(clinicId, profileId);
  const resource: Basic = baseRecord("feature-request", clinicId, f);
  resource.identifier!.push({ system: FEEDBACK_DEDUPE_SYSTEM, value: key });
  resource.extension!.push({ url: EXT + "requester", valueString: me });

  const existing = await medplum.searchOne("Basic", { identifier: `${FEEDBACK_DEDUPE_SYSTEM}|${key}` }, { cache: "no-cache" });
  // Conditional create is atomic on the identifier, so two simultaneous identical requests cannot fork.
  let record =
    existing ??
    (await medplum.createResourceIfNoneExist<Basic>(resource, `identifier=${FEEDBACK_DEDUPE_SYSTEM}|${key}`));
  if (!existing && getRequesterHashes(record).length === 1 && getRequesterHashes(record)[0] === me) {
    return { kind: "feature", status: "created", recordId: record.id!, requesterCount: 1 };
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    if (getRequesterHashes(record).includes(me)) {
      return { kind: "feature", status: "already-counted", recordId: record.id!, requesterCount: getRequesterCount(record) };
    }
    const next: Basic = { ...record, extension: [...(record.extension ?? []), { url: EXT + "requester", valueString: me }] };
    try {
      const saved = await medplum.updateResource<Basic>(next, versionHeaders(record));
      return { kind: "feature", status: "merged", recordId: saved.id!, requesterCount: getRequesterCount(saved) };
    } catch (error) {
      if (attempt === 2) throw error;
      record = await medplum.readResource("Basic", record.id!, { cache: "no-cache" });
    }
  }
  throw new Error("unreachable");
}

function versionHeaders(record: Basic) {
  return record.meta?.versionId ? { headers: { "If-Match": `W/"${record.meta.versionId}"` } } : undefined;
}

export type GithubConfig = { token?: string; repo?: string; fetchImpl?: typeof fetch };

export function buildIssue(clinicId: string, f: SanitizedFeedback, hasScreenshot: boolean) {
  const body = [
    "_Submitted via in-app Feedback. All patient identifiers were scrubbed (PDPA) before sending._",
    "",
    "## What happened",
    f.description || "_(no description)_",
    "",
    "## Auto-captured context",
    `- **Page:** \`${f.page}\``,
    `- **Clinic:** \`${clinicId}\``,
    `- **Browser:** ${f.browser.name}; viewport ${f.browser.viewport}; lang ${f.browser.language}`,
    `- **Screenshot:** ${hasScreenshot ? "attached by reporter (kept in the clinic record, NOT uploaded to GitHub)" : "none"}`,
    "",
    "## Last client error",
    f.lastError ? "```\n" + f.lastError.replace(/```/g, "'''") + "\n```" : "_none captured_",
    "",
    "## Triage instructions (AI/human)",
    "1. Reproduce using **fake data only** — never real patient data.",
    "2. If reproducible: fix and open a draft PR into `dev`.",
    "3. If not reproducible: label `needs-info` and ask the reporter for steps.",
  ].join("\n");
  return { title: `[Feedback bug] ${f.title}`.slice(0, 140), body, labels: ["bug", "from-feedback-form"] };
}

/** Bugs go to GitHub; if the token is missing or GitHub fails, queue a sanitized record so nothing is lost. */
export async function submitBug(
  medplum: MedplumClient,
  clinicId: string,
  f: SanitizedFeedback,
  hasScreenshot: boolean,
  gh: GithubConfig = {}
): Promise<FeedbackResult> {
  const token = gh.token ?? process.env.GITHUB_FEEDBACK_TOKEN;
  const repo = gh.repo ?? process.env.GITHUB_FEEDBACK_REPO ?? DEFAULT_GITHUB_REPO;
  if (token && /^[\w.-]+\/[\w.-]+$/.test(repo)) {
    try {
      const res = await (gh.fetchImpl ?? fetch)(`https://api.github.com/repos/${repo}/issues`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "ucc-feedback",
        },
        body: JSON.stringify(buildIssue(clinicId, f, hasScreenshot)),
      });
      if (res.ok) {
        const data = (await res.json()) as { html_url?: string };
        if (data.html_url) return { kind: "bug", status: "issue-created", issueUrl: data.html_url };
      }
      console.warn("[feedback] GitHub issue creation failed, queueing locally:", res.status);
    } catch {
      console.warn("[feedback] GitHub issue creation threw, queueing locally");
    }
  }
  const recordId = await saveBugRecord(medplum, clinicId, f, "queued");
  return { kind: "bug", status: "queued", recordId };
}

/** Sanitized local copy of a bug (queue when GitHub is unavailable, or home for a screenshot). */
export async function saveBugRecord(medplum: MedplumClient, clinicId: string, f: SanitizedFeedback, status: string, issueUrl?: string) {
  const record = baseRecord("bug", clinicId, f);
  record.extension!.push(...str("status", status), ...str("issue-url", issueUrl));
  return (await medplum.createResource<Basic>(record)).id!;
}

const SCREENSHOT_MAX_BYTES = 1_000_000;

/** Validate a base64 data URL as a real PNG/JPEG within the size cap. Returns null when invalid. */
export function parseScreenshot(dataUrl: unknown): { contentType: string; data: Buffer } | null {
  if (typeof dataUrl !== "string") return null;
  // Reject oversized strings before running the regex or decoding (base64 is ~4/3 of the bytes).
  if (dataUrl.length > Math.ceil((SCREENSHOT_MAX_BYTES * 4) / 3) + 64) return null;
  const m = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) return null;
  const data = Buffer.from(m[2], "base64");
  if (data.length === 0 || data.length > SCREENSHOT_MAX_BYTES) return null;
  const png = data.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const jpg = data.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
  if ((m[1] === "image/png" && !png) || (m[1] === "image/jpeg" && !jpg)) return null;
  return { contentType: m[1], data };
}

/** Screenshots can contain patient data we cannot strip, so they stay in the clinic-scoped record only. */
export async function attachScreenshot(medplum: MedplumClient, recordId: string, shot: { contentType: string; data: Buffer }) {
  const binary = await medplum.createBinary(shot.data, "feedback-screenshot", shot.contentType);
  const record = await medplum.readResource("Basic", recordId, { cache: "no-cache" });
  await medplum.updateResource<Basic>({
    ...record,
    extension: [...(record.extension ?? []), { url: EXT + "screenshot", valueAttachment: { contentType: shot.contentType, url: `Binary/${binary.id}` } }],
  });
}

/** Server directory client for feedback records (product data; staff policies grant no Basic access). Always scope by the authenticated clinicId. */
export const getFeedbackMedplum = () => getAdminMedplum();
