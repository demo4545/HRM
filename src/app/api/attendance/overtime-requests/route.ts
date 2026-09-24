import { NextResponse } from "next/server";

import { OVERTIME_REQUEST_STATUS, WORKING_STATUS } from "@/lib/attendance/constants";
import {
  createOvertimeRequest,
  getOvertimeRequestById,
  listOvertimeRequests,
  reviewOvertimeRequest,
} from "@/lib/attendance/overtime-requests";
import {
  resolveAttendanceEmployee,
  resolveAttendanceEmployeeForTarget,
} from "@/lib/attendance/employee";
import {
  getAttendanceRepository,
  hasAttendanceStorage,
  toAttendanceStorageRef,
} from "@/lib/attendance/repository";
import { withActiveSession } from "@/lib/auth/api-guard";
import {
  canManageEmployees,
  canReviewOvertime,
  canReviewOvertimeRequest,
} from "@/lib/auth/server";
import { toApiErrorMessage } from "@/lib/api/user-facing-error";

function isPositiveOvertime(value: string): boolean {
  const overtime = value.trim();
  if (!overtime || overtime === "—" || overtime.startsWith("-")) return false;
  return /\d/.test(overtime);
}

export const GET = withActiveSession(async (_req, user) => {
  try {
    const canViewAll = canManageEmployees(user.role);
    const employee = await resolveAttendanceEmployee(user);
    const requests = await listOvertimeRequests(
      canViewAll ? {} : { employeeId: employee?.employeeId },
    );
    return NextResponse.json({ success: true, requests });
  } catch (error: unknown) {
    const message = toApiErrorMessage(error, "Failed to load overtime requests");
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
});

export const POST = withActiveSession(async (req, user) => {
  try {
    const body = await req.json();
    const employeeSheetRowParam = body.employeeSheetRow;
    const targetSheetRow =
      employeeSheetRowParam != null && employeeSheetRowParam !== ""
        ? parseInt(String(employeeSheetRowParam), 10)
        : user.sheetRow;
    const employee = await resolveAttendanceEmployeeForTarget(
      user,
      Number.isFinite(targetSheetRow) ? targetSheetRow : user.sheetRow,
    );
    if (!hasAttendanceStorage(employee)) {
      return NextResponse.json(
        { success: false, message: "Employee attendance record not found" },
        { status: 404 },
      );
    }

    const date = String(body.date ?? "").trim();
    const comment = String(body.comment ?? "").trim();

    if (!date) {
      return NextResponse.json(
        { success: false, message: "Date is required for overtime request" },
        { status: 400 },
      );
    }

    const [yearText, monthText] = date.split("-");
    const year = parseInt(yearText ?? "", 10);
    const month = parseInt(monthText ?? "", 10) - 1;
    if (!Number.isFinite(year) || !Number.isFinite(month) || month < 0 || month > 11) {
      return NextResponse.json({ success: false, message: "Invalid date" }, { status: 400 });
    }

    const storageRef = toAttendanceStorageRef(employee!);
    const target = await getAttendanceRepository().getAttendanceForDate(storageRef, date);
    if (!target) {
      return NextResponse.json(
        { success: false, message: "Attendance record not found for selected date" },
        { status: 404 },
      );
    }
    if (!target.punchOut.trim()) {
      return NextResponse.json(
        { success: false, message: "Punch out is required before requesting overtime approval" },
        { status: 400 },
      );
    }
    if (!isPositiveOvertime(target.overtime)) {
      return NextResponse.json(
        { success: false, message: "This date has no positive overtime" },
        { status: 400 },
      );
    }
    if (
      target.status === WORKING_STATUS.IN_PROGRESS ||
      target.status === WORKING_STATUS.ABSENT ||
      target.status === WORKING_STATUS.ON_LEAVE
    ) {
      return NextResponse.json(
        { success: false, message: "Overtime request is not allowed for this attendance status" },
        { status: 400 },
      );
    }

    const request = await createOvertimeRequest({
      employee: employee!,
      date,
      overtime: target.overtime,
      comment,
      requestedByRole: user.role,
    });
    return NextResponse.json({ success: true, request });
  } catch (error: unknown) {
    const message = toApiErrorMessage(error, "Failed to create overtime request");
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
});

export const PATCH = withActiveSession(async (req, user) => {
  try {
    if (!canReviewOvertime(user.role)) {
      return NextResponse.json(
        { success: false, message: "Not authorized to review overtime requests" },
        { status: 403 },
      );
    }

    const body = await req.json();
    const id = String(body.id ?? "").trim();
    const status = String(body.status ?? "").trim();
    const remarks = String(body.remarks ?? "").trim();

    if (!id) {
      return NextResponse.json(
        { success: false, message: "Overtime request id is required" },
        { status: 400 },
      );
    }
    if (
      status !== OVERTIME_REQUEST_STATUS.APPROVED &&
      status !== OVERTIME_REQUEST_STATUS.REJECTED
    ) {
      return NextResponse.json(
        { success: false, message: "Status must be Approved or Rejected" },
        { status: 400 },
      );
    }

    const existing = await getOvertimeRequestById(id);
    if (!existing) {
      return NextResponse.json(
        { success: false, message: "Overtime request not found" },
        { status: 404 },
      );
    }
    if (!canReviewOvertimeRequest(user.role, existing.requestedByRole)) {
      return NextResponse.json(
        {
          success: false,
          message: "Only Super Admin can accept or reject overtime requests submitted by HR",
        },
        { status: 403 },
      );
    }

    const request = await reviewOvertimeRequest({
      id,
      status,
      remarks,
      reviewerName: user.name,
    });
    return NextResponse.json({ success: true, request });
  } catch (error: unknown) {
    const message = toApiErrorMessage(error, "Failed to review overtime request");
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
});
