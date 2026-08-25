import {
  OVERTIME_APPROVAL,
  WORK_MODE,
  WORKING_STATUS,
  canonicalizeWorkMode,
} from "@/lib/attendance/constants";
import { formatDuration, parseDurationToMs } from "@/lib/attendance/time";

export type PerformanceAttendanceDay = {
  date: string;
  workMode: string;
  punchIn: string;
  punchOut: string;
  workingHours: string;
  overtime: string;
  status: string;
  isOvertimeApproved: string;
  dailyUpdate?: string;
};

export type NamedCount = {
  name: string;
  value: number;
};

export type HoursPoint = {
  label: string;
  hours: number;
  overtimeHours: number;
};

export type EmployeePerformanceSummary = {
  presentDays: number;
  leaveDays: number;
  absentDays: number;
  holidayDays: number;
  shortHoursDays: number;
  overtimeDays: number;
  completedDays: number;
  inProgressDays: number;
  autoPunchOutDays: number;
  workedMs: number;
  overtimeMs: number;
  approvedOvertimeMs: number;
  avgWorkedMs: number;
  workedLabel: string;
  overtimeLabel: string;
  approvedOvertimeLabel: string;
  avgWorkedLabel: string;
  hoursSeries: HoursPoint[];
  workModeMix: NamedCount[];
  statusMix: NamedCount[];
  leaveMix: NamedCount[];
};

const LEAVE_MODES = new Set<string>([
  WORK_MODE.PAID_LEAVE,
  WORK_MODE.SICK_LEAVE,
  WORK_MODE.CASUAL_LEAVE,
  WORK_MODE.UNPAID_LEAVE,
  WORK_MODE.HALF_DAY_PAID_LEAVE,
  WORK_MODE.HALF_DAY_UNPAID_LEAVE,
]);

const HOLIDAY_MODES = new Set<string>([WORK_MODE.PUBLIC_HOLIDAY, WORK_MODE.WEEKEND_HOLIDAY]);

const HALF_DAY_MODES = new Set<string>([
  WORK_MODE.HALF_DAY_PAID_LEAVE,
  WORK_MODE.HALF_DAY_UNPAID_LEAVE,
  WORK_MODE.WFH_HALF_DAY,
]);

function durationHours(value: string): number {
  const ms = parseDurationToMs(value);
  if (ms <= 0) return 0;
  return Math.round((ms / (1000 * 60 * 60)) * 100) / 100;
}

function leaveWeight(workMode: string): number {
  return HALF_DAY_MODES.has(workMode) ? 0.5 : 1;
}

function leaveLabel(workMode: string): string {
  if (workMode === WORK_MODE.PAID_LEAVE || workMode === WORK_MODE.HALF_DAY_PAID_LEAVE) {
    return "Paid";
  }
  if (workMode === WORK_MODE.SICK_LEAVE) return "Sick";
  if (workMode === WORK_MODE.CASUAL_LEAVE) return "Casual";
  if (workMode === WORK_MODE.UNPAID_LEAVE || workMode === WORK_MODE.HALF_DAY_UNPAID_LEAVE) {
    return "Unpaid";
  }
  return workMode || "Leave";
}

function workModeGroup(workMode: string): string {
  if (workMode === WORK_MODE.FULL_DAY_ONSITE) return "Onsite";
  if (workMode === WORK_MODE.WFH || workMode === WORK_MODE.WFH_HALF_DAY) return "WFH";
  if (LEAVE_MODES.has(workMode)) return "Leave";
  if (HOLIDAY_MODES.has(workMode)) return "Holiday";
  return workMode || "Other";
}

function bump(map: Map<string, number>, key: string, amount = 1): void {
  if (!key) return;
  map.set(key, (map.get(key) ?? 0) + amount);
}

function toNamedCounts(map: Map<string, number>): NamedCount[] {
  return [...map.entries()]
    .filter(([, value]) => value > 0)
    .map(([name, value]) => ({ name, value: Math.round(value * 100) / 100 }))
    .sort((a, b) => b.value - a.value);
}

function dayLabel(dateIso: string): string {
  const day = dateIso.slice(8, 10);
  return day.replace(/^0/, "") || dateIso;
}

export function summarizeEmployeePerformance(
  records: PerformanceAttendanceDay[],
  options: { groupBy: "day" | "month" },
): EmployeePerformanceSummary {
  let presentDays = 0;
  let leaveDays = 0;
  let absentDays = 0;
  let holidayDays = 0;
  let shortHoursDays = 0;
  let overtimeDays = 0;
  let completedDays = 0;
  let inProgressDays = 0;
  let autoPunchOutDays = 0;
  let workedMs = 0;
  let overtimeMs = 0;
  let approvedOvertimeMs = 0;

  const workModeMap = new Map<string, number>();
  const statusMap = new Map<string, number>();
  const leaveMap = new Map<string, number>();
  const hoursByKey = new Map<string, { hours: number; overtimeHours: number }>();

  for (const record of records) {
    const dateIso = String(record.date ?? "").trim();
    if (!dateIso) continue;

    const workMode = canonicalizeWorkMode(record.workMode);
    const status = String(record.status ?? "").trim() || "Unknown";
    const punchIn = String(record.punchIn ?? "").trim();
    const dayWorkedMs = parseDurationToMs(record.workingHours);
    const dayOvertimeMs = parseDurationToMs(record.overtime);
    const approved = String(record.isOvertimeApproved ?? "").trim() === OVERTIME_APPROVAL.ACCEPTED;

    workedMs += dayWorkedMs;
    overtimeMs += dayOvertimeMs;
    if (approved) approvedOvertimeMs += dayOvertimeMs;

    bump(workModeMap, workModeGroup(workMode));
    bump(statusMap, status);

    if (LEAVE_MODES.has(workMode)) {
      const weight = leaveWeight(workMode);
      leaveDays += weight;
      bump(leaveMap, leaveLabel(workMode), weight);
    } else if (HOLIDAY_MODES.has(workMode)) {
      holidayDays += 1;
    } else if (status === WORKING_STATUS.ABSENT) {
      absentDays += 1;
    } else if (punchIn || dayWorkedMs > 0) {
      presentDays += 1;
    }

    if (status === WORKING_STATUS.SHORT) shortHoursDays += 1;
    if (status === WORKING_STATUS.OVERTIME || status === WORKING_STATUS.OVERTIME_APPROVED) {
      overtimeDays += 1;
    }
    if (status === WORKING_STATUS.COMPLETED) completedDays += 1;
    if (status === WORKING_STATUS.IN_PROGRESS) inProgressDays += 1;
    if (
      String(record.dailyUpdate ?? "")
        .toLowerCase()
        .includes("auto punch-out")
    ) {
      autoPunchOutDays += 1;
    }

    const key = options.groupBy === "month" ? dateIso.slice(0, 7) : dateIso;
    const existing = hoursByKey.get(key) ?? { hours: 0, overtimeHours: 0 };
    existing.hours += durationHours(record.workingHours);
    existing.overtimeHours += durationHours(record.overtime);
    hoursByKey.set(key, existing);
  }

  const hoursSeries = [...hoursByKey.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => ({
      label:
        options.groupBy === "month"
          ? new Date(`${key}-01T12:00:00`).toLocaleString("en-IN", { month: "short" })
          : dayLabel(key),
      hours: Math.round(value.hours * 100) / 100,
      overtimeHours: Math.round(value.overtimeHours * 100) / 100,
    }));

  const avgWorkedMs = presentDays > 0 ? Math.round(workedMs / presentDays) : 0;

  return {
    presentDays,
    leaveDays: Math.round(leaveDays * 100) / 100,
    absentDays,
    holidayDays,
    shortHoursDays,
    overtimeDays,
    completedDays,
    inProgressDays,
    autoPunchOutDays,
    workedMs,
    overtimeMs,
    approvedOvertimeMs,
    avgWorkedMs,
    workedLabel: formatDuration(workedMs),
    overtimeLabel: formatDuration(overtimeMs),
    approvedOvertimeLabel: formatDuration(approvedOvertimeMs),
    avgWorkedLabel: formatDuration(avgWorkedMs),
    hoursSeries,
    workModeMix: toNamedCounts(workModeMap),
    statusMix: toNamedCounts(statusMap),
    leaveMix: toNamedCounts(leaveMap),
  };
}
