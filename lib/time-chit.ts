/** Shared same-day attendance validation; never accept a client-supplied duration. */
export function timeChitHours(timeIn: string, timeOut: string): string | null {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(timeIn) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(timeOut)) return null;
  const minutes = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
  const duration = minutes(timeOut) - minutes(timeIn);
  return duration > 0 ? String(Math.round(duration / 60 * 100) / 100) : null;
}

export function timeChitError(details: Record<string, unknown>): string | null {
  const date = String(details.tcDate || "");
  const parsed = new Date(`${date}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date)
    return "Enter a valid attendance date.";
  if (!timeChitHours(String(details.tcTimeIn || ""), String(details.tcTimeOut || "")))
    return "Time out must be after time in on the same day.";
  if (typeof details.tcDoctorName !== "string" || !details.tcDoctorName.trim()) return "Enter the doctor's name.";
  return null;
}

export function isTimeChitProcedure(proc: { notes?: string; procedureId?: string; name?: string }): boolean {
  if (proc.procedureId === "letter-time-chit") return true;
  try { return JSON.parse(proc.notes || "{}").kind === "time-chit"; } catch { return false; }
}

export function fillTimeChitTemplate(html: string, data: Record<string, string>): string {
  const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
  return html.replace(/\{\{(\w+)\}\}/g, (placeholder, key: string) => key in data ? escape(data[key]) : placeholder);
}
