import { toPayrollDateOnly } from "@/lib/payroll/employment";
import type {
  SalaryAdvanceInstallment,
  SalaryAdvanceScheduleSegment,
} from "@/lib/salary-advances/types";

export type YearMonth = { year: number; month: number };

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

export function yearMonthKey(year: number, month: number): string {
  return `${year}-${pad2(month)}`;
}

export function compareYearMonth(a: YearMonth, b: YearMonth): number {
  if (a.year !== b.year) return a.year - b.year;
  return a.month - b.month;
}

export function addMonths(year: number, month: number, count: number): YearMonth {
  const index = year * 12 + (month - 1) + count;
  return {
    year: Math.floor(index / 12),
    month: (index % 12) + 1,
  };
}

/** Local calendar current month. */
export function currentMonthFromDate(date: Date = new Date()): YearMonth {
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
  };
}

/** Local calendar next month (deductions start from next month by default). */
export function nextMonthFromDate(date: Date = new Date()): YearMonth {
  const current = currentMonthFromDate(date);
  return addMonths(current.year, current.month, 1);
}

/**
 * Next increment anniversary = (lastIncrementDate || joiningDate) + 1 year.
 */
export function getNextIncrementDate(lastIncrementDate: string, joiningDate: string): string {
  const base = toPayrollDateOnly(lastIncrementDate) || toPayrollDateOnly(joiningDate);
  if (!base) return "";

  const [y, m, d] = base.split("-").map((part) => Number(part));
  if (!y || !m || !d) return "";
  return `${y + 1}-${pad2(m)}-${pad2(d)}`;
}

/**
 * Deduction months allowed: from start (inclusive) through the month
 * before the next increment anniversary.
 *
 * Example: next increment 2026-12-01 → last allowed month is 2026-11.
 */
export function listAvailableDeductionMonths(params: {
  startYear: number;
  startMonth: number;
  nextIncrementDate: string;
}): YearMonth[] {
  const nextIncrement = toPayrollDateOnly(params.nextIncrementDate);
  if (!nextIncrement) return [];

  const [incYear, incMonth] = nextIncrement.split("-").map((part) => Number(part));
  if (!incYear || !incMonth) return [];

  // Month before increment anniversary
  const lastAllowed = addMonths(incYear, incMonth, -1);
  const start: YearMonth = { year: params.startYear, month: params.startMonth };
  if (compareYearMonth(start, lastAllowed) > 0) return [];

  const months: YearMonth[] = [];
  let cursor = start;
  while (compareYearMonth(cursor, lastAllowed) <= 0) {
    months.push(cursor);
    cursor = addMonths(cursor.year, cursor.month, 1);
    if (months.length > 120) break;
  }
  return months;
}

export function buildInstallmentsFromSegments(
  startYear: number,
  startMonth: number,
  segments: SalaryAdvanceScheduleSegment[],
): SalaryAdvanceInstallment[] {
  const installments: SalaryAdvanceInstallment[] = [];
  let offset = 0;

  for (const segment of segments) {
    const months = Math.max(0, Math.floor(Number(segment.months) || 0));
    const amount = Math.round((Number(segment.amountPerMonth) || 0) * 100) / 100;
    if (months <= 0 || amount <= 0) {
      throw new Error("Each schedule segment needs months > 0 and amount > 0");
    }

    for (let i = 0; i < months; i += 1) {
      const ym = addMonths(startYear, startMonth, offset);
      installments.push({ year: ym.year, month: ym.month, amount });
      offset += 1;
    }
  }

  return installments;
}

export function sumInstallments(installments: SalaryAdvanceInstallment[]): number {
  return Math.round(installments.reduce((sum, row) => sum + row.amount, 0) * 100) / 100;
}

export function installmentForPeriod(
  installments: SalaryAdvanceInstallment[],
  year: number,
  month: number,
): number {
  return (
    Math.round(
      installments
        .filter((row) => row.year === year && row.month === month)
        .reduce((sum, row) => sum + row.amount, 0) * 100,
    ) / 100
  );
}

/** Remaining balance after a given payroll period (inclusive). */
export function remainingAfterPeriod(
  totalAmount: number,
  installments: SalaryAdvanceInstallment[],
  year: number,
  month: number,
): number {
  const deducted = installments
    .filter((row) => compareYearMonth(row, { year, month }) <= 0)
    .reduce((sum, row) => sum + row.amount, 0);
  return Math.round(Math.max(0, totalAmount - deducted) * 100) / 100;
}

/**
 * Past months are locked (already recoverable in closed payroll).
 * Current + future months can be rescheduled.
 */
export function splitLockedAndOpenInstallments(
  installments: SalaryAdvanceInstallment[],
  asOf: Date = new Date(),
): {
  locked: SalaryAdvanceInstallment[];
  open: SalaryAdvanceInstallment[];
  lockedTotal: number;
  openTotal: number;
} {
  const current = currentMonthFromDate(asOf);
  const locked = installments.filter((row) => compareYearMonth(row, current) < 0);
  const open = installments.filter((row) => compareYearMonth(row, current) >= 0);
  return {
    locked,
    open,
    lockedTotal: sumInstallments(locked),
    openTotal: sumInstallments(open),
  };
}

/** Collapse consecutive equal amounts into UI segments. */
export function installmentsToSegments(
  installments: SalaryAdvanceInstallment[],
): SalaryAdvanceScheduleSegment[] {
  if (!installments.length) return [];
  const segments: SalaryAdvanceScheduleSegment[] = [];
  for (const row of installments) {
    const last = segments[segments.length - 1];
    if (last && last.amountPerMonth === row.amount) {
      last.months += 1;
    } else {
      segments.push({ months: 1, amountPerMonth: row.amount });
    }
  }
  return segments;
}

export function validateAdvanceSchedule(params: {
  totalAmount: number;
  startYear: number;
  startMonth: number;
  segments: SalaryAdvanceScheduleSegment[];
  lastIncrementDate: string;
  joiningDate: string;
}): {
  installments: SalaryAdvanceInstallment[];
  availableMonths: YearMonth[];
  nextIncrementDate: string;
} {
  const totalAmount = Math.round((Number(params.totalAmount) || 0) * 100) / 100;
  if (!(totalAmount > 0)) {
    throw new Error("Advance amount must be greater than 0");
  }
  if (!params.segments.length) {
    throw new Error("Add at least one repayment segment");
  }
  if (
    !Number.isInteger(params.startYear) ||
    !Number.isInteger(params.startMonth) ||
    params.startMonth < 1 ||
    params.startMonth > 12
  ) {
    throw new Error("Valid start year/month is required");
  }

  const earliest = currentMonthFromDate();
  if (compareYearMonth({ year: params.startYear, month: params.startMonth }, earliest) < 0) {
    throw new Error(`Start month cannot be before ${yearMonthKey(earliest.year, earliest.month)}`);
  }

  const nextIncrementDate = getNextIncrementDate(params.lastIncrementDate, params.joiningDate);
  if (!nextIncrementDate) {
    throw new Error(
      "Employee needs a last increment date or joining date to calculate the repayment window",
    );
  }

  const availableMonths = listAvailableDeductionMonths({
    startYear: params.startYear,
    startMonth: params.startMonth,
    nextIncrementDate,
  });

  if (availableMonths.length === 0) {
    throw new Error(
      `No repayment months left before the next increment on ${nextIncrementDate}. ` +
        "Start month must be before that anniversary.",
    );
  }

  const installments = buildInstallmentsFromSegments(
    params.startYear,
    params.startMonth,
    params.segments,
  );

  if (installments.length > availableMonths.length) {
    throw new Error(
      `Schedule uses ${installments.length} months, but only ${availableMonths.length} ` +
        `are available from the selected start. Reduce months or pick an earlier start.`,
    );
  }

  // Ensure every installment falls inside the allowed window
  const allowed = new Set(availableMonths.map((m) => yearMonthKey(m.year, m.month)));
  for (const row of installments) {
    if (!allowed.has(yearMonthKey(row.year, row.month))) {
      throw new Error(
        `Installment ${yearMonthKey(row.year, row.month)} is outside the allowed window ` +
          `(before ${nextIncrementDate}).`,
      );
    }
  }

  const scheduledTotal = sumInstallments(installments);
  if (Math.abs(scheduledTotal - totalAmount) > 0.01) {
    throw new Error(
      `Schedule totals Rs. ${scheduledTotal.toLocaleString("en-IN")} but advance is Rs. ${totalAmount.toLocaleString("en-IN")}. They must match.`,
    );
  }

  return { installments, availableMonths, nextIncrementDate };
}

/** Preview helper for UI: max months and suggested equal EMI check. */
export function getAdvanceWindowSummary(params: {
  lastIncrementDate: string;
  joiningDate: string;
  startYear?: number;
  startMonth?: number;
}): {
  nextIncrementDate: string;
  start: YearMonth;
  availableMonths: YearMonth[];
  availableMonthCount: number;
} {
  const start =
    params.startYear && params.startMonth
      ? { year: params.startYear, month: params.startMonth }
      : nextMonthFromDate();
  const nextIncrementDate = getNextIncrementDate(params.lastIncrementDate, params.joiningDate);
  const availableMonths = nextIncrementDate
    ? listAvailableDeductionMonths({
        startYear: start.year,
        startMonth: start.month,
        nextIncrementDate,
      })
    : [];

  return {
    nextIncrementDate,
    start,
    availableMonths,
    availableMonthCount: availableMonths.length,
  };
}
