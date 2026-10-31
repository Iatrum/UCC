/** Validate a full ISO calendar date without accepting Date's rollover behaviour. */
export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000-")) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function parseMalaysianNricDob(nric: string, currentYear = new Date().getFullYear()): string | null {
  if (!/^(?:\d{12}|\d{6}-\d{2}-\d{4})$/.test(nric)) return null;
  const digits = nric.replace(/-/g, "");
  const yy = Number(digits.slice(0, 2));
  const year = (yy > currentYear % 100 ? 1900 : 2000) + yy;
  const iso = `${year}-${digits.slice(2, 4)}-${digits.slice(4, 6)}`;
  return isIsoDate(iso) ? iso : null;
}

export function formatMalaysianDate(iso: string): string {
  return isIsoDate(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : iso;
}

export function parseMalaysianDate(value: string): string | null {
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(value)) return null;
  const iso = `${value.slice(6, 10)}-${value.slice(3, 5)}-${value.slice(0, 2)}`;
  return isIsoDate(iso) ? iso : null;
}

/** Omit unavailable/invalid DOBs before formatting appointment picker options. */
export function appointmentDob(value: Date | string | null | undefined): string | undefined {
  if (value == null) return undefined;
  if (value instanceof Date && Number.isNaN(value.getTime())) return undefined;
  const iso = typeof value === "string" ? value.slice(0, 10) : value.toISOString().slice(0, 10);
  return isIsoDate(iso) ? iso : undefined;
}

/** Manual edits, including clearing, permanently own this mounted input. */
export function shouldAutofillDob(value: string, lastAuto: string | null, manuallyEdited: boolean): boolean {
  return !manuallyEdited && (!value || value === lastAuto);
}
