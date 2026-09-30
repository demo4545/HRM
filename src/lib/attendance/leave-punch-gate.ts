import { listLeaveApplications, type LeaveApplication } from "@/lib/attendance/leave-approvals";
import { leaveDaysFromDurationLabel } from "@/lib/attendance/leave-display";
import { LEAVE_STATUS } from "@/lib/attendance/leave-status";
import { formatIsoDate, getAppZonedParts } from "@/lib/attendance/time";
import { leaveDateToIso } from "@/lib/payroll/leave-attendance";

/** Punch is blocked for full-day leave during office hours (app timezone). */
export const LEAVE_PUNCH_BLOCK_START_HOUR = 9;
export const LEAVE_PUNCH_BLOCK_END_HOUR = 20; // 8:00 PM (exclusive)

export type LeavePunchBlock = {
  blocked: boolean;
  message: string;
  leaveType?: string;
  duration?: string;
};

export type LeavePunchAction = "punch-in" | "punch-out" | "break-start" | "break-end";

const OPEN_SESSION_ALLOWED_ACTIONS = new Set<LeavePunchAction>(["punch-out", "break-end"]);

function formatLeaveTypeLabel(leaveType: string): string {
  const labels: Record<string, string> = {
    paid: "paid",
    casual: "casual",
    sick: "sick",
    birthday: "birthday",
    unpaid: "unpaid",
  };
  return labels[leaveType] ?? leaveType;
}

function isHalfAmDuration(duration: string): boolean {
  const normalized = duration.trim().toLowerCase();
  return normalized.includes("half") && normalized.includes("am");
}

function isHalfPmDuration(duration: string): boolean {
  const normalized = duration.trim().toLowerCase();
  return normalized.includes("half") && normalized.includes("pm");
}

function isFullDayLeave(application: LeaveApplication): boolean {
  if (!application.duration.trim()) return true;
  return leaveDaysFromDurationLabel(application.duration) >= 1;
}

/**
 * Whether the current app-timezone clock falls inside the punch-block window
 * for this leave (full day = 9–20, half AM = 9–14, half PM = 14–20).
 */
export function isWithinLeavePunchBlockWindow(
  application: LeaveApplication,
  now: Date = new Date(),
): boolean {
  const { hour, minute } = getAppZonedParts(now);
  const minutes = hour * 60 + minute;

  if (isHalfAmDuration(application.duration)) {
    const start = LEAVE_PUNCH_BLOCK_START_HOUR * 60;
    const end = 14 * 60;
    return minutes >= start && minutes < end;
  }

  if (isHalfPmDuration(application.duration)) {
    const start = 14 * 60;
    const end = LEAVE_PUNCH_BLOCK_END_HOUR * 60;
    return minutes >= start && minutes < end;
  }

  const start = LEAVE_PUNCH_BLOCK_START_HOUR * 60;
  const end = LEAVE_PUNCH_BLOCK_END_HOUR * 60;
  return minutes >= start && minutes < end;
}

function leavesCoveringDate(applications: LeaveApplication[], dateIso: string): LeaveApplication[] {
  return applications.filter((application) => {
    if (application.status.trim().toLowerCase() !== LEAVE_STATUS.ACCEPTED.toLowerCase()) {
      return false;
    }
    return leaveDateToIso(application.date) === dateIso;
  });
}

export async function getLeavePunchBlock(params: {
  employeeId: string;
  employeeName: string;
  attendanceSpreadsheetId?: string;
  now?: Date;
}): Promise<LeavePunchBlock> {
  const now = params.now ?? new Date();
  const dateIso = formatIsoDate(now);

  if (!params.employeeId.trim()) {
    return { blocked: false, message: "" };
  }

  const applications = await listLeaveApplications({
    employeeId: params.employeeId,
    employeeName: params.employeeName,
    attendanceSpreadsheetId: params.attendanceSpreadsheetId ?? "",
    statusFilter: LEAVE_STATUS.ACCEPTED,
  });

  const todaysLeaves = leavesCoveringDate(applications, dateIso);
  const blockingLeave = todaysLeaves.find((leave) => isWithinLeavePunchBlockWindow(leave, now));

  if (!blockingLeave) {
    return { blocked: false, message: "" };
  }

  const leaveLabel = formatLeaveTypeLabel(blockingLeave.leaveType);

  return {
    blocked: true,
    leaveType: blockingLeave.leaveType,
    duration: blockingLeave.duration || (isFullDayLeave(blockingLeave) ? "Full Day" : ""),
    message: `You are on ${leaveLabel} leave today. Punch in/out is not available.`,
  };
}

export async function assertPunchAllowedWhileOnLeave(params: {
  employeeId: string;
  employeeName: string;
  attendanceSpreadsheetId?: string;
  now?: Date;
  action?: LeavePunchAction | string;
  /** Punched in and not yet punched out — may finish the session during the leave window. */
  hasOpenPunchSession?: boolean;
}): Promise<void> {
  const block = await getLeavePunchBlock(params);
  if (!block.blocked) return;

  const action = (params.action ?? "") as LeavePunchAction;
  if (params.hasOpenPunchSession && OPEN_SESSION_ALLOWED_ACTIONS.has(action)) {
    return;
  }

  throw new Error(block.message);
}
