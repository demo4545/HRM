import { NextResponse } from "next/server";

import { ROLES } from "@/app/consts/common";
import { resolveAttendanceEmployeeBySheetRow } from "@/lib/attendance/employee";
import { listLeaveApplications } from "@/lib/attendance/leave-approvals";
import { LEAVE_STATUS } from "@/lib/attendance/leave-status";
import {
  getAttendanceRepository,
  hasAttendanceStorage,
  toAttendanceStorageRef,
} from "@/lib/attendance/repository";
import { withActiveSession } from "@/lib/auth/api-guard";
import { canManageEmployees } from "@/lib/auth/roles";
import { formatEmployeePositionLabel, sheetRowToForm } from "@/lib/employee";
import { summarizeEmployeePerformance } from "@/lib/employee/performance";
import { getEmployeeBySheetRow } from "@/lib/employees/repository";
import { toApiErrorMessage } from "@/lib/api/user-facing-error";
import { leaveDateToIso } from "@/lib/payroll/leave-attendance";

function lastDayOfMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

export const GET = withActiveSession(async (req, user) => {
  if (!canManageEmployees(user.role)) {
    return NextResponse.json({ success: false, message: "Forbidden" }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const sheetRow = Number(searchParams.get("employeeSheetRow"));
    const year = Number(searchParams.get("year"));
    const monthParam = searchParams.get("month");
    const month = monthParam == null || monthParam === "" ? null : Number(monthParam);

    if (!Number.isInteger(sheetRow) || sheetRow < 2) {
      return NextResponse.json({ success: false, message: "Select an employee" }, { status: 400 });
    }
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      return NextResponse.json({ success: false, message: "Invalid year" }, { status: 400 });
    }
    if (month != null && (!Number.isInteger(month) || month < 0 || month > 11)) {
      return NextResponse.json({ success: false, message: "Invalid month" }, { status: 400 });
    }

    const record = await getEmployeeBySheetRow(sheetRow);
    if (!record) {
      return NextResponse.json({ success: false, message: "Employee not found" }, { status: 404 });
    }

    const form = sheetRowToForm(record.headers, record.row);
    if (form.role.trim().toLowerCase() === ROLES.SUPER_ADMIN) {
      return NextResponse.json(
        { success: false, message: "Performance is not available for Super Admin" },
        { status: 400 },
      );
    }

    const employee = await resolveAttendanceEmployeeBySheetRow(sheetRow);
    const attendanceRepo = getAttendanceRepository();
    const monthIndexes =
      month != null
        ? [month]
        : Array.from({ length: 12 }, (_, index) => index).filter((index) => {
            const now = new Date();
            return year < now.getFullYear() || index <= now.getMonth();
          });

    let records: Awaited<ReturnType<typeof attendanceRepo.getMonthAttendance>> = [];
    if (employee && hasAttendanceStorage(employee)) {
      const storageRef = toAttendanceStorageRef(employee);
      const months = await Promise.all(
        monthIndexes.map((monthIndex) =>
          attendanceRepo.getMonthAttendance(storageRef, year, monthIndex),
        ),
      );
      records = months.flat();
    }

    const fromIso =
      month != null ? `${year}-${String(month + 1).padStart(2, "0")}-01` : `${year}-01-01`;
    const toIso =
      month != null
        ? `${year}-${String(month + 1).padStart(2, "0")}-${String(lastDayOfMonth(year, month)).padStart(2, "0")}`
        : `${year}-12-31`;

    let acceptedLeaveDays = 0;
    let pendingLeaveCount = 0;
    if (employee) {
      try {
        const leaves = await listLeaveApplications({
          employeeId: employee.employeeId,
          employeeName: employee.employeeName,
          attendanceSpreadsheetId: employee.attendanceSpreadsheetId,
        });
        for (const leave of leaves) {
          const dateIso = leaveDateToIso(leave.date);
          if (!dateIso || dateIso < fromIso || dateIso > toIso) continue;
          const status = leave.status.trim().toLowerCase();
          if (status === LEAVE_STATUS.APPLIED.toLowerCase()) pendingLeaveCount += 1;
          if (status === LEAVE_STATUS.ACCEPTED.toLowerCase()) {
            acceptedLeaveDays += Number(leave.days) || 0;
          }
        }
      } catch (error) {
        console.warn("[employee-performance] leave load failed:", error);
      }
    }

    const summary = summarizeEmployeePerformance(records, {
      groupBy: month != null ? "day" : "month",
    });

    return NextResponse.json({
      success: true,
      employee: {
        sheetRow,
        employeeId: form.employeeId,
        name: form.name,
        position: formatEmployeePositionLabel(form.position),
        joiningDate: form.joiningDate,
        status: form.status,
      },
      period: { year, month },
      summary,
      leave: {
        acceptedDays: Math.round(acceptedLeaveDays * 100) / 100,
        pendingCount: pendingLeaveCount,
      },
    });
  } catch (error) {
    console.error("GET employee performance error:", error);
    return NextResponse.json(
      {
        success: false,
        message: toApiErrorMessage(error, "Failed to load employee performance"),
      },
      { status: 500 },
    );
  }
});
