/**
 * Every time shown in the app, and every "day" it buckets by, is Taipei time
 * (UTC+8) — decided 2026-09-28. Always go through these helpers:
 *
 * - `toLocaleString()` without a `timeZone` renders in whatever zone the code
 *   runs in: UTC+8 in the browser, but UTC on Vercel when a component renders
 *   on the server. The same row then showed two different times, and client
 *   components flickered on hydration.
 * - `iso.slice(0, 10)` / `getUTC*` give UTC days, which start at 08:00 Taipei.
 *
 * Taipei has no daylight saving, so a fixed +8h offset is exact; the day/week/
 * month keys use that arithmetic because they run in tight loops.
 */

export const TZ = "Asia/Taipei";
export const TZ_LABEL = "UTC+8";
const OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

type TimeInput = string | number | Date;

const toDate = (t: TimeInput) => (t instanceof Date ? t : new Date(t));
const toMs = (t: TimeInput) => toDate(t).getTime();

/** Date + time in Taipei. Same options as toLocaleString; the zone is fixed. */
export function formatDateTime(
  t: TimeInput,
  opts: Intl.DateTimeFormatOptions = {},
  locale = "en-US"
): string {
  return toDate(t).toLocaleString(locale, { ...opts, timeZone: TZ });
}

/** Date only in Taipei. */
export function formatDate(
  t: TimeInput,
  opts: Intl.DateTimeFormatOptions = {},
  locale = "en-US"
): string {
  return toDate(t).toLocaleDateString(locale, { ...opts, timeZone: TZ });
}

/** Time only in Taipei. */
export function formatTime(
  t: TimeInput,
  opts: Intl.DateTimeFormatOptions = {},
  locale = "en-US"
): string {
  return toDate(t).toLocaleTimeString(locale, { ...opts, timeZone: TZ });
}

/**
 * ISO-shaped Taipei wall-clock string, "YYYY-MM-DDTHH:mm:ss.sss" (no zone
 * suffix). Drop-in for code that sliced a UTC ISO string: `.slice(0, 10)` is
 * the Taipei date, `.slice(0, 16)` the Taipei minute.
 */
export function taipeiIso(t: TimeInput): string {
  return new Date(toMs(t) + OFFSET_MS).toISOString().slice(0, 23);
}

/** Taipei calendar day, "YYYY-MM-DD". */
export function taipeiDayKey(t: TimeInput): string {
  return taipeiIso(t).slice(0, 10);
}

/** Taipei calendar month, "YYYY-MM". */
export function taipeiMonthKey(t: TimeInput): string {
  return taipeiIso(t).slice(0, 7);
}

/** Monday of the Taipei ISO week containing t, "YYYY-MM-DD". */
export function taipeiWeekKey(t: TimeInput): string {
  const shifted = new Date(toMs(t) + OFFSET_MS);
  const sinceMonday = (shifted.getUTCDay() + 6) % 7;
  shifted.setUTCDate(shifted.getUTCDate() - sinceMonday);
  return shifted.toISOString().slice(0, 10);
}

/** UTC epoch ms of the Taipei midnight that starts the day containing t. */
export function taipeiDayStartMs(t: TimeInput): number {
  const ms = toMs(t);
  return Math.floor((ms + OFFSET_MS) / DAY_MS) * DAY_MS - OFFSET_MS;
}

/** UTC epoch ms of Taipei midnight on a calendar date (month is 1-12). */
export function taipeiMidnightMs(year: number, month: number, day: number): number {
  return Date.UTC(year, month - 1, day) - OFFSET_MS;
}

/**
 * UTC epoch ms of Taipei midnight on the calendar day a date picker selected.
 * react-day-picker hands back browser-local midnight, so its local Y/M/D is
 * what the user clicked; re-anchor that day to Taipei whatever the browser's zone.
 */
export function taipeiPickedDayStartMs(picked: Date): number {
  return taipeiMidnightMs(picked.getFullYear(), picked.getMonth() + 1, picked.getDate());
}
