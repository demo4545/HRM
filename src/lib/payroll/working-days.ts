/**
 * Calendar helpers for payroll / salary working-day schedules.
 * Working days = Monday–Friday only. Public holidays and festivals on weekdays
 * still count as working days.
 */

export function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

export function toIsoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** True for Saturday or Sunday. */
export function isWeekend(year: number, month: number, day: number): boolean {
  const dayOfWeek = new Date(year, month - 1, day).getDay();
  return dayOfWeek === 0 || dayOfWeek === 6;
}

/**
 * Scheduled working days for a month: Monday–Friday only.
 * Public holidays / festivals on weekdays are included.
 */
export function listScheduledWorkingDates(year: number, month: number): string[] {
  const dates: string[] = [];
  const days = getDaysInMonth(year, month);
  for (let day = 1; day <= days; day += 1) {
    if (isWeekend(year, month, day)) continue;
    dates.push(toIsoDate(year, month, day));
  }
  return dates;
}

export function countScheduledWorkingDays(year: number, month: number): number {
  return listScheduledWorkingDates(year, month).length;
}
