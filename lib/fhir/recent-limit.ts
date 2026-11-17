export const RECENT_CONSULTATIONS_DEFAULT = 10;
export const RECENT_CONSULTATIONS_MAX = 50;

/** Parse the `recent=` query value into a safe limit: default 10, min 1, max 50. */
export function clampRecentLimit(raw: string | null | undefined): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(parsed) || parsed === 0) return RECENT_CONSULTATIONS_DEFAULT;
  return Math.min(Math.max(parsed, 1), RECENT_CONSULTATIONS_MAX);
}
