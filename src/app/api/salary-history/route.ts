import { NextResponse } from "next/server";

import { ROLES } from "@/app/consts/common";
import { withActiveSession } from "@/lib/auth/api-guard";
import { canManageEmployees } from "@/lib/auth/roles";
import { sheetRowToForm } from "@/lib/employee";
import { getEmployeeBySheetRow } from "@/lib/employees/repository";
import { formatGoogleApiClientMessage } from "@/lib/google/drive-auth";
import {
  cleanupCorruptSalaryHistoryRecords,
  createSalaryHistoryRecord,
  deleteSalaryHistoryRecord,
  listSalaryHistoryRecords,
  updateSalaryHistoryRecord,
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

    // Same roster source as All Employees (`DAILY_DATA_STORAGE` → Firebase or Sheets).
    const record = await getEmployeeBySheetRow(employeeSheetRow);
    if (!record) {
      return NextResponse.json({ success: false, message: "Employee not found" }, { status: 404 });
    }
    const form = sheetRowToForm(record.headers, record.row);
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

export const PATCH = withActiveSession(async (req, user) => {
  if (!canManageEmployees(user.role)) {
    return NextResponse.json({ success: false, message: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const sheetRow = Number(body.sheetRow);
    const employeeSheetRow = Number(body.employeeSheetRow);
    const effectiveFrom = String(body.effectiveFrom ?? "").trim();

    if (!Number.isInteger(sheetRow) || sheetRow < 2) {
      return NextResponse.json(
        { success: false, message: "Valid sheetRow is required" },
        { status: 400 },
      );
    }
    if (!Number.isFinite(employeeSheetRow) || employeeSheetRow < 2) {
      return NextResponse.json(
        { success: false, message: "Valid employeeSheetRow is required" },
        { status: 400 },
      );
    }
    if (!effectiveFrom) {
      return NextResponse.json(
        { success: false, message: "effectiveFrom is required" },
        { status: 400 },
      );
    }

    const employee = await getEmployeeBySheetRow(employeeSheetRow);
    if (!employee) {
      return NextResponse.json({ success: false, message: "Employee not found" }, { status: 404 });
    }
    const form = sheetRowToForm(employee.headers, employee.row);
    if (isSuperAdminRole(form.role)) {
      return NextResponse.json(
        { success: false, message: "Salary history is not available for Super Admin" },
        { status: 400 },
      );
    }

    const record = await updateSalaryHistoryRecord(sheetRow, {
      employeeSheetRow,
      employeeName: String(body.employeeName ?? form.name ?? "").trim(),
      effectiveFrom,
      basic: Number(body.basic ?? 0),
      hra: Number(body.hra ?? 0),
      organizationAllowance: Number(body.organizationAllowance ?? 0),
      lwf: Number(body.lwf ?? 6),
      loyaltyBonus: Number(body.loyaltyBonus ?? 10),
      professionalTax: Number(body.professionalTax ?? 200),
      status: body.status === "Inactive" ? "Inactive" : "Active",
    });

    return NextResponse.json({ success: true, message: "Salary history updated", record });
  } catch (error: unknown) {
    const message = formatGoogleApiClientMessage(error, { forHrAdmin: true });
    const status = /not found/i.test(message) ? 404 : 400;
    return NextResponse.json({ success: false, message }, { status });
  }
});

export const DELETE = withActiveSession(async (req, user) => {
  if (!canManageEmployees(user.role)) {
    return NextResponse.json({ success: false, message: "Forbidden" }, { status: 403 });
  }

  try {
    const sheetRow = Number(req.nextUrl.searchParams.get("sheetRow"));
    if (!Number.isInteger(sheetRow) || sheetRow < 2) {
      return NextResponse.json(
        { success: false, message: "Valid sheetRow is required" },
        { status: 400 },
      );
    }

    const deleted = await deleteSalaryHistoryRecord(sheetRow);
    if (!deleted) {
      return NextResponse.json(
        { success: false, message: "Salary history record not found" },
        { status: 404 },
      );
    }

    return NextResponse.json({ success: true, message: "Salary history deleted" });
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
