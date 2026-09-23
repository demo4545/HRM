import { NextResponse } from "next/server";

import { ROLES } from "@/app/consts/common";
import { withActiveSession } from "@/lib/auth/api-guard";
import { canManageEmployees } from "@/lib/auth/roles";
import { sheetRowToForm } from "@/lib/employee";
import { formatGoogleApiClientMessage } from "@/lib/google/drive-auth";
import { EMPLOYEE_SHEET_RANGE, readSheet } from "@/lib/google/sheets";
import {
  cleanupCorruptSalaryHistoryRecords,
  createSalaryHistoryRecord,
  listSalaryHistoryRecords,
} from "@/lib/salary-slips/sheets";

function isSuperAdminRole(role: string): boolean {
  return role.trim().toLowerCase() === ROLES.SUPER_ADMIN;
}

export const GET = withActiveSession(async (req, user) => {
  if (!canManageEmployees(user.role)) {
    return NextResponse.json({ success: false, message: "Forbidden" }, { status: 403 });
  }

  try {
    // Best-effort: never fail the list because cleanup hit Sheets quota/timeouts.
    try {
      await cleanupCorruptSalaryHistoryRecords();
    } catch (cleanupError) {
      console.warn("[salary-history] cleanup skipped:", cleanupError);
    }

    const employeeSheetRowParam = req.nextUrl.searchParams.get("employeeSheetRow");
    const employeeSheetRow = employeeSheetRowParam ? Number(employeeSheetRowParam) : null;
    const rows = await listSalaryHistoryRecords({ validOnly: true });
    const filtered =
      employeeSheetRow && Number.isFinite(employeeSheetRow)
        ? rows.filter((r) => r.employeeSheetRow === employeeSheetRow)
        : rows;

    return NextResponse.json({ success: true, records: filtered });
  } catch (error: unknown) {
    return NextResponse.json(
      {
        success: false,
        message: formatGoogleApiClientMessage(error, { forHrAdmin: true }),
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
    const body = await req.json();
    const employeeSheetRow = Number(body.employeeSheetRow);
    const employeeName = String(body.employeeName ?? "").trim();
    const effectiveFrom = String(body.effectiveFrom ?? "").trim();
    if (!Number.isFinite(employeeSheetRow) || employeeSheetRow < 2) {
      return NextResponse.json(
        { success: false, message: "Valid employeeSheetRow is required" },
        { status: 400 },
      );
    }

    const employeeSheet = await readSheet(EMPLOYEE_SHEET_RANGE);
    if (employeeSheetRow > employeeSheet.length) {
      return NextResponse.json({ success: false, message: "Employee not found" }, { status: 404 });
    }
    const headers = employeeSheet[0] as string[];
    const form = sheetRowToForm(headers, employeeSheet[employeeSheetRow - 1] ?? []);
    if (isSuperAdminRole(form.role)) {
      return NextResponse.json(
        { success: false, message: "Salary history is not available for Super Admin" },
        { status: 400 },
      );
    }

    if (!effectiveFrom) {
      return NextResponse.json(
        { success: false, message: "effectiveFrom is required" },
        { status: 400 },
      );
    }

    await createSalaryHistoryRecord({
      employeeSheetRow,
      employeeName,
      effectiveFrom,
      basic: Number(body.basic ?? 0),
      hra: Number(body.hra ?? 0),
      organizationAllowance: Number(body.organizationAllowance ?? 0),
      lwf: Number(body.lwf ?? 6),
      loyaltyBonus: Number(body.loyaltyBonus ?? 10),
      professionalTax: Number(body.professionalTax ?? 200),
      status: body.status === "Inactive" ? "Inactive" : "Active",
    });

    return NextResponse.json({ success: true, message: "Salary history saved" });
  } catch (error: unknown) {
    return NextResponse.json(
      {
        success: false,
        message: formatGoogleApiClientMessage(error, { forHrAdmin: true }),
      },
      { status: 500 },
    );
  }
});
