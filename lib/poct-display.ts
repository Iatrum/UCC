// Display-only wording for POCT orders (no behaviour). FHIR ServiceRequest.status
// "active" means the test is ordered and still waiting for the analyser result.
const STATUS_LABELS: Record<string, string> = {
  active: "Pending",
  draft: "Draft",
  completed: "Completed",
  revoked: "Cancelled",
  "entered-in-error": "Entered in error",
  "on-hold": "On hold",
  unknown: "Unknown",
};

export function poctStatusLabel(status?: string): string {
  if (!status) return "Pending";
  return STATUS_LABELS[status] ?? status;
}

/** Ordered date, falling back to last-updated; "—" only when neither exists or is valid. */
export function poctOrderDateLabel(order: { authoredOn?: string; updatedAt?: string }): string {
  for (const iso of [order.authoredOn, order.updatedAt]) {
    if (!iso) continue;
    const d = new Date(iso);
    if (!Number.isNaN(d.getTime())) return d.toLocaleString();
  }
  return "—";
}
