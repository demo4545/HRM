import { NextResponse } from "next/server";

import { STATUS } from "@/app/consts/common";
import { withActiveSession } from "@/lib/auth/api-guard";
import { canManageEmployees } from "@/lib/auth/server";
import {
  mergeRowWithFormFields,
  todayIsoDate,
  withSheetRowUpdatedAt,
} from "@/lib/employee";
import {
  getEmployeeBySheetRow,
  updateEmployeeRow,
} from "@/lib/employees/repository";
import { clearActiveEmployeesCache } from "@/lib/notifications/recipients";
import { toApiErrorMessage } from "@/lib/api/user-facing-error";

export const POST = withActiveSession(async (req, user) => {
  try {
    if (!canManageEmployees(user.role)) {
      return NextResponse.json(
        { success: false, message: "You do not have permission to offboard employees." },
        { status: 403 },
      );
    }

    const body = await req.json();
    const sheetRow = Number(body.sheetRow);
    const lastWorkingDay = String(body.lastWorkingDay ?? "").trim();
    const reason = String(body.reason ?? "").trim();

    if (!Number.isFinite(sheetRow) || sheetRow < 2) {
      return NextResponse.json(
        { success: false, message: "A valid employee is required." },
        { status: 400 },
      );
    }

    if (!lastWorkingDay) {
      return NextResponse.json(
        { success: false, message: "Last working day is required." },
        { status: 400 },
      );
    }

    if (lastWorkingDay < todayIsoDate()) {
      return NextResponse.json(
        { success: false, message: "Last working day cannot be a past date." },
        { status: 400 },
      );
    }

    if (!reason) {
      return NextResponse.json(
        { success: false, message: "Offboarding reason is required." },
        { status: 400 },
      );
    }

    // Same source as the employee list dropdown (`DAILY_DATA_STORAGE`).
    const record = await getEmployeeBySheetRow(sheetRow);
    if (!record) {
      return NextResponse.json({ success: false, message: "Employee not found." }, { status: 404 });
    }

    const { headers, row } = record;
    const rowValues = withSheetRowUpdatedAt(
      headers,
      mergeRowWithFormFields(headers, row, {
        status: STATUS.INACTIVE,
        lastWorkingDay,
        offboardReason: reason,
      }),
    );
    await updateEmployeeRow(sheetRow, rowValues);
    clearActiveEmployeesCache();

    return NextResponse.json({
      success: true,
      message: "Employee offboarded successfully.",
    });
  } catch (error: unknown) {
    console.error("Offboard employee error:", error);
    const message = toApiErrorMessage(error, "Failed to offboard employee.");
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
});
