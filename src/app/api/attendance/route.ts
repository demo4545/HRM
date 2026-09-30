import { NextResponse } from "next/server";

import {
  EARLY_LEAVE_REASON_MIN_LENGTH,
  IDEAL_BREAK_HOURS,
  IDEAL_SHIFT_HOURS,
  IDEAL_WORKING_HOURS,
  WORK_MODE_OPTIONS,
  idealWorkingHoursForWorkMode,
  isHalfDayUnpaidWorkMode,
} from "@/lib/attendance/constants";
import { formatBreakAllowance, parseDurationToMs, parseTimeOnDate } from "@/lib/attendance/time";
import { resolveAttendanceEmployeeForTarget } from "@/lib/attendance/employee";
import {
  computeLiveWorkedMs,
  getAttendanceRepository,
  hasAttendanceStorage,
  toAttendanceStorageRef,
} from "@/lib/attendance/repository";
import {
  formatDuration,
  formatDurationHms,
  monthLabel,
  parseMonthlySheetTitle,
} from "@/lib/attendance/time";
import { withActiveSession } from "@/lib/auth/api-guard";
import {
  roleCanPunchInOut,
  roleRequiresAbsenceExplanationGate,
} from "@/lib/attendance/absence-gate";
import {
  applyAbsenceGateCookie,
  invalidateAbsenceExplanationCache,
} from "@/lib/attendance/absence-gate-sync";
import { clearMorningPunchGateCookie } from "@/lib/attendance/absence-gate-cookie";
import { canManageEmployees } from "@/lib/auth/roles";
import { formatGoogleApiClientMessage } from "@/lib/google/drive-auth";
import { invalidateUnapprovedAbsenceCache } from "@/lib/attendance/unapproved-absence";
import {
  assertPunchAllowedWhileOnLeave,
  getLeavePunchBlock,
} from "@/lib/attendance/leave-punch-gate";
import { notificationDateIso } from "@/lib/notifications/automation-date";

function parseTargetSheetRow(searchParams: URLSearchParams, userSheetRow?: number) {
  const param = searchParams.get("employeeSheetRow");
  if (param == null || param === "") return userSheetRow;
  const parsed = parseInt(param, 10);
  return Number.isFinite(parsed) && parsed >= 2 ? parsed : userSheetRow;
}

export const GET = withActiveSession(async (req, user) => {
  try {
    const { searchParams } = new URL(req.url);
    const targetSheetRow = parseTargetSheetRow(searchParams, user.sheetRow);
    const employee = await resolveAttendanceEmployeeForTarget(user, targetSheetRow);
    if (!hasAttendanceStorage(employee)) {
      return NextResponse.json(
        { success: false, message: "Employee attendance record not found" },
        { status: 404 },
      );
    }

    const storageRef = toAttendanceStorageRef(employee!);
    const attendanceRepo = getAttendanceRepository();
    const mode = searchParams.get("mode");

    if (mode === "periods") {
      const sheets = await attendanceRepo.listMonthlySheetsAcrossYears(storageRef);
      const years = new Set<number>();
      const monthsByYear = new Map<number, number[]>();

      for (const title of sheets) {
        const parsed = parseMonthlySheetTitle(title);
        if (!parsed) continue;
        years.add(parsed.year);
        const months = monthsByYear.get(parsed.year) ?? [];
        if (!months.includes(parsed.month)) {
          months.push(parsed.month);
        }
        monthsByYear.set(parsed.year, months);
      }

      const sortedYears = [...years].sort((a, b) => b - a);
      const periods = sortedYears.map((year) => ({
        year,
        months: (monthsByYear.get(year) ?? [])
          .sort((a, b) => a - b)
          .map((month) => ({
            month,
            label: monthLabel(month),
          })),
      }));

      return NextResponse.json({ success: true, periods });
    }

    const yearParam = searchParams.get("year");
    const monthParam = searchParams.get("month");

    if (yearParam != null && monthParam != null) {
      const year = parseInt(yearParam, 10);
      const month = parseInt(monthParam, 10);
      if (!Number.isFinite(year) || !Number.isFinite(month) || month < 0 || month > 11) {
        return NextResponse.json(
          { success: false, message: "Invalid year or month" },
          { status: 400 },
        );
      }

      const records = await attendanceRepo.getMonthAttendance(storageRef, year, month);

      return NextResponse.json({
        success: true,
        records: records.map((r) => ({
          id: r.date,
          date: r.date,
          workMode: r.workMode,
          punchIn: r.punchIn,
          punchOut: r.punchOut,
          breakStart: r.breakStart,
          breakEnd: r.breakEnd,
          breakTime: r.totalBreakTime,
          workingHours: r.workingHours,
          overtime: r.overtime,
          status: r.status,
          overtimeApproval: r.isOvertimeApproved,
          earlyLeaveReason: r.earlyLeaveReason,
          dailyUpdate: r.dailyUpdate,
        })),
      });
    }

    const [today, leavePunchBlock] = await Promise.all([
      attendanceRepo.getTodayAttendance(storageRef),
      getLeavePunchBlock({
        employeeId: employee!.employeeId,
        employeeName: employee!.employeeName,
        attendanceSpreadsheetId: employee!.attendanceSpreadsheetId,
      }),
    ]);
    const workedMs = today ? computeLiveWorkedMs(today) : 0;
    const idealHours = idealWorkingHoursForWorkMode(today?.workMode);
    const idealBreakHours = isHalfDayUnpaidWorkMode(today?.workMode) ? 0 : IDEAL_BREAK_HOURS;
    const idealMs = idealHours * 60 * 60 * 1000;
    const remainingMs = Math.max(0, idealMs - workedMs);
    const onBreak = Boolean(today?.breakStart?.trim() && !today?.breakEnd?.trim());
    let breakUsedMs = today ? parseDurationToMs(today.totalBreakTime) : 0;
    if (today && onBreak && today.breakStart) {
      const breakStartMs = parseTimeOnDate(today.breakStart, new Date(today.date));
      if (breakStartMs != null) {
        breakUsedMs += Math.max(0, Date.now() - breakStartMs);
      }
    }

    return NextResponse.json({
      success: true,
      leavePunchBlock,
      today: today
        ? {
            date: today.date,
            punchIn: today.punchIn,
            punchOut: today.punchOut,
            workMode: today.workMode,
            breakStart: today.breakStart,
            breakEnd: today.breakEnd,
            totalBreakTime: today.totalBreakTime,
            workingHours: today.workingHours,
            overtime: today.punchOut.trim() ? today.overtime : "—",
            status: today.status,
            onBreak,
            hasPunchedIn: Boolean(today.punchIn?.trim()),
            hasPunchedOut: Boolean(today.punchOut?.trim()),
            workedMs,
            workedFormatted: formatDurationHms(workedMs),
            workedShort: formatDuration(workedMs),
            idealHours,
            idealBreakHours,
            idealShiftHours: idealHours + idealBreakHours,
            remainingMs,
            remainingFormatted: formatDuration(remainingMs),
            breakAllowanceFormatted: formatBreakAllowance(breakUsedMs),
            earlyLeaveReason: today.earlyLeaveReason ?? "",
            dailyUpdate: today.dailyUpdate ?? "",
            leavePunchBlocked: leavePunchBlock.blocked,
            leavePunchBlockMessage: leavePunchBlock.message,
          }
        : {
            date: notificationDateIso(),
            punchIn: "",
            punchOut: "",
            workMode: "",
            breakStart: "",
            breakEnd: "",
            totalBreakTime: "",
            workingHours: "",
            overtime: "—",
            status: "",
            onBreak: false,
            hasPunchedIn: false,
            hasPunchedOut: false,
            workedMs: 0,
            workedFormatted: "0h 0m 0s",
            workedShort: "0h",
            idealHours: IDEAL_WORKING_HOURS,
            idealBreakHours: IDEAL_BREAK_HOURS,
            idealShiftHours: IDEAL_SHIFT_HOURS,
            remainingMs: IDEAL_WORKING_HOURS * 60 * 60 * 1000,
            remainingFormatted: formatDuration(IDEAL_WORKING_HOURS * 60 * 60 * 1000),
            breakAllowanceFormatted: formatBreakAllowance(0),
            earlyLeaveReason: "",
            dailyUpdate: "",
            leavePunchBlocked: leavePunchBlock.blocked,
            leavePunchBlockMessage: leavePunchBlock.message,
          },
    });
  } catch (error: unknown) {
    const message = formatGoogleApiClientMessage(error, {
      forHrAdmin: canManageEmployees(user.role),
    });
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
});

export const POST = withActiveSession(async (req, user) => {
  try {
    const employee = await resolveAttendanceEmployeeForTarget(user, user.sheetRow);
    if (!hasAttendanceStorage(employee)) {
      return NextResponse.json(
        { success: false, message: "Employee attendance record not found" },
        { status: 404 },
      );
    }

    const storageRef = toAttendanceStorageRef(employee!);
    const attendanceRepo = getAttendanceRepository();
    const body = await req.json();
    const action = String(body.action ?? "");
    const punchActions = new Set(["punch-in", "punch-out", "break-start", "break-end"]);

    if (punchActions.has(action) && !roleCanPunchInOut(user.role)) {
      return NextResponse.json(
        { success: false, message: "Punch in/out is not available for your role" },
        { status: 403 },
      );
    }

    if (punchActions.has(action)) {
      try {
        const todayBeforeAction = await attendanceRepo.getTodayAttendance(storageRef);
        const hasOpenPunchSession = Boolean(
          todayBeforeAction?.punchIn?.trim() && !todayBeforeAction?.punchOut?.trim(),
        );
        await assertPunchAllowedWhileOnLeave({
          employeeId: employee!.employeeId,
          employeeName: employee!.employeeName,
          attendanceSpreadsheetId: employee!.attendanceSpreadsheetId,
          action,
          hasOpenPunchSession,
        });
      } catch (leaveError) {
        return NextResponse.json(
          {
            success: false,
            message:
              leaveError instanceof Error
                ? leaveError.message
                : "Punch is not available while you are on leave",
          },
          { status: 400 },
        );
      }
    }

    const earlyLeaveReason =
      typeof body.earlyLeaveReason === "string" ? body.earlyLeaveReason.trim() : "";
    const dailyUpdate = typeof body.dailyUpdate === "string" ? body.dailyUpdate.trim() : "";
    const workMode = typeof body.workMode === "string" ? body.workMode.trim() : "";

    if (action === "punch-out" && earlyLeaveReason.length > 0) {
      if (earlyLeaveReason.length < EARLY_LEAVE_REASON_MIN_LENGTH) {
        return NextResponse.json(
          {
            success: false,
            message: `Early leave reason must be at least ${EARLY_LEAVE_REASON_MIN_LENGTH} characters`,
          },
          { status: 400 },
        );
      }
    }
    if (action === "punch-out" && !dailyUpdate) {
      return NextResponse.json(
        { success: false, message: "Please share today's completed tasks before punch out" },
        { status: 400 },
      );
    }

    let record;
    switch (action) {
      case "punch-in":
        if (
          !workMode ||
          !WORK_MODE_OPTIONS.includes(workMode as (typeof WORK_MODE_OPTIONS)[number])
        ) {
          return NextResponse.json(
            { success: false, message: "Please select a valid work mode before punch in" },
            { status: 400 },
          );
        }
        record = await attendanceRepo.punchIn(storageRef, new Date(), { workMode });
        break;
      case "punch-out":
        record = await attendanceRepo.punchOut(storageRef, new Date(), {
          earlyLeaveReason: earlyLeaveReason || undefined,
          dailyUpdate,
        });
        break;
      case "break-start":
        record = await attendanceRepo.startBreak(storageRef);
        break;
      case "break-end":
        record = await attendanceRepo.endBreak(storageRef);
        break;
      default:
        return NextResponse.json({ success: false, message: "Invalid action" }, { status: 400 });
    }

    const workedMs = computeLiveWorkedMs(record);

    const res = NextResponse.json({
      success: true,
      record: {
        date: record.date,
        punchIn: record.punchIn,
        punchOut: record.punchOut,
        workMode: record.workMode,
        breakStart: record.breakStart,
        breakEnd: record.breakEnd,
        totalBreakTime: record.totalBreakTime,
        workingHours: record.workingHours,
        overtime: record.overtime,
        status: record.status,
        onBreak: Boolean(record.breakStart?.trim() && !record.breakEnd?.trim()),
        hasPunchedIn: Boolean(record.punchIn?.trim()),
        hasPunchedOut: Boolean(record.punchOut?.trim()),
        workedMs,
        workedFormatted: formatDurationHms(workedMs),
        earlyLeaveReason: record.earlyLeaveReason ?? "",
        dailyUpdate: record.dailyUpdate ?? "",
        idealHours: idealWorkingHoursForWorkMode(record.workMode),
        idealBreakHours: isHalfDayUnpaidWorkMode(record.workMode) ? 0 : IDEAL_BREAK_HOURS,
        idealShiftHours:
          idealWorkingHoursForWorkMode(record.workMode) +
          (isHalfDayUnpaidWorkMode(record.workMode) ? 0 : IDEAL_BREAK_HOURS),
      },
    });

    if (action === "punch-in") {
      invalidateUnapprovedAbsenceCache(notificationDateIso());
      clearMorningPunchGateCookie(res);
      if (roleRequiresAbsenceExplanationGate(user.role)) {
        invalidateAbsenceExplanationCache(employee!.employeeId);
        await applyAbsenceGateCookie(res, user, { forceRefresh: true });
      }
    }

    return res;
  } catch (error: unknown) {
    const message = formatGoogleApiClientMessage(error, {
      forHrAdmin: canManageEmployees(user.role),
    });
    const status =
      message.includes("Already") ||
      message.includes("first") ||
      message.includes("break") ||
      message.includes("reason") ||
      message.includes("tasks")
        ? 400
        : 500;
    return NextResponse.json({ success: false, message }, { status });
  }
});

export const PATCH = withActiveSession(async (req, user) => {
  try {
    const employee = await resolveAttendanceEmployeeForTarget(user, user.sheetRow);
    if (!hasAttendanceStorage(employee)) {
      return NextResponse.json(
        { success: false, message: "Employee attendance record not found" },
        { status: 404 },
      );
    }

    const storageRef = toAttendanceStorageRef(employee!);
    const attendanceRepo = getAttendanceRepository();
    const body = await req.json();
    const date = typeof body.date === "string" ? body.date.trim() : "";
    const dailyUpdate = typeof body.dailyUpdate === "string" ? body.dailyUpdate.trim() : "";
    if (!date) {
      return NextResponse.json(
        { success: false, message: "Date is required for daily update" },
        { status: 400 },
      );
    }
    if (!dailyUpdate) {
      return NextResponse.json(
        { success: false, message: "Daily update cannot be empty" },
        { status: 400 },
      );
    }

    const record = await attendanceRepo.updateDailyUpdate(storageRef, date, dailyUpdate);
    const workedMs = computeLiveWorkedMs(record);

    return NextResponse.json({
      success: true,
      record: {
        date: record.date,
        punchIn: record.punchIn,
        punchOut: record.punchOut,
        workMode: record.workMode,
        breakStart: record.breakStart,
        breakEnd: record.breakEnd,
        totalBreakTime: record.totalBreakTime,
        workingHours: record.workingHours,
        overtime: record.overtime,
        status: record.status,
        onBreak: Boolean(record.breakStart?.trim() && !record.breakEnd?.trim()),
        hasPunchedIn: Boolean(record.punchIn?.trim()),
        hasPunchedOut: Boolean(record.punchOut?.trim()),
        workedMs,
        workedFormatted: formatDurationHms(workedMs),
        earlyLeaveReason: record.earlyLeaveReason ?? "",
        dailyUpdate: record.dailyUpdate ?? "",
        idealHours: idealWorkingHoursForWorkMode(record.workMode),
        idealBreakHours: isHalfDayUnpaidWorkMode(record.workMode) ? 0 : IDEAL_BREAK_HOURS,
        idealShiftHours:
          idealWorkingHoursForWorkMode(record.workMode) +
          (isHalfDayUnpaidWorkMode(record.workMode) ? 0 : IDEAL_BREAK_HOURS),
      },
    });
  } catch (error: unknown) {
    const message = formatGoogleApiClientMessage(error, {
      forHrAdmin: canManageEmployees(user.role),
    });
    const status = message.includes("required") || message.includes("empty") ? 400 : 500;
    return NextResponse.json({ success: false, message }, { status });
  }
});
