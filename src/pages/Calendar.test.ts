import { describe, expect, it } from 'vitest';
import { format } from 'date-fns';
import { getCalendarRange, navigateCalendarDate } from '../lib/calendarViews';

const day = (value: Date) => format(value, 'yyyy-MM-dd');

describe('calendar multi-day views', () => {
  it('shows three consecutive days from the selected date', () => {
    const range = getCalendarRange('threeDay', new Date(2026, 8, 18));
    expect(day(range.start)).toBe('2026-09-18');
    expect(day(range.end)).toBe('2026-09-20');
  });

  it('shows Monday through Friday for the work week', () => {
    const range = getCalendarRange('workWeek', new Date(2026, 8, 23));
    expect(day(range.start)).toBe('2026-09-21');
    expect(day(range.end)).toBe('2026-09-25');
  });

  it('navigates by the visible period', () => {
    const date = new Date(2026, 8, 18);
    expect(day(navigateCalendarDate('threeDay', date, 1))).toBe('2026-09-21');
    expect(day(navigateCalendarDate('threeDay', date, -1))).toBe('2026-09-15');
    expect(day(navigateCalendarDate('workWeek', date, 1))).toBe('2026-09-25');
    expect(day(navigateCalendarDate('workWeek', date, -1))).toBe('2026-09-11');
  });

  it('keeps the existing full month grid range', () => {
    const range = getCalendarRange('month', new Date(2026, 8, 18));
    expect(day(range.start)).toBe('2026-08-31');
    expect(day(range.end)).toBe('2026-10-04');
  });
});
