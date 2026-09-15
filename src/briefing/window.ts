/**
 * Date windows for the briefing's Landed section.
 *
 * All boundaries are local-time midnights. A window is half-open: `start` is
 * included, `end` is not, so an inclusive `--until` day becomes the midnight
 * after it. Pure — the caller supplies `now`.
 */

export interface DateWindow {
  start: Date;
  end: Date;
}

export interface WindowFlags {
  since?: string;
  until?: string;
}

// Indexed to match Date.getDay().
const WEEK_DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

export function parseWeekStart(value: string): number {
  const idx = WEEK_DAYS.indexOf(value.toLowerCase());
  if (idx === -1) {
    throw new Error(
      `Invalid briefing.week_start "${value}" in config. Use one of: ${WEEK_DAYS.join(', ')}.`,
    );
  }
  return idx;
}

function midnight(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d: Date, days: number): Date {
  // Calendar arithmetic, not +24h, so DST changes don't shift the boundary.
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
}

/** The current calendar week, or the previous full week when today is the
 * week-start day (so the section isn't empty on the first morning). */
export function defaultWeekWindow(now: Date, weekStart: string): DateWindow {
  const startDay = parseWeekStart(weekStart);
  const today = midnight(now);
  const offset = (today.getDay() - startDay + 7) % 7;
  let start = addDays(today, -offset);
  if (offset === 0) start = addDays(start, -7);
  return { start, end: addDays(start, 7) };
}

function parseDateFlag(flag: string, value: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) {
    throw new Error(`${flag} must be a date in YYYY-MM-DD form (got "${value}").`);
  }
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) {
    throw new Error(`${flag} "${value}" is not a real date.`);
  }
  return date;
}

export function resolveWindow(flags: WindowFlags, now: Date, weekStart: string): DateWindow {
  if (flags.since === undefined && flags.until === undefined) {
    return defaultWeekWindow(now, weekStart);
  }
  if (flags.since === undefined) {
    throw new Error('--until requires --since.');
  }
  const start = parseDateFlag('--since', flags.since);
  if (flags.until === undefined) {
    const end = addDays(midnight(now), 1);
    if (start >= end) {
      throw new Error(`--since ${flags.since} is after today.`);
    }
    return { start, end };
  }
  const until = parseDateFlag('--until', flags.until);
  if (start > until) {
    throw new Error(`--since ${flags.since} is after --until ${flags.until}.`);
  }
  return { start, end: addDays(until, 1) };
}

function ymd(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** Human label with the inclusive last day, e.g. `2026-09-14 → 2026-09-20`. */
export function formatWindow(window: DateWindow): string {
  return `${ymd(window.start)} → ${ymd(addDays(window.end, -1))}`;
}
