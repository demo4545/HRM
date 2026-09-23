import { NextResponse } from "next/server";

import { ROLES } from "@/app/consts/common";
import { toApiErrorMessage } from "@/lib/api/user-facing-error";
import { withActiveSession } from "@/lib/auth/api-guard";
import { resolveEmployeeRecordForSession } from "@/lib/auth/employee-record";
import { canManageEmployees } from "@/lib/auth/roles";
import {
  getSystemSpecsBySheetRow,
  listSystemSpecs,
  upsertSystemSpecs,
} from "@/lib/system-specs/repository";
import type { DeviceSpec, LoginCredential, SystemSpecsInput } from "@/lib/system-specs/types";
import { normalizeDeviceList, normalizeLoginList } from "@/lib/system-specs/types";

export const dynamic = "force-dynamic";

function parseDeviceList(value: unknown): DeviceSpec[] | undefined {
  if (value == null) return undefined;
  return normalizeDeviceList(value);
}

function parseLoginList(value: unknown): LoginCredential[] | undefined {
  if (value == null) return undefined;
  return normalizeLoginList(value);
}

function parseBodyFields(body: Record<string, unknown>): Omit<SystemSpecsInput, "employeeSheetRow"> {
  return {
    employeeId: body.employeeId != null ? String(body.employeeId).trim() : undefined,
    employeeName: body.employeeName != null ? String(body.employeeName).trim() : undefined,
    laptop: parseDeviceList(body.laptop),
    desktop: parseDeviceList(body.desktop),
    screen: parseDeviceList(body.screen),
    keyboard: parseDeviceList(body.keyboard),
    mouse: parseDeviceList(body.mouse),
    cpu: parseDeviceList(body.cpu),
    ramGb: body.ramGb != null ? String(body.ramGb).trim() : undefined,
    logins: parseLoginList(body.logins),
  };
}

export const GET = withActiveSession(async (req, user) => {
  try {
    const url = new URL(req.url);
    const meOnly = url.searchParams.get("me") === "1";
    const sheetRowParam = url.searchParams.get("sheetRow");
    const canManage = canManageEmployees(user.role);

    if (meOnly || (!canManage && !sheetRowParam)) {
      if (user.role === ROLES.SUPER_ADMIN) {
        return NextResponse.json({
          success: true,
          required: false,
          specs: null,
          message: "Super Admin is not required to submit system specifications.",
        });
      }

      const record = await resolveEmployeeRecordForSession(user);
      if (!record) {
        return NextResponse.json(
          { success: false, message: "No employee record linked to your account." },
          { status: 404 },
        );
      }

      const specs = await getSystemSpecsBySheetRow(record.sheetRow);
      return NextResponse.json({
        success: true,
        required: true,
        sheetRow: record.sheetRow,
        employeeId: user.id,
        employeeName: user.name,
        specs,
      });
    }

    if (!canManage) {
      return NextResponse.json({ success: false, message: "Forbidden" }, { status: 403 });
    }

    if (sheetRowParam) {
      const sheetRow = Number(sheetRowParam);
      if (!Number.isInteger(sheetRow) || sheetRow < 2) {
        return NextResponse.json(
          { success: false, message: "Valid sheetRow is required" },
          { status: 400 },
        );
      }
      const specs = await getSystemSpecsBySheetRow(sheetRow);
      return NextResponse.json({ success: true, specs });
    }

    const specs = await listSystemSpecs();
    return NextResponse.json({ success: true, specs });
  } catch (error) {
    console.error("GET system-specs error:", error);
    return NextResponse.json(
      { success: false, message: toApiErrorMessage(error, "Failed to load system specifications") },
      { status: 500 },
    );
  }
});

export const PUT = withActiveSession(async (req, user) => {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const canManage = canManageEmployees(user.role);
    const fields = parseBodyFields(body);
    const saveAsMe = body.me === true || body.employeeSheetRow == null;

    let targetSheetRow: number;
    let employeeId = fields.employeeId ?? "";
    let employeeName = fields.employeeName ?? "";

    if (saveAsMe) {
      if (user.role === ROLES.SUPER_ADMIN) {
        return NextResponse.json(
          { success: false, message: "Super Admin does not need system specifications." },
          { status: 400 },
        );
      }

      const record = await resolveEmployeeRecordForSession(user);
      if (!record) {
        return NextResponse.json(
          { success: false, message: "No employee record linked to your account." },
          { status: 404 },
        );
      }

      targetSheetRow = record.sheetRow;
      if (!employeeName) employeeName = user.name;
      if (!employeeId) employeeId = user.id;
    } else {
      if (!canManage) {
        return NextResponse.json({ success: false, message: "Forbidden" }, { status: 403 });
      }

      targetSheetRow = Number(body.employeeSheetRow);
      if (!Number.isInteger(targetSheetRow) || targetSheetRow < 2) {
        return NextResponse.json(
          { success: false, message: "Valid employeeSheetRow is required" },
          { status: 400 },
        );
      }
    }

    const specs = await upsertSystemSpecs(
      {
        ...fields,
        employeeSheetRow: targetSheetRow,
        employeeId,
        employeeName,
      },
      user.email || user.name,
    );

    return NextResponse.json({ success: true, specs });
  } catch (error) {
    console.error("PUT system-specs error:", error);
    return NextResponse.json(
      {
        success: false,
        message: toApiErrorMessage(error, "Failed to save system specifications"),
      },
      { status: 500 },
    );
  }
});
