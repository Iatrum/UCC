// Pure helpers for the patient profile history panel (Task 446).

export type HistoryConsultationLike = {
  id?: string;
  date?: string | null;
};

/**
 * Add a just-signed consultation to the list the server gave us, unless the
 * server list already has it. Lets the history show the row immediately after
 * Sign, before router.refresh() has returned fresh data.
 */
export function withSignedConsultation<T extends HistoryConsultationLike>(
  consultations: T[],
  signed: (T & { id: string }) | null
): T[] {
  if (!signed) return consultations;
  if (consultations.some((consultation) => consultation.id === signed.id)) return consultations;
  return [signed, ...consultations];
}

/** The empty-state "Start consult" button is pointless while the drawer is already open. */
export function shouldShowStartConsultButton(panelOpen: boolean): boolean {
  return !panelOpen;
}

/**
 * Signed consults are not completed visits (billing may still be pending), so
 * the profile header reports consults, not "completed visits".
 */
export function consultSummary(consultations: HistoryConsultationLike[]): {
  total: number;
  lastDate: string | null;
} {
  let lastDate: string | null = null;
  let lastTime = Number.NEGATIVE_INFINITY;
  for (const consultation of consultations) {
    if (!consultation.date) continue;
    const time = new Date(consultation.date).getTime();
    if (Number.isNaN(time)) continue;
    if (time > lastTime) {
      lastTime = time;
      lastDate = consultation.date;
    }
  }
  return { total: consultations.length, lastDate };
}
