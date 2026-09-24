import { NextResponse } from "next/server";

import { ROLES } from "@/app/consts/common";
import { withActiveSession } from "@/lib/auth/api-guard";
import { canManageEmployees } from "@/lib/auth/roles";
import { sheetRowToForm } from "@/lib/employee";
import { getEmployeeBySheetRow } from "@/lib/employees/repository";
import { formatGoogleApiClientMessage } from "@/lib/google/drive-auth";
import { toApiErrorMessage } from "@/lib/api/user-facing-error";
import {
  cancelSalaryAdvance,
  createSalaryAdvance,
  enrichAdvanceForDisplay,
  getAdvanceWindowSummary,
  listSalaryAdvances,
  nextMonthFromDate,
  SALARY_ADVANCE_STATUS,
  updateSalaryAdvance,
  type SalaryAdvanceScheduleSegment,
  type SalaryAdvanceStatus,
} from "@/lib/salary-advances";

function isSuperAdminRole(role: string): boolean {
  return role.trim().toLowerCase() === ROLES.SUPER_ADMIN;
}

/** Resolve employee from the same source as the employee list (`DAILY_DATA_STORAGE`). */
async function resolveEmployeeForm(sheetRow: number) {
  const record = await getEmployeeBySheetRow(sheetRow);
  if (!record) return null;
  const form = sheetRowToForm(record.headers, record.row);
  if (!form.name.trim()) return null;
  return form;
}

export const GET = withActiveSession(async (req, user) => {
  if (!canManageEmployees(user.role)) {
    return NextResponse.json({ success: false, message: "Forbidden" }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const employeeSheetRow = Number(searchParams.get("employeeSheetRow") ?? "");
    const status = String(searchParams.get("status") ?? "").trim() as SalaryAdvanceStatus | "";
    const previewRow = Number(searchParams.get("previewEmployeeSheetRow") ?? "");

    if (searchParams.has("previewEmployeeSheetRow")) {
      if (!Number.isInteger(previewRow) || previewRow < 2) {
        return NextResponse.json(
          { success: false, message: "Valid employeeSheetRow is required for preview" },
          { status: 400 },
        );
      }

      const form = await resolveEmployeeForm(previewRow);
      if (!form) {
        return NextResponse.json(
          { success: false, message: "Employee not found" },
          { status: 404 },
        );
      }
      if (isSuperAdminRole(form.role)) {
        return NextResponse.json(
          { success: false, message: "Salary advances are not available for Super Admin" },
          { status: 400 },
        );
      }
      const startYearParam = Number(searchParams.get("startYear") ?? "");
      const startMonthParam = Number(searchParams.get("startMonth") ?? "");
      const hasCustomStart =
        Number.isInteger(startYearParam) &&
        Number.isInteger(startMonthParam) &&
        startMonthParam >= 1 &&
        startMonthParam <= 12;
      const window = getAdvanceWindowSummary({
        lastIncrementDate: form.lastIncrementDate,
        joiningDate: form.joiningDate,
        startYear: hasCustomStart ? startYearParam : undefined,
        startMonth: hasCustomStart ? startMonthParam : undefined,
      });
      const defaultStart = nextMonthFromDate();
      const earliestWindow = getAdvanceWindowSummary({
        lastIncrementDate: form.lastIncrementDate,
        joiningDate: form.joiningDate,
        startYear: defaultStart.year,
        startMonth: defaultStart.month,
      });
      // Selectable starts: current month through month before next increment
      const selectable = getAdvanceWindowSummary({
        lastIncrementDate: form.lastIncrementDate,
        joiningDate: form.joiningDate,
        startYear: new Date().getFullYear(),
        startMonth: new Date().getMonth() + 1,
      });

      return NextResponse.json({
        success: true,
        preview: {
          employeeSheetRow: previewRow,
          employeeId: form.employeeId,
          employeeName: form.name,
          salary: form.salary,
          lastIncrementDate: form.lastIncrementDate,
          joiningDate: form.joiningDate,
          nextIncrementDate: window.nextIncrementDate,
          availableMonthCount: window.availableMonthCount,
          availableMonths: window.availableMonths,
          selectableStartMonths: selectable.availableMonths,
          defaultStart,
          // Helpful when checking equal EMI capacity from next month
          nextMonthAvailableCount: earliestWindow.availableMonthCount,
        },
      });
    }

    const advances = await listSalaryAdvances({
      employeeSheetRow:
        Number.isInteger(employeeSheetRow) && employeeSheetRow >= 2 ? employeeSheetRow : undefined,
      status:
        status === SALARY_ADVANCE_STATUS.ACTIVE ||
        status === SALARY_ADVANCE_STATUS.COMPLETED ||
        status === SALARY_ADVANCE_STATUS.CANCELLED
          ? status
          : undefined,
    });

    return NextResponse.json({
      success: true,
      advances: advances.map((advance) => enrichAdvanceForDisplay(advance)),
    });
  } catch (error) {
    console.error("GET salary advances error:", error);
    return NextResponse.json(
      {
        success: false,
        message: formatGoogleApiClientMessage(error) || "Failed to load salary advances",
      },
      { status: 500 },
    );
  }
});

export const POST = withActiveSession(async (req, user) => {
  if (!canManageEmployees(user.role)) {
    return NextResponse.json({ success: false, message: "Forbidden" }, { status: 403 });
  }

  try {
    const body = (await req.json()) as Record<string, unknown>;
    const employeeSheetRow = Number(body.employeeSheetRow);
    const totalAmount = Number(body.totalAmount);
    const reason = String(body.reason ?? "").trim();
    const startYear = Number(body.startYear);
    const startMonth = Number(body.startMonth);
    const rawSegments = Array.isArray(body.segments) ? body.segments : [];

    if (!Number.isInteger(employeeSheetRow) || employeeSheetRow < 2) {
      return NextResponse.json(
        { success: false, message: "Valid employee is required" },
        { status: 400 },
      );
    }
    if (!(totalAmount > 0)) {
      return NextResponse.json(
        { success: false, message: "Advance amount must be greater than 0" },
        { status: 400 },
      );
    }
    if (!reason) {
      return NextResponse.json({ success: false, message: "Reason is required" }, { status: 400 });
    }

    const segments: SalaryAdvanceScheduleSegment[] = rawSegments.map((segment) => {
      const row = segment as Record<string, unknown>;
      return {
        months: Number(row.months),
        amountPerMonth: Number(row.amountPerMonth),
      };
    });

    const form = await resolveEmployeeForm(employeeSheetRow);
    if (!form) {
      return NextResponse.json({ success: false, message: "Employee not found" }, { status: 404 });
    }
    if (isSuperAdminRole(form.role)) {
      return NextResponse.json(
        { success: false, message: "Salary advances are not available for Super Admin" },
        { status: 400 },
      );
    }

    const defaultStart = nextMonthFromDate();
    const advance = await createSalaryAdvance({
      employeeSheetRow,
      employeeId: form.employeeId,
      employeeName: form.name,
      totalAmount,
      reason,
      startYear: Number.isInteger(startYear) ? startYear : defaultStart.year,
      startMonth: Number.isInteger(startMonth) ? startMonth : defaultStart.month,
      segments,
      lastIncrementDate: form.lastIncrementDate,
      joiningDate: form.joiningDate,
      createdBy: user.name || user.email || user.id,
    });

    return NextResponse.json(
      { success: true, advance: enrichAdvanceForDisplay(advance) },
      { status: 201 },
    );
  } catch (error) {
    const message = toApiErrorMessage(error, "Failed to create salary advance");
    const status = /must|required|available|outside|match|window|increment/i.test(message)
      ? 400
      : 500;
    return NextResponse.json({ success: false, message }, { status });
  }
});

export const PATCH = withActiveSession(async (req, user) => {
  if (!canManageEmployees(user.role)) {
    return NextResponse.json({ success: false, message: "Forbidden" }, { status: 403 });
  }

  try {
    const body = (await req.json()) as Record<string, unknown>;
    const id = String(body.id ?? "").trim();
    const action = String(body.action ?? "")
      .trim()
      .toLowerCase();

    if (!id || (action !== "cancel" && action !== "update")) {
      return NextResponse.json(
        { success: false, message: "id and action=cancel|update are required" },
        { status: 400 },
      );
    }

    if (action === "cancel") {
      const advance = await cancelSalaryAdvance(id);
      return NextResponse.json({ success: true, advance: enrichAdvanceForDisplay(advance) });
    }

    const reason = String(body.reason ?? "").trim();
    const startYear = Number(body.startYear);
    const startMonth = Number(body.startMonth);
    const rawSegments = Array.isArray(body.segments) ? body.segments : [];

    if (!reason) {
      return NextResponse.json({ success: false, message: "Reason is required" }, { status: 400 });
    }
    if (
      !Number.isInteger(startYear) ||
      !Number.isInteger(startMonth) ||
      startMonth < 1 ||
      startMonth > 12
    ) {
      return NextResponse.json(
        { success: false, message: "Valid start year/month is required" },
        { status: 400 },
      );
    }

    const segments: SalaryAdvanceScheduleSegment[] = rawSegments.map((segment) => {
      const row = segment as Record<string, unknown>;
      return {
        months: Number(row.months),
        amountPerMonth: Number(row.amountPerMonth),
      };
    });

    const listed = await listSalaryAdvances();
    const existing = listed.find((row) => row.id === id);
    if (!existing) {
      return NextResponse.json({ success: false, message: "Advance not found" }, { status: 404 });
    }

    const form = await resolveEmployeeForm(existing.employeeSheetRow);
    if (!form) {
      return NextResponse.json({ success: false, message: "Employee not found" }, { status: 404 });
    }
    if (isSuperAdminRole(form.role)) {
      return NextResponse.json(
        { success: false, message: "Salary advances are not available for Super Admin" },
        { status: 400 },
      );
    }

    const advance = await updateSalaryAdvance({
      id,
      reason,
      startYear,
      startMonth,
      segments,
      lastIncrementDate: form.lastIncrementDate,
      joiningDate: form.joiningDate,
    });

    return NextResponse.json({ success: true, advance: enrichAdvanceForDisplay(advance) });
  } catch (error) {
    const message = toApiErrorMessage(error, "Failed to update salary advance");
    const status = /not found/i.test(message)
      ? 404
      : /must|required|available|outside|match|window|increment|reschedule|cancelled|nothing left/i.test(
            message,
          )
        ? 400
        : 500;
    return NextResponse.json({ success: false, message }, { status });
  }
});
