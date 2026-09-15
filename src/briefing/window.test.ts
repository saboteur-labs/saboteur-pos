import { describe, expect, it } from 'vitest';
import { defaultWeekWindow, formatWindow, parseWeekStart, resolveWindow } from './window.js';

// 2026-09-16 is a Wednesday; 2026-09-14 a Monday; 2026-09-13 a Sunday.
const wed = new Date(2026, 8, 16, 10, 30);
const mon = new Date(2026, 8, 14, 8, 0);
const local = (y: number, m: number, d: number) => new Date(y, m - 1, d, 0, 0, 0, 0);

describe('parseWeekStart', () => {
  it('maps day names to Date.getDay() indices, case-insensitively', () => {
    expect(parseWeekStart('sunday')).toBe(0);
    expect(parseWeekStart('Monday')).toBe(1);
    expect(parseWeekStart('saturday')).toBe(6);
  });

  it('rejects an unrecognised value with a readable message', () => {
    expect(() => parseWeekStart('mon')).toThrow(/briefing\.week_start.*"mon"/);
  });
});

describe('defaultWeekWindow', () => {
  it('covers the current calendar week mid-week (FR-1)', () => {
    const w = defaultWeekWindow(wed, 'monday');
    expect(w.start).toEqual(local(2026, 9, 14));
    expect(w.end).toEqual(local(2026, 9, 21));
  });

  it('uses the previous full week when today is the week-start day (FR-1)', () => {
    const w = defaultWeekWindow(mon, 'monday');
    expect(w.start).toEqual(local(2026, 9, 7));
    expect(w.end).toEqual(local(2026, 9, 14));
  });

  it('honours a non-Monday week start', () => {
    const w = defaultWeekWindow(wed, 'sunday');
    expect(w.start).toEqual(local(2026, 9, 13));
    expect(w.end).toEqual(local(2026, 9, 20));
  });
});

describe('resolveWindow (FR-2)', () => {
  it('returns the default week when no flags are given', () => {
    expect(resolveWindow({}, wed, 'monday')).toEqual(defaultWeekWindow(wed, 'monday'));
  });

  it('treats both dates as inclusive local days', () => {
    const w = resolveWindow({ since: '2026-09-01', until: '2026-09-10' }, wed, 'monday');
    expect(w.start).toEqual(local(2026, 9, 1));
    expect(w.end).toEqual(local(2026, 9, 11));
  });

  it('accepts a single-day range', () => {
    const w = resolveWindow({ since: '2026-09-10', until: '2026-09-10' }, wed, 'monday');
    expect(w.end.getTime() - w.start.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it('runs --since alone through the end of today', () => {
    const w = resolveWindow({ since: '2026-07-01' }, wed, 'monday');
    expect(w.start).toEqual(local(2026, 7, 1));
    expect(w.end).toEqual(local(2026, 9, 17));
  });

  it('rejects --until without --since', () => {
    expect(() => resolveWindow({ until: '2026-09-10' }, wed, 'monday')).toThrow(/--until requires --since/);
  });

  it('rejects --since later than --until', () => {
    expect(() => resolveWindow({ since: '2026-09-10', until: '2026-09-01' }, wed, 'monday')).toThrow(
      /--since .* is after --until/,
    );
  });

  it('rejects --since alone when it is after today', () => {
    expect(() => resolveWindow({ since: '2026-09-20' }, wed, 'monday')).toThrow(/after today/);
  });

  it('rejects malformed and impossible dates', () => {
    expect(() => resolveWindow({ since: '09/01/2026' }, wed, 'monday')).toThrow(/YYYY-MM-DD/);
    expect(() => resolveWindow({ since: '2026-02-30' }, wed, 'monday')).toThrow(/not a real date/);
  });

  it('does not consult week_start when explicit dates are given', () => {
    expect(() => resolveWindow({ since: '2026-09-01' }, wed, 'bogus')).not.toThrow();
  });
});

describe('formatWindow', () => {
  it('shows the inclusive last day', () => {
    expect(formatWindow({ start: local(2026, 9, 14), end: local(2026, 9, 21) })).toBe(
      '2026-09-14 → 2026-09-20',
    );
  });
});
