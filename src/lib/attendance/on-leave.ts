import { roleCanPunchInOut } from "@/lib/attendance/absence-gate";
import { getAttendanceSpreadsheetIdFromRow } from "@/lib/attendance/employee";
import { listLeaveApplications, type LeaveApplication } from "@/lib/attendance/leave-approvals";
import { parseLeaveDisplayDate } from "@/lib/attendance/leave-range-display";
import { LEAVE_STATUS } from "@/lib/attendance/leave-status";
import { formatIsoDate, getAppZonedParts } from "@/lib/attendance/time";
import { getEmployeeIdFromRow, isEmployeeStatusActive, sheetRowToForm } from "@/lib/employee";
import { listAllEmployeeRows } from "@/lib/employees/repository";
import { isFirebaseDailyStorage } from "@/lib/storage/backend";
import type { UserRole } from "@/types/auth";

/** Midday split between first-half (AM) and second-half (PM) leave — matches punch gate. */
export const HALF_DAY_LEAVE_SPLIT_HOUR = 14;

export type OnLeaveEmployee = {
  id: string;
  employeeSheetRow: number;
  employeeId: string;
  employeeName: string;
  leaveType: string;
  duration: string;
  reason: string;
  date: string;
};

export type OnLeaveDashboardData = {
  employees: OnLeaveEmployee[];
  totalEmployees: number;
};

type CachedOnLeave = {
  expiresAt: number;
  value: OnLeaveDashboardData;
};

const CACHE_TTL_MS = 60_000;
const onLeaveCache = new Map<string, CachedOnLeave>();
const onLeaveRequests = new Map<string, Promise<OnLeaveDashboardData>>();

export function invalidateOnLeaveCache(dateIso?: string): void {
  if (dateIso) {
    onLeaveCache.delete(dateIso);
    onLeaveRequests.delete(dateIso);
    return;
  }
  onLeaveCache.clear();
  onLeaveRequests.clear();
}

async function listActiveEmployeesForLeaveTracking() {
  const records = await listAllEmployeeRows();

  return records.flatMap((record) => {
    const form = sheetRowToForm(record.headers, record.row);
    if (!isEmployeeStatusActive(form.status)) return [];

    const role = form.role.trim().toLowerCase();
    if (!roleCanPunchInOut(role as UserRole)) return [];

    const attendanceSpreadsheetId = getAttendanceSpreadsheetIdFromRow(record.headers, record.row);
    const employeeId = getEmployeeIdFromRow(record.headers, record.row, record.sheetRow);

    // Leave bucket is Firebase-keyed by employeeId when daily storage is on.
    if (!employeeId) return [];
    if (!attendanceSpreadsheetId && !isFirebaseDailyStorage()) return [];

    return [
      {
        employeeSheetRow: record.sheetRow,
        employeeId,
        employeeName: form.name.trim() || "Employee",
        attendanceSpreadsheetId: attendanceSpreadsheetId || "",
      },
    ];
  });
}

function applicationDateIso(application: LeaveApplication): string {
  const parsed = parseLeaveDisplayDate(application.date);
  return parsed ? formatIsoDate(parsed) : "";
}

function isHalfAmDuration(duration: string): boolean {
  const normalized = duration.trim().toLowerCase();
  return normalized.includes("half") && normalized.includes("am");
}

function isHalfPmDuration(duration: string): boolean {
  const normalized = duration.trim().toLowerCase();
  return normalized.includes("half") && normalized.includes("pm");
}

/**
 * Half-day leave only counts as "on leave" during that half of the day.
 * Full-day (and ambiguous) leave stays visible for the whole date.
 */
export function isOnLeaveVisibleAt(duration: string, now: Date = new Date()): boolean {
  const isHalfAm = isHalfAmDuration(duration);
  const isHalfPm = isHalfPmDuration(duration);
  if (!isHalfAm && !isHalfPm) return true;

  const { hour, minute } = getAppZonedParts(now);
  const minutes = hour * 60 + minute;
  const split = HALF_DAY_LEAVE_SPLIT_HOUR * 60;

  if (isHalfAm) return minutes < split;
  return minutes >= split;
}

function filterEmployeesForDashboardView(
  data: OnLeaveDashboardData,
  dateIso: string,
  now: Date,
): OnLeaveDashboardData {
  // Historical / future dates: show everyone who had leave that day.
  if (dateIso !== formatIsoDate(now)) return data;

  return {
    ...data,
    employees: data.employees.filter((employee) => isOnLeaveVisibleAt(employee.duration, now)),
  };
}

async function loadEmployeesOnLeave(dateIso: string): Promise<OnLeaveDashboardData> {
  const employees = await listActiveEmployeesForLeaveTracking();

  const results = await Promise.allSettled(
    employees.map(async (employee) => {
      const applications = await listLeaveApplications({
        employeeId: employee.employeeId,
        employeeName: employee.employeeName,
        attendanceSpreadsheetId: employee.attendanceSpreadsheetId,
        statusFilter: LEAVE_STATUS.ACCEPTED,
      });

      return applications
        .filter((application) => applicationDateIso(application) === dateIso)
        .map((application): OnLeaveEmployee => ({
          id: `${employee.employeeSheetRow}:${dateIso}`,
          employeeSheetRow: employee.employeeSheetRow,
          employeeId: employee.employeeId,
          employeeName: employee.employeeName,
          leaveType: application.leaveType,
          duration: application.duration,
          reason: application.reason,
          date: application.date,
        }));
    }),
  );

  const uniqueEmployees = new Map<number, OnLeaveEmployee>();
  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    for (const employee of result.value) {
      if (!uniqueEmployees.has(employee.employeeSheetRow)) {
        uniqueEmployees.set(employee.employeeSheetRow, employee);
      }
    }
  }

  return {
    employees: [...uniqueEmployees.values()].sort((a, b) =>
      a.employeeName.localeCompare(b.employeeName),
    ),
    totalEmployees: employees.length,
  };
}

export async function listEmployeesOnLeave(
  dateIso: string,
  now: Date = new Date(),
): Promise<OnLeaveDashboardData> {
  const cached = onLeaveCache.get(dateIso);
  if (cached && cached.expiresAt > Date.now()) {
    return filterEmployeesForDashboardView(cached.value, dateIso, now);
  }

  const pending = onLeaveRequests.get(dateIso);
  if (pending) {
    const value = await pending;
    return filterEmployeesForDashboardView(value, dateIso, now);
  }

  const request = loadEmployeesOnLeave(dateIso)
    .then((value) => {
      onLeaveCache.set(dateIso, {
        expiresAt: Date.now() + CACHE_TTL_MS,
        value,
      });
      return value;
    })
    .finally(() => {
      onLeaveRequests.delete(dateIso);
    });

  onLeaveRequests.set(dateIso, request);
  const value = await request;
  return filterEmployeesForDashboardView(value, dateIso, now);
}
