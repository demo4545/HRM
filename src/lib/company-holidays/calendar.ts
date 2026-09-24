/** Monday-first month grid helpers for company holiday calendars (no date libs). */

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export { WEEKDAY_LABELS };

export function daysInMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

/** 0 = Monday … 6 = Sunday for the 1st of the month. */
export function mondayFirstOffset(year: number, monthIndex: number): number {
  const sundayBased = new Date(year, monthIndex, 1).getDay();
  return (sundayBased + 6) % 7;
}

export function isoDateFromParts(year: number, monthIndex: number, day: number): string {
  const month = String(monthIndex + 1).padStart(2, "0");
  const dayPart = String(day).padStart(2, "0");
  return `${year}-${month}-${dayPart}`;
}

export type MonthDayCell =
  | { kind: "empty"; key: string }
  | { kind: "day"; key: string; day: number; iso: string };

export function buildMonthCells(year: number, monthIndex: number): MonthDayCell[] {
  const offset = mondayFirstOffset(year, monthIndex);
  const totalDays = daysInMonth(year, monthIndex);
  const cells: MonthDayCell[] = [];

  for (let i = 0; i < offset; i += 1) {
    cells.push({ kind: "empty", key: `e-${monthIndex}-${i}` });
  }
  for (let day = 1; day <= totalDays; day += 1) {
    cells.push({
      kind: "day",
      key: `d-${monthIndex}-${day}`,
      day,
      iso: isoDateFromParts(year, monthIndex, day),
    });
  }
  return cells;
}
