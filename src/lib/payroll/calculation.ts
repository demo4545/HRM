import { OVERTIME_APPROVAL } from "@/lib/attendance/constants";
import { parseDurationToMs } from "@/lib/attendance/time";
import {
  DEFAULT_LWF,
  DEFAULT_LOYALTY_PERCENT,
  DEFAULT_PROFESSIONAL_TAX,
  HOURS_PER_DAY,
} from "@/lib/payroll/constants";
import { summarizeAttendanceDays, type PayrollAttendanceDay } from "@/lib/payroll/attendance-codes";
import {
  calculateSalaryBreakdown,
  proratedEarningsTotal,
  resolveSalaryEarningsComponents,
} from "@/lib/salary-slips/calculation";

function round2(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

export type { PayrollAttendanceDay };

export type PayrollEmployeeInput = {
  /** Monthly basic from salary history (same source as salary slips). */
  basic?: number;
  hra?: number;
  organizationAllowance?: number;
  /** @deprecated Prefer `basic`. Used when salary history has no breakdown. */
  monthlySalary?: number;
  /** Loyalty deduction percentage of full monthly basic (not pro-rated by attendance). */
  loyaltyPercent?: number;
  professionalTax?: number;
  lwf?: number;
  /** Salary advance recovery for this payroll month. */
  salaryAdvance?: number;
  workingDays: number;
  scheduledDates: string[];
  attendanceByDate: Map<string, PayrollAttendanceDay>;
};

export type PayrollEmployeeResult = {
  basic: number;
  hra: number;
  organizationAllowance: number;
  /** Gross configured monthly pay (basic + HRA + organization allowance). */
  monthlySalary: number;
  workingDays: number;
  perDay: number;
  perHour: number;
  halfPaidLeave: number;
  fullPaidLeave: number;
  halfUnpaidLeave: number;
  fullUnpaidLeave: number;
  totalPaidLeave: number;
  totalUnpaidLeave: number;
  attendDays: number;
  /** Company working days in this employee's schedule minus unpaid leave (U/F). */
  netPayableDays: number;
  paidLeaveAmount: number;
  unpaidLeaveAmount: number;
  overtimeHours: number;
  overtimeAmount: number;
  /** Payable earnings after unpaid / mid-month pro-rate (before OT and deductions). */
  amountAfterAttendance: number;
  loyaltyPercent: number;
  loyaltyBonus: number;
  professionalTax: number;
  lwf: number;
  salaryAdvance: number;
  totalFixedDeductions: number;
  finalPayment: number;
  dayCodes: Record<string, string>;
};

export function sumApprovedOvertimeMs(attendanceByDate: Map<string, PayrollAttendanceDay>): number {
  let totalMs = 0;
  for (const row of attendanceByDate.values()) {
    if (String(row.isOvertimeApproved ?? "").trim() !== OVERTIME_APPROVAL.ACCEPTED) continue;
    const overtime = String(row.overtime ?? "").trim();
    if (!overtime || overtime === "—" || overtime.startsWith("-")) continue;
    totalMs += parseDurationToMs(overtime);
  }
  return totalMs;
}

/**
 * Monthly payroll aligned with salary slips:
 * 1. Display Basic / HRA / OA as full monthly amounts; unpaid leave is a separate deduction
 * 2. Final pay still uses payable days / working days for attendance (unpaid + mid-month)
 * 3. Loyalty = salary-history % of full monthly basic (not reduced by unpaid / working days)
 * 4. PT and LWF = salary-history amounts (same defaults as slips)
 * 5. Approved overtime is paid at gross per-hour rate
 * 6. finalPayment = payable earnings + OT − loyalty − PT − LWF − salary advance
 *
 * Paid leave (Paid / Sick / Casual / Half Day Paid) does not reduce pay.
 */
export function calculateEmployeePayroll(input: PayrollEmployeeInput): PayrollEmployeeResult {
  const storedBasic = Math.max(0, Number(input.basic ?? input.monthlySalary) || 0);
  const storedHra = Math.max(0, Number(input.hra) || 0);
  const storedOrg = Math.max(0, Number(input.organizationAllowance) || 0);
  const earnings = resolveSalaryEarningsComponents({
    basic: storedBasic,
    hra: storedHra,
    organizationAllowance: storedOrg,
  });
  const basic = earnings.basic;
  const hra = earnings.hra;
  const organizationAllowance = earnings.organizationAllowance;
  const grossMonthly = round2(earnings.totalGross);
  const workingDays = Math.max(0, Number(input.workingDays) || 0);
  const loyaltyPercent =
    input.loyaltyPercent != null && Number.isFinite(input.loyaltyPercent)
      ? Math.min(100, Math.max(0, input.loyaltyPercent))
      : DEFAULT_LOYALTY_PERCENT;
  const professionalTax =
    input.professionalTax != null && Number.isFinite(input.professionalTax)
      ? Math.max(0, input.professionalTax)
      : DEFAULT_PROFESSIONAL_TAX;
  const lwf =
    input.lwf != null && Number.isFinite(input.lwf) ? Math.max(0, input.lwf) : DEFAULT_LWF;
  const salaryAdvance = Math.max(0, Number(input.salaryAdvance) || 0);

  const attendance = summarizeAttendanceDays(input.scheduledDates, input.attendanceByDate);
  const employmentWorkingDays = input.scheduledDates.length;
  const payableDayWeight = Math.max(0, employmentWorkingDays - attendance.totalUnpaidLeave);

  const perDay = workingDays > 0 ? grossMonthly / workingDays : 0;
  const perHour = perDay / HOURS_PER_DAY;
  const unpaidLeaveAmount = round2(attendance.totalUnpaidLeave * perDay);
  const paidLeaveAmount = round2(attendance.totalPaidLeave * perDay);

  const breakdown = calculateSalaryBreakdown({
    basic: storedBasic,
    hra: storedHra,
    organizationAllowance: storedOrg,
    loyaltyBonus: loyaltyPercent,
    professionalTax,
    lwf,
    workingDays,
    netPayableDays: payableDayWeight,
    unpaidLeaveAmount,
  });

  const overtimeMs = sumApprovedOvertimeMs(input.attendanceByDate);
  const overtimeHours = round2(overtimeMs / (1000 * 60 * 60));
  const overtimeAmount = round2((overtimeMs / (1000 * 60 * 60)) * perHour);

  const amountAfterAttendance = proratedEarningsTotal({
    basic: storedBasic,
    hra: storedHra,
    organizationAllowance: storedOrg,
    workingDays,
    netPayableDays: payableDayWeight,
  });
  const loyaltyBonus = round2((grossMonthly * loyaltyPercent) / 100);
  const pt = breakdown.professionalTax;
  const lwfAmount = breakdown.lwf;

  const scheduledAdvance = round2(salaryAdvance);
  const availableForAdvance = Math.max(
    0,
    amountAfterAttendance + overtimeAmount - loyaltyBonus - pt - lwfAmount,
  );
  const advanceApplied = round2(Math.min(scheduledAdvance, availableForAdvance));
  const totalFixedDeductions = round2(loyaltyBonus + pt + lwfAmount + advanceApplied);
  const finalPayment = round2(
    Math.max(0, amountAfterAttendance + overtimeAmount - totalFixedDeductions),
  );

  return {
    basic: round2(basic),
    hra: round2(hra),
    organizationAllowance: round2(organizationAllowance),
    monthlySalary: grossMonthly,
    workingDays,
    perDay: round2(perDay),
    perHour: round2(perHour),
    halfPaidLeave: attendance.halfPaidLeave,
    fullPaidLeave: attendance.fullPaidLeave,
    halfUnpaidLeave: attendance.halfUnpaidLeave,
    fullUnpaidLeave: attendance.fullUnpaidLeave,
    totalPaidLeave: attendance.totalPaidLeave,
    totalUnpaidLeave: attendance.totalUnpaidLeave,
    attendDays: attendance.attendDays,
    netPayableDays: round2(payableDayWeight),
    paidLeaveAmount,
    unpaidLeaveAmount,
    overtimeHours,
    overtimeAmount,
    amountAfterAttendance,
    loyaltyPercent,
    loyaltyBonus,
    professionalTax: pt,
    lwf: lwfAmount,
    salaryAdvance: scheduledAdvance,
    totalFixedDeductions,
    finalPayment,
    dayCodes: attendance.dayCodes,
  };
}

export type PayrollPeriodAggregate = {
  employeeCount: number;
  totalNetPayable: number;
  totalLoyalty: number;
  totalProfessionalTax: number;
  totalLwf: number;
  totalUnpaidLeaveAmount: number;
  totalSalaryAdvance: number;
  totalOvertimeAmount: number;
  employeesWithPt: number;
  employeesWithLwf: number;
  employeesWithLoyalty: number;
  employeesWithUnpaid: number;
  employeesWithAdvance: number;
  employeesWithOvertime: number;
};

export function aggregatePayroll(
  rows: Pick<
    PayrollEmployeeResult,
    | "finalPayment"
    | "loyaltyBonus"
    | "professionalTax"
    | "lwf"
    | "unpaidLeaveAmount"
    | "salaryAdvance"
    | "overtimeAmount"
  >[],
): PayrollPeriodAggregate {
  let totalNetPayable = 0;
  let totalLoyalty = 0;
  let totalProfessionalTax = 0;
  let totalLwf = 0;
  let totalUnpaidLeaveAmount = 0;
  let totalSalaryAdvance = 0;
  let totalOvertimeAmount = 0;
  let employeesWithPt = 0;
  let employeesWithLwf = 0;
  let employeesWithLoyalty = 0;
  let employeesWithUnpaid = 0;
  let employeesWithAdvance = 0;
  let employeesWithOvertime = 0;

  for (const row of rows) {
    totalNetPayable += row.finalPayment;
    totalLoyalty += row.loyaltyBonus;
    totalProfessionalTax += row.professionalTax;
    totalLwf += row.lwf;
    totalUnpaidLeaveAmount += row.unpaidLeaveAmount;
    totalSalaryAdvance += row.salaryAdvance;
    totalOvertimeAmount += row.overtimeAmount;
    if (row.professionalTax > 0) employeesWithPt += 1;
    if (row.lwf > 0) employeesWithLwf += 1;
    if (row.loyaltyBonus > 0) employeesWithLoyalty += 1;
    if (row.unpaidLeaveAmount > 0) employeesWithUnpaid += 1;
    if (row.salaryAdvance > 0) employeesWithAdvance += 1;
    if (row.overtimeAmount > 0) employeesWithOvertime += 1;
  }

  return {
    employeeCount: rows.length,
    totalNetPayable: round2(totalNetPayable),
    totalLoyalty: round2(totalLoyalty),
    totalProfessionalTax: round2(totalProfessionalTax),
    totalLwf: round2(totalLwf),
    totalUnpaidLeaveAmount: round2(totalUnpaidLeaveAmount),
    totalSalaryAdvance: round2(totalSalaryAdvance),
    totalOvertimeAmount: round2(totalOvertimeAmount),
    employeesWithPt,
    employeesWithLwf,
    employeesWithLoyalty,
    employeesWithUnpaid,
    employeesWithAdvance,
    employeesWithOvertime,
  };
}
