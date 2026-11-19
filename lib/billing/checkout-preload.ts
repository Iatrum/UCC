/**
 * Task 684: checkout's three critical reads (order, invoice lookup, draft plan) used to start only after the JS bundle
 * downloaded and hydrated (~450 ms on a production build), then took ~330 ms more. The server page now emits a tiny
 * nonce'd inline script that starts the *same* GET requests at HTML-parse time; the client takes those in-flight
 * promises on first mount instead of issuing its own. Same API routes, same auth/clinic checks, same responses: only
 * the start time moves. Anything unexpected (no preload, other ids, stale, failed) falls back to the normal fetch.
 */

// FHIR R4 `id`: [A-Za-z0-9.-]{1,64}. Kept local so this module stays safe to import from client code.
const SAFE_ID = /^[A-Za-z0-9.-]{1,64}$/;

export const CHECKOUT_PRELOAD_KEY = "__uccCheckoutPreload";
export const CHECKOUT_PRELOAD_MAX_AGE_MS = 15_000;
/** If a preloaded read has not settled in this long, the client abandons it and fetches normally. */
export const CHECKOUT_PRELOAD_WAIT_MS = 8_000;
/** Same 15 s ceiling as fetchWithTimeout (headers AND body): a stalled preloaded body must end in the error + Retry state. */
export const CHECKOUT_PRELOAD_ABORT_MS = 15_000;

export function checkoutOrderUrl(consultationId: string, patientId: string): string {
  return `/api/orders?consultationId=${encodeURIComponent(consultationId)}${patientId ? `&patientId=${encodeURIComponent(patientId)}` : ""}`;
}

export function checkoutInvoiceUrl(consultationId: string): string {
  return `/api/billing?consultationId=${encodeURIComponent(consultationId)}&optional=true`;
}

export function checkoutPlanUrl(patientId: string, consultationId: string): string {
  return `/api/consultations/plan?draftId=${encodeURIComponent(`profile-treatment-${patientId}-${consultationId}`)}&patientId=${encodeURIComponent(patientId)}&consultationId=${encodeURIComponent(consultationId)}`;
}

export type CheckoutPreload = {
  consultationId: string;
  patientId: string;
  startedAt: number;
  order: Promise<Response | null>;
  invoice: Promise<Response | null>;
  plan: Promise<Response | null>;
};

/**
 * Inline script body, or null when the ids are not plain FHIR ids (then nothing is preloaded). Ids are validated against
 * the FHIR id pattern AND embedded via JSON with `<` escaped, so a crafted `?patientId=` cannot break out of the script.
 */
export function checkoutPreloadScript(consultationId: string, patientId: string): string | null {
  if (!SAFE_ID.test(consultationId) || !SAFE_ID.test(patientId)) return null;
  const lit = (v: string) => JSON.stringify(v).replace(/</g, "\\u003c");
  return (
    `(function(){try{var g=function(u,o){o=o||{};try{o.signal=AbortSignal.timeout(${CHECKOUT_PRELOAD_ABORT_MS})}catch(e){}return fetch(u,o).catch(function(){return null})};` +
    `window.${CHECKOUT_PRELOAD_KEY}={consultationId:${lit(consultationId)},patientId:${lit(patientId)},startedAt:Date.now(),` +
    `order:g(${lit(checkoutOrderUrl(consultationId, patientId))}),` +
    `invoice:g(${lit(checkoutInvoiceUrl(consultationId))},{cache:"no-store"}),` +
    `plan:g(${lit(checkoutPlanUrl(patientId, consultationId))},{cache:"no-store"})}}catch(e){}})();`
  );
}

/** Take (and clear) the preload if it belongs to exactly this checkout and is fresh. One-shot: reloads fetch normally. */
export function takeCheckoutPreload(consultationId: string, patientId: string, now = Date.now()): CheckoutPreload | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as Record<string, CheckoutPreload | undefined>;
  const pre = w[CHECKOUT_PRELOAD_KEY];
  if (!pre) return null;
  delete w[CHECKOUT_PRELOAD_KEY];
  if (!patientId || pre.consultationId !== consultationId || pre.patientId !== patientId) return null;
  if (now - pre.startedAt > CHECKOUT_PRELOAD_MAX_AGE_MS) return null;
  return pre;
}

/** Preloaded response if it settles in time and succeeded at the network level; otherwise `fallback()` (a normal fetch). */
export async function preloadedOr(
  preloaded: Promise<Response | null> | undefined,
  fallback: () => Promise<Response>,
  waitMs = CHECKOUT_PRELOAD_WAIT_MS
): Promise<Response> {
  if (!preloaded) return fallback();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const res = await Promise.race([
    preloaded,
    new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), waitMs); }),
  ]);
  clearTimeout(timer);
  return res ?? fallback();
}
