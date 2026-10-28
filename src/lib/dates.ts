// All dates are calendar dates ('YYYY-MM-DD') in the company's time zone, so
// "today" and day counts match what staff see on the office wall calendar.
export const COMPANY_TZ = 'Asia/Manila';

export function todayISO(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: COMPANY_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function nowTimeHHMM(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: COMPANY_TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
}

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidISODate(s: string | null | undefined): s is string {
  if (!s) return false;
  const m = ISO.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

function toUTC(s: string): number {
  const m = ISO.exec(s);
  if (!m) throw new Error(`Invalid date "${s}"`);
  return Date.UTC(+m[1], +m[2] - 1, +m[3]);
}

/** Whole days from a to b (b - a), like subtracting two Excel dates. */
export function daysBetween(a: string, b: string): number {
  return Math.round((toUTC(b) - toUTC(a)) / 86_400_000);
}

/** Excel EDATE: same day n months later, clamped to the end of a shorter month. */
export function addMonths(s: string, n: number): string {
  const m = ISO.exec(s);
  if (!m) throw new Error(`Invalid date "${s}"`);
  const y = +m[1], mo = +m[2] - 1 + n, d = +m[3];
  const lastDay = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
  const out = new Date(Date.UTC(y, mo, Math.min(d, lastDay)));
  return out.toISOString().slice(0, 10);
}

export function yearOf(s: string): number {
  return +s.slice(0, 4);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 'Oct 28, 2026' — unambiguous for everyone. */
export function formatDate(s: string | null | undefined): string {
  if (!s) return '—';
  const m = ISO.exec(s.slice(0, 10));
  if (!m) return s;
  return `${MONTHS[+m[2] - 1]} ${+m[3]}, ${m[1]}`;
}

export function formatDateTime(ts: string | null | undefined): string {
  if (!ts) return '—';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: COMPANY_TZ, month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(new Date(ts));
}

/** '14:05:00' -> '2:05 PM' */
export function formatTime(t: string | null | undefined): string {
  if (!t) return '—';
  const [h, m] = t.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${suffix}`;
}

/** Excel date serial -> 'YYYY-MM-DD' (1900 or 1904 date system). */
export function excelSerialToISO(serial: number, date1904 = false): string {
  const base = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  return new Date(base + Math.floor(serial + 1e-9) * 86_400_000).toISOString().slice(0, 10);
}

/** Fraction of a day -> 'HH:MM' */
export function excelFractionToTime(frac: number): string {
  const total = Math.round((frac % 1) * 24 * 60);
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
