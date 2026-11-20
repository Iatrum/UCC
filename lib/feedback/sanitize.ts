// PDPA scrubbing for the in-app Feedback feature. Pure functions, no I/O.
// Best-effort pattern redaction of free text + strict allow-listing of what we capture automatically.
// Anything that could identify a patient is replaced BEFORE it is stored or sent to GitHub.

export const REDACTED = {
  ic: "[REDACTED-IC]",
  email: "[REDACTED-EMAIL]",
  phone: "[REDACTED-PHONE]",
  number: "[REDACTED-NUMBER]",
  name: "[REDACTED-NAME]",
  id: ":id",
} as const;

// Malaysian NRIC: YYMMDD-PB-###G, with or without dashes/spaces.
const IC_RE = /\b\d{6}[-\s]?\d{2}[-\s]?\d{4}\b/g;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
// Malaysian + international phone numbers (+60 12-345 6789, 012-3456789, 03-12345678, +65 ...).
const PHONE_RE = /(?<![\w])(?:\+?\d{1,3}[-\s]?)?\(?0?\d{1,2}\)?[-\s]?\d{3,4}[-\s]?\d{3,4}(?![\w])/g;
// Passport-like / MRN-like / any 6+ digit run, and ID-ish tokens with letters+digits (e.g. A1234567, MRN-00123).
const LONG_DIGITS_RE = /\b\d{6,}\b/g;
const ALNUM_ID_RE = /\b(?:[A-Z]{1,3}[-_]?\d{5,}|\d{5,}[-_]?[A-Z]{1,3})\b/gi;
const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
// Labelled names: "patient name: Ali bin Abu", "name is Tan Mei Ling", "pt John Tan".
const LABELLED_NAME_RE =
  /\b(?:patient(?:'s)?(?:\s+name)?|pt|name|nama|nric|ic|mrn|dob|address|alamat)\s*(?:[:=\-]|is|ialah)\s*[^\n,;.]{1,60}/gi;
const HONORIFICS = ["mr", "mrs", "ms", "miss", "mdm", "madam", "encik", "puan", "cik", "tuan", "dato'?", "datin", "tan sri", "dr", "prof", "pn", "en"];
// Titles are case-insensitive (first letter), but the name that follows must be capitalised.
const HONORIFIC_NAME_RE = new RegExp(
  `\\b(?:${HONORIFICS.map((h) => `[${h[0].toUpperCase()}${h[0]}]${h.slice(1)}`).join("|")})\\.?\\s+(?:[A-Z][\\p{L}'’-]+)(?:\\s+(?:bin|binti|bt|b\\.|a\\/l|a\\/p|s\\/o|d\\/o)?\\s*[A-Z][\\p{L}'’-]+){0,3}`,
  "gu"
);
const BIN_BINTI_RE = /\b[A-Z][\p{L}'’-]+(?:\s+[A-Z][\p{L}'’-]+)?\s+(?:bin|binti|bte|bt|a\/l|a\/p|s\/o|d\/o)\s+[A-Z][\p{L}'’-]+(?:\s+[A-Z][\p{L}'’-]+)?/gu;
const URL_RE = /\bhttps?:\/\/[^\s)'"<>]+/gi;

/** Scrub free text. `extraTerms` lets callers also redact known names/identifiers verbatim. */
export function scrubText(input: unknown, extraTerms: string[] = []): string {
  let text = typeof input === "string" ? input : "";
  text = text.replace(/\u0000/g, "");
  // URLs: keep path shape, drop query/hash, normalise ids.
  text = text.replace(URL_RE, (url) => scrubUrl(url));
  for (const term of extraTerms) {
    const t = term.trim();
    if (t.length >= 3) text = text.replace(new RegExp(escapeRegExp(t), "gi"), REDACTED.name);
  }
  text = text
    .replace(LABELLED_NAME_RE, (m) => `${m.split(/[:=\-]|\bis\b|\bialah\b/i)[0].trim()}: ${REDACTED.name}`)
    .replace(HONORIFIC_NAME_RE, REDACTED.name)
    .replace(BIN_BINTI_RE, REDACTED.name)
    .replace(EMAIL_RE, REDACTED.email)
    .replace(IC_RE, REDACTED.ic)
    .replace(UUID_RE, REDACTED.id)
    .replace(ALNUM_ID_RE, REDACTED.number)
    .replace(PHONE_RE, (m) => (m.replace(/\D/g, "").length >= 8 ? REDACTED.phone : m))
    .replace(LONG_DIGITS_RE, REDACTED.number);
  return text;
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Reduce a URL/path to its route shape: no origin query/hash, dynamic segments -> ":id". */
export function scrubUrl(input: unknown): string {
  let raw = typeof input === "string" ? input.trim() : "";
  raw = raw.replace(/^https?:\/\/[^/]+/i, "");
  raw = raw.split("#")[0].split("?")[0];
  if (!raw.startsWith("/")) raw = `/${raw}`;
  const segments = raw
    .split("/")
    .map((seg) => {
      if (!seg) return seg;
      let decoded = seg;
      try { decoded = decodeURIComponent(seg); } catch { /* keep raw */ }
      if (/^[a-z][a-z-]{0,30}$/i.test(decoded) && !/\d/.test(decoded)) return decoded.toLowerCase();
      return REDACTED.id;
    });
  return segments.join("/").slice(0, 200) || "/";
}

export function scrubError(input: unknown): string {
  const raw = typeof input === "string" ? input : "";
  // Keep only the message + first few stack frames; stacks may embed data in messages.
  const trimmed = raw.split("\n").slice(0, 6).join("\n").slice(0, 600);
  return scrubText(trimmed);
}

const clip = (s: unknown, n: number) => (typeof s === "string" ? s.slice(0, n) : "");

/**
 * Drop control and bidi formatting characters, and defuse GitHub mentions and raw HTML.
 * Keep joiners used by emoji and natural-language text. Applied after PDPA scrubbing.
 */
export function neutraliseMarkdown(input: string): string {
  return input
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B\u200E\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g, "")
    .replace(/@(?=[A-Za-z0-9_-])/g, "\uFF20")
    .replace(/</g, "\u2039");
}

export type FeedbackKind = "bug" | "feature";

export type FeedbackInput = {
  kind: FeedbackKind;
  title: unknown;
  description: unknown;
  page?: unknown;
  browser?: { userAgent?: unknown; viewport?: unknown; language?: unknown } | null;
  lastError?: unknown;
};

export type SanitizedFeedback = {
  kind: FeedbackKind;
  title: string;
  description: string;
  page: string;
  browser: { name: string; viewport: string; language: string };
  lastError: string;
};

/** Reduce a User-Agent to "Chrome 126 / Linux"-style text; never keeps the raw string. */
export function summariseBrowser(ua: unknown): string {
  const s = typeof ua === "string" ? ua : "";
  const browser =
    /Edg\/(\d+)/.exec(s)?.[0].replace("Edg/", "Edge ") ??
    /Firefox\/(\d+)/.exec(s)?.[0].replace("/", " ") ??
    (/Chrome\/(\d+)/.exec(s) ? `Chrome ${/Chrome\/(\d+)/.exec(s)![1]}` : undefined) ??
    (/Version\/(\d+).*Safari/.exec(s) ? `Safari ${/Version\/(\d+)/.exec(s)![1]}` : undefined) ??
    "Unknown browser";
  const os = /Windows/.test(s) ? "Windows" : /Android/.test(s) ? "Android" : /iPhone|iPad|iOS/.test(s) ? "iOS" : /Mac OS X/.test(s) ? "macOS" : /Linux/.test(s) ? "Linux" : "Unknown OS";
  return `${browser} / ${os}`;
}

export function sanitizeFeedback(input: FeedbackInput): SanitizedFeedback {
  const { userAgent, viewport, language } = input.browser ?? {};
  return {
    kind: input.kind === "feature" ? "feature" : "bug",
    title: neutraliseMarkdown(scrubText(clip(input.title, 120))).replace(/\s+/g, " ").trim(),
    description: neutraliseMarkdown(scrubText(clip(input.description, 2000))).trim(),
    page: scrubUrl(input.page ?? "/"),
    browser: {
      name: summariseBrowser(userAgent),
      viewport: typeof viewport === "string" && /^\d{2,5}x\d{2,5}$/.test(viewport) ? viewport : "unknown",
      language: typeof language === "string" && /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(language) ? language : "unknown",
    },
    lastError: neutraliseMarkdown(scrubError(clip(input.lastError, 1500))),
  };
}

const STOPWORDS = new Set(["a", "an", "the", "to", "of", "for", "and", "or", "in", "on", "please", "add", "can", "we", "i", "it", "is", "be", "with", "that", "this", "support", "ability"]);

/** Order/punctuation-insensitive key so the same request typed twice dedupes. */
export function normalizeRequestKey(title: string): string {
  const tokens = title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((t) => t && !STOPWORDS.has(t));
  return Array.from(new Set(tokens)).sort().join(" ");
}
