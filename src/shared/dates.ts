/**
 * Date helpers. Business dates are `YYYY-MM-DD` strings in the pharmacy's local time zone;
 * timestamps are ISO-8601 UTC strings.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** Local calendar date of a Date as YYYY-MM-DD. */
export function toLocalDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function todayLocal(now: Date = new Date()): string {
  return toLocalDate(now);
}

/** Days from `from` to `to` (both YYYY-MM-DD). Positive when `to` is later. */
export function daysBetween(from: string, to: string): number {
  const [y1, m1, d1] = from.split('-').map(Number);
  const [y2, m2, d2] = to.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return `${target.getUTCFullYear()}-${pad(target.getUTCMonth() + 1)}-${pad(Math.min(d, last))}`;
}

/** Last calendar day of the month of `year`/`month` (1-12) as YYYY-MM-DD. */
export function endOfMonth(year: number, month: number): string {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${pad(month)}-${pad(last)}`;
}

export function startOfMonth(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

/**
 * Parse user expiry input: `YYYY-MM-DD`, `MM/YYYY`, `MM/YY`, `MM-YYYY`, `YYYY-MM`.
 * Month-only forms resolve to the last day of the month (packs print month/year).
 */
export function parseExpiryInput(input: string): string | null {
  const s = input.trim();
  if (isIsoDate(s)) return s;
  let m = /^(\d{1,2})[/\-.](\d{2}|\d{4})$/.exec(s);
  if (m) {
    const month = Number(m[1]);
    let year = Number(m[2]);
    if (year < 100) year += 2000;
    if (month < 1 || month > 12) return null;
    return endOfMonth(year, month);
  }
  m = /^(\d{4})-(\d{1,2})$/.exec(s);
  if (m) {
    const month = Number(m[2]);
    if (month < 1 || month > 12) return null;
    return endOfMonth(Number(m[1]), month);
  }
  m = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/.exec(s);
  if (m) {
    const iso = `${m[3]}-${pad(Number(m[2]))}-${pad(Number(m[1]))}`;
    return isIsoDate(iso) ? iso : null;
  }
  return null;
}

/** UTC ISO range [start, end) covering the local calendar days from..to inclusive. */
export function localDayRangeToUtc(from: string, to: string): { start: string; end: string } {
  const [y1, m1, d1] = from.split('-').map(Number);
  const [y2, m2, d2] = to.split('-').map(Number);
  const start = new Date(y1, m1 - 1, d1, 0, 0, 0, 0);
  const end = new Date(y2, m2 - 1, d2 + 1, 0, 0, 0, 0);
  return { start: start.toISOString(), end: end.toISOString() };
}

/** Monday-based ISO week start for a YYYY-MM-DD date. */
export function startOfWeek(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = (dt.getUTCDay() + 6) % 7;
  return addDays(date, -dow);
}

export function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  const n = daysBetween(from, to);
  for (let i = 0; i <= n; i++) out.push(addDays(from, i));
  return out;
}
