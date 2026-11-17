/** Date-range helpers for Analytics. All buckets use the clinic calendar (Asia/Kuala_Lumpur, UTC+8, no DST). */

export type RangeKey = "today" | "7d" | "30d" | "month";
export const RANGE_KEYS: RangeKey[] = ["today", "7d", "30d", "month"];
export const RANGE_LABELS: Record<RangeKey, string> = {
  today: "Hari ini",
  "7d": "7 hari",
  "30d": "30 hari",
  month: "Bulan ini",
};

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const MYT_OFFSET = 8 * HOUR;

export function parseRange(value: unknown): RangeKey {
  return RANGE_KEYS.includes(value as RangeKey) ? (value as RangeKey) : "7d";
}

/** Shift to MYT wall-clock so UTC getters read the clinic-local parts. */
const shifted = (d: Date) => new Date(d.getTime() + MYT_OFFSET);

export function mytYmd(d: Date): string {
  return shifted(d).toISOString().slice(0, 10);
}
export function mytHour(d: Date): number {
  return shifted(d).getUTCHours();
}
/** 0 = Monday ... 6 = Sunday (Malaysian week order). */
export function mytWeekday(d: Date): number {
  return (shifted(d).getUTCDay() + 6) % 7;
}
export function mytDayStart(d: Date): Date {
  const s = shifted(d);
  return new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate()) - MYT_OFFSET);
}
export function mytMonthStart(d: Date, monthsBack = 0): Date {
  const s = shifted(d);
  return new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() - monthsBack, 1) - MYT_OFFSET);
}
export function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * DAY);
}

export type ResolvedRange = {
  key: RangeKey;
  from: Date;
  /** Exclusive end (start of tomorrow, MYT). */
  to: Date;
  days: number;
  prevFrom: Date;
  prevTo: Date;
};

export function resolveRange(key: RangeKey, now: Date = new Date()): ResolvedRange {
  const today = mytDayStart(now);
  const to = addDays(today, 1);
  const from =
    key === "today" ? today : key === "7d" ? addDays(today, -6) : key === "30d" ? addDays(today, -29) : mytMonthStart(now);
  const days = Math.round((to.getTime() - from.getTime()) / DAY);
  return { key, from, to, days, prevFrom: addDays(from, -days), prevTo: from };
}

/** Consecutive MYT day keys in [from, to). */
export function dayKeys(from: Date, to: Date): string[] {
  const out: string[] = [];
  for (let d = from; d < to; d = addDays(d, 1)) out.push(mytYmd(d));
  return out;
}

/** Short Malay label for a YYYY-MM-DD key, e.g. "17 Nov". */
const MONTHS = ["Jan", "Feb", "Mac", "Apr", "Mei", "Jun", "Jul", "Ogo", "Sep", "Okt", "Nov", "Dis"];
export function dayLabel(ymd: string): string {
  return `${Number(ymd.slice(8, 10))} ${MONTHS[Number(ymd.slice(5, 7)) - 1]}`;
}
export function monthLabel(d: Date): string {
  const s = shifted(d);
  return `${MONTHS[s.getUTCMonth()]}`;
}
export const WEEKDAY_LABELS = ["Isn", "Sel", "Rab", "Kha", "Jum", "Sab", "Ahd"];
