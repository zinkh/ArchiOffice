import { addDays, addMonths, endOfMonth, endOfWeek, startOfMonth, startOfWeek, subMonths } from 'date-fns';

export type CalendarGridView = 'month' | 'threeDay' | 'workWeek';

export function getCalendarRange(view: CalendarGridView, date: Date): { start: Date; end: Date } {
  if (view === 'threeDay') return { start: date, end: addDays(date, 2) };
  if (view === 'workWeek') {
    const start = startOfWeek(date, { weekStartsOn: 1 });
    return { start, end: addDays(start, 4) };
  }
  const monthStart = startOfMonth(date);
  const monthEnd = endOfMonth(date);
  return {
    start: startOfWeek(monthStart, { weekStartsOn: 1 }),
    end: endOfWeek(monthEnd, { weekStartsOn: 1 }),
  };
}

export function navigateCalendarDate(view: CalendarGridView, date: Date, direction: -1 | 1): Date {
  if (view === 'threeDay') return addDays(date, direction * 3);
  if (view === 'workWeek') return addDays(date, direction * 7);
  return direction === 1 ? addMonths(date, 1) : subMonths(date, 1);
}
