import { NextResponse } from "next/server";

import { withActiveSession } from "@/lib/auth/api-guard";
import { canManageEmployees } from "@/lib/auth/roles";
import {
  buildLeaveApplicationId,
  getLeaveApplicationAtRow,
  reviewLeaveApplication,
} from "@/lib/attendance/leave-approvals";
import { LEAVE_STATUS } from "@/lib/attendance/leave-status";
import type { LeaveBucketType } from "@/lib/attendance/leave-bucket-layout";
import {
  findEmployeeByAttendanceSpreadsheetId,
  findEmployeeByEmployeeId,
} from "@/lib/notifications/employee-lookup";
import { notifyLeaveReviewed } from "@/lib/notifications/leave-events";
import { toApiErrorMessage } from "@/lib/api/user-facing-error";

function normalizeReviewStatus(
  value: unknown,
): typeof LEAVE_STATUS.ACCEPTED | typeof LEAVE_STATUS.REJECTED | null {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();

  if (normalized === "accepted" || normalized === "approve" || normalized === "approved") {
    return LEAVE_STATUS.ACCEPTED;
  }

  if (normalized === "rejected" || normalized === "reject") {
    return LEAVE_STATUS.REJECTED;
  }

  return null;
}

export const PATCH = withActiveSession(async (req, user) => {
  if (!canManageEmployees(user.role)) {
    return NextResponse.json({ success: false, message: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const employeeId = String(body.employeeId ?? "").trim();
    const attendanceSpreadsheetId = String(body.attendanceSpreadsheetId ?? "").trim();
    const rowIndex = Number(body.rowIndex);
    const leaveType = String(body.leaveType ?? "")
      .trim()
      .toLowerCase() as LeaveBucketType;
    const status = normalizeReviewStatus(body.status);
    const rejectReason = String(body.rejectReason ?? "").trim();

    if ((!employeeId && !attendanceSpreadsheetId) || !Number.isInteger(rowIndex) || rowIndex < 1) {
      return NextResponse.json(
        { success: false, message: "Invalid leave application reference" },
        { status: 400 },
      );
    }

    if (!status) {
      return NextResponse.json(
        { success: false, message: "Status must be Accepted or Rejected" },
        { status: 400 },
      );
    }

    const employee =
      (employeeId ? await findEmployeeByEmployeeId(employeeId) : null) ??
      (attendanceSpreadsheetId
        ? await findEmployeeByAttendanceSpreadsheetId(attendanceSpreadsheetId)
        : null);

    if (!employee) {
      return NextResponse.json(
        { success: false, message: "Employee not found for leave application" },
        { status: 404 },
      );
    }

    const resolvedSpreadsheetId = attendanceSpreadsheetId || employee.attendanceSpreadsheetId || "";

    const matchingApplication = await getLeaveApplicationAtRow({
      attendanceSpreadsheetId: resolvedSpreadsheetId,
      rowIndex,
      leaveType,
      employeeId: employee.employeeId,
      employeeName: employee.employeeName,
    });

    await reviewLeaveApplication({
      employeeId: employee.employeeId,
      attendanceSpreadsheetId: resolvedSpreadsheetId,
      rowIndex,
      leaveType,
      status,
      rejectReason,
    });

    let emailResult: { sent: boolean; reason?: string; to?: string } | undefined;

    try {
      const notifyResult = await notifyLeaveReviewed({
        context: {
          employeeSheetRow: employee.sheetRow,
          employeeId: employee.employeeId,
          employeeName: employee.employeeName,
          leaveType,
          dateRange: matchingApplication?.date ?? "your selected dates",
          duration: matchingApplication?.duration,
          reason: matchingApplication?.reason,
          applicationId: buildLeaveApplicationId({
            employeeId: employee.employeeId,
            attendanceSpreadsheetId: resolvedSpreadsheetId,
            rowIndex,
            leaveType,
          }),
        },
        status,
        rejectReason,
      });
      emailResult = notifyResult.email;
    } catch (notifyError) {
      console.error("Leave review notification error:", notifyError);
    }

    return NextResponse.json({
      success: true,
      message: `Leave request ${status.toLowerCase()}`,
      email: emailResult,
    });
  } catch (error) {
    console.error("PATCH Leave Review Error:", error);

    return NextResponse.json(
      {
        success: false,
        message: toApiErrorMessage(error, "Failed to review leave request"),
      },
      { status: 500 },
    );
  }
});
