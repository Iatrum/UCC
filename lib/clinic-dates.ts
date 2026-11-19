/**
 * Clinic calendar-day helpers (Asia/Kuala_Lumpur), shared by MC, Time Chit and
 * referral documents. The VPS runs in UTC, so `toISOString().slice(0, 10)` is
 * "yesterday" between 00:00 and 08:00 MYT; never use it for a clinic date.
 *
 * Calendar dates are `YYYY-MM-DD` strings and are handled purely as strings /
 * UTC-noon arithmetic, never via a locally parsed `new Date("YYYY-MM-DD")`.
 * Display format for every clinic document: `dd MMM yyyy` (e.g. "17 Nov 2026").
 */

export const CLINIC_DATE_ZONE = "Asia/Kuala_Lumpur";

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const MYT_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: CLINIC_DATE_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Clinic calendar day (`YYYY-MM-DD`, MYT) of an instant. */
export function clinicDateOf(instant: Date): string {
  const parts = MYT_FORMAT.formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Today's clinic calendar day (`YYYY-MM-DD`, MYT). */
export function clinicToday(now: Date = new Date()): string {
  return clinicDateOf(now);
}

/**
 * Normalise a date-ish value to `YYYY-MM-DD`: a plain date string is kept as the
 * calendar day it names; a Date / ISO datetime is converted to its MYT day.
 */
export function toClinicDate(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    const m = ISO_DATE.exec(trimmed);
    if (m) return isRealDate(Number(m[1]), Number(m[2]), Number(m[3])) ? trimmed : null;
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : clinicDateOf(parsed);
  }
  return Number.isNaN(value.getTime()) ? null : clinicDateOf(value);
}

function isRealDate(y: number, m: number, d: number): boolean {
  const t = new Date(Date.UTC(y, m - 1, d, 12));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** The one clinic document date format: "17 Nov 2026". Empty string when unparseable. */
export function formatClinicDate(value: Date | string | null | undefined): string {
  const iso = toClinicDate(value);
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return `${String(d).padStart(2, "0")} ${MONTHS[m - 1]} ${y}`;
}

/** `YYYY-MM-DD` plus `days` calendar days (timezone independent). */
export function addClinicDays(isoDate: string, days: number): string | null {
  const m = ISO_DATE.exec(isoDate);
  if (!m || !isRealDate(Number(m[1]), Number(m[2]), Number(m[3]))) return null;
  const t = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days, 12));
  return t.toISOString().slice(0, 10);
}

/** Last day of an MC that starts on `startDate` and runs `numDays` days (inclusive). */
export function mcEndDate(startDate: string | null | undefined, numDays: number): string {
  const start = toClinicDate(startDate);
  if (!start || !Number.isFinite(numDays) || !(numDays > 0)) return "";
  // A partial day (0 < n < 1) is a same-day MC; the end date is never before the start.
  const end = addClinicDays(start, Math.max(1, Math.floor(numDays)) - 1);
  return end ? formatClinicDate(end) : "";
}

export function mcDaysLabel(numDays: number | string): string {
  const n = Number(numDays) || 1;
  return `${n} ${n === 1 ? "day" : "days"}`;
}

export function hoursLabel(hours: number | string): string {
  const n = Number(hours);
  if (!Number.isFinite(n) || n <= 0) return hours ? `${hours} hour(s)` : "—";
  return `${n} ${n === 1 ? "hour" : "hours"}`;
}
