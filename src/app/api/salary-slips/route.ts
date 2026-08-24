import { NextResponse } from "next/server";

import { ROLES } from "@/app/consts/common";
import { withActiveSession } from "@/lib/auth/api-guard";
import { canManageEmployees } from "@/lib/auth/roles";
import { getCompanyBranding } from "@/lib/branding";
import { formatGoogleApiClientMessage } from "@/lib/google/drive-auth";
import { formatEmployeePositionLabel, headerToFormKey, sheetRowToForm } from "@/lib/employee";
import {
  getOrCreateSalarySlipsYearFolder,
  trashDriveFile,
  uploadBinaryFileToFolder,
} from "@/lib/google/drive";
import { EMPLOYEE_SHEET_RANGE, readSheet } from "@/lib/google/sheets";
import { amountToIndianWords, calculateSalaryBreakdown } from "@/lib/salary-slips/calculation";
import { renderSalarySlipPdf } from "@/lib/salary-slips/pdf";
import { OVERTIME_APPROVAL, OVERTIME_REQUEST_STATUS } from "@/lib/attendance/constants";
import {
  getAttendanceSpreadsheetIdFromRow,
  resolveAttendanceSpreadsheetIdForRow,
} from "@/lib/attendance/employee";
import { listLeaveApplications } from "@/lib/attendance/leave-approvals";
import { LEAVE_STATUS } from "@/lib/attendance/leave-status";
import { listOvertimeRequests } from "@/lib/attendance/overtime-requests";
import { listCompanyHolidays } from "@/lib/company-holidays/repository";
import {
  DEFAULT_LWF,
  DEFAULT_PROFESSIONAL_TAX,
  calculateEmployeePayroll,
  filterDatesForEmployment,
  getDaysInMonth,
  listScheduledWorkingDates,
  loadMonthAttendanceByDate,
} from "@/lib/payroll";
import {
  buildAcceptedLeaveAttendanceOverlays,
  localDateIso,
  mergeAttendanceWithApprovedLeaves,
} from "@/lib/payroll/leave-attendance";
import {
  findEffectiveSalaryForPeriodFromRecords,
  listSalaryHistoryRecords,
  listSalarySlips,
  saveSalarySlipRecord,
  updateSalarySlipRecord,
} from "@/lib/salary-slips/sheets";

function isSuperAdminRole(role: string): boolean {
  return role.trim().toLowerCase() === ROLES.SUPER_ADMIN;
}

function monthLabel(month: number): string {
  return new Date(Date.UTC(2026, month - 1, 1)).toLocaleString("en-IN", { month: "short" });
}

function normalizeHeaderKey(header: string): string {
  return header
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_")
    .toLowerCase();
}

function readEmployeeValue(
  headers: string[],
  row: string[],
  formValue: string,
  formKey: "bankAccountNumber" | "ifscCode" | "panNumber" | "aadharNumber",
  matchesLoose: (normalizedHeader: string) => boolean,
): string {
  const fromForm = String(formValue ?? "").trim();
  if (fromForm) return fromForm;

  const mappedIndex = headers.findIndex((header) => headerToFormKey(header) === formKey);
  if (mappedIndex >= 0) {
    const mapped = String(row[mappedIndex] ?? "").trim();
    if (mapped) return mapped;
  }

  const looseIndex = headers.findIndex((header) => matchesLoose(normalizeHeaderKey(header)));
  return looseIndex >= 0 ? String(row[looseIndex] ?? "").trim() : "";
}

export const GET = withActiveSession(async (req, user) => {
  try {
    const { searchParams } = new URL(req.url);
    const mode = searchParams.get("mode") ?? "list";
    if (mode !== "list") {
      return NextResponse.json({ success: false, message: "Unsupported mode" }, { status: 400 });
    }

    const canManage = canManageEmployees(user.role);
    const employeeSheetRowParam = searchParams.get("employeeSheetRow");
    const yearParam = searchParams.get("year");
    const monthParam = searchParams.get("month");
    const employeeSheetRow =
      employeeSheetRowParam && Number.isFinite(Number(employeeSheetRowParam))
        ? Number(employeeSheetRowParam)
        : null;
    const year = yearParam && Number.isFinite(Number(yearParam)) ? Number(yearParam) : null;
    const month = monthParam && Number.isFinite(Number(monthParam)) ? Number(monthParam) : null;

    let rows = await listSalarySlips();
    rows = rows.filter((r) => r.status !== "Deleted");
    if (!canManage) {
      rows = rows.filter((r) => r.employeeSheetRow === user.sheetRow);
    } else if (employeeSheetRow) {
      rows = rows.filter((r) => r.employeeSheetRow === employeeSheetRow);
    }
    if (year) rows = rows.filter((r) => r.year === year);
    if (month) rows = rows.filter((r) => r.month === month);

    return NextResponse.json({ success: true, slips: rows });
  } catch (error: unknown) {
    const message = formatGoogleApiClientMessage(error, {
      forHrAdmin: canManageEmployees(user.role),
    });
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
});

export const POST = withActiveSession(async (req, user) => {
  if (!canManageEmployees(user.role)) {
    return NextResponse.json({ success: false, message: "Forbidden" }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const mode = searchParams.get("mode");
    if (mode !== "generate") {
      return NextResponse.json({ success: false, message: "Unsupported mode" }, { status: 400 });
    }

    const body = await req.json();
    const year = Number(body.year);
    const month = Number(body.month);
    const overrideExisting = Boolean(body.overrideExisting);
    const targetSheetRow =
      body.employeeSheetRow != null && Number.isFinite(Number(body.employeeSheetRow))
        ? Number(body.employeeSheetRow)
        : null;
    if (!Number.isFinite(year) || year < 2000 || year > 3000) {
      return NextResponse.json({ success: false, message: "Invalid year" }, { status: 400 });
    }
    if (!Number.isFinite(month) || month < 1 || month > 12) {
      return NextResponse.json(
        { success: false, message: "Invalid month. Use 1-12." },
        { status: 400 },
      );
    }

    const employeeSheet = await readSheet(EMPLOYEE_SHEET_RANGE);
    if (employeeSheet.length < 2) {
      return NextResponse.json({ success: false, message: "No employees found" }, { status: 400 });
    }
    const headers = employeeSheet[0] as string[];
    const [allSlips, salaryHistory, holidays, overtimeRequests] = await Promise.all([
      listSalarySlips(),
      listSalaryHistoryRecords(),
      listCompanyHolidays(year),
      listOvertimeRequests({}).catch((error) => {
        console.error("Salary slip overtime request load failed", error);
        return [];
      }),
    ]);

    const scheduledDates = listScheduledWorkingDates(year, month, holidays);
    const workingDays = scheduledDates.length;
    const periodStart = `${year}-${String(month).padStart(2, "0")}-01`;
    const periodEnd = `${year}-${String(month).padStart(2, "0")}-${String(getDaysInMonth(year, month)).padStart(2, "0")}`;

    const generated: Array<{ employeeSheetRow: number; slipId: string; fileName: string }> = [];
    for (let i = 1; i < employeeSheet.length; i += 1) {
      const sheetRow = i + 1;
      if (targetSheetRow && targetSheetRow !== sheetRow) continue;
      const row = employeeSheet[i] ?? [];
      const form = sheetRowToForm(headers, row);
      if (form.status.toLowerCase() !== "active") continue;
      // Super Admin is not paid via salary slips.
      if (isSuperAdminRole(form.role)) {
        if (targetSheetRow === sheetRow) {
          return NextResponse.json(
            { success: false, message: "Salary slips are not available for Super Admin" },
            { status: 400 },
          );
        }
        continue;
      }

      const existing = allSlips.find(
        (s) =>
          s.employeeSheetRow === sheetRow &&
          s.year === year &&
          s.month === month &&
          s.status !== "Deleted",
      );
      if (existing && !overrideExisting) {
        continue;
      }

      const history = findEffectiveSalaryForPeriodFromRecords(salaryHistory, {
        employeeSheetRow: sheetRow,
        periodStart,
        periodEnd,
      });
      if (!history) continue;

      const attendanceByDate = new Map();
      let attendanceSpreadsheetId =
        form.attendanceSpreadsheetId?.trim() || getAttendanceSpreadsheetIdFromRow(headers, row);
      if (!attendanceSpreadsheetId) {
        attendanceSpreadsheetId = await resolveAttendanceSpreadsheetIdForRow({
          headers,
          row,
          sheetRow,
          employeeId: form.employeeId.trim(),
          employeeName: form.name.trim() || "Employee",
          documentsFolderId: form.documentsFolderId,
          birthdayDate: form.birthdayDate,
          createIfMissing: false,
        });
      }

      if (attendanceSpreadsheetId || form.employeeId.trim()) {
        try {
          const loaded = await loadMonthAttendanceByDate({
            employeeId: form.employeeId.trim(),
            attendanceSpreadsheetId: attendanceSpreadsheetId || "",
            year,
            monthIndex: month - 1,
          });
          for (const [date, value] of loaded) {
            attendanceByDate.set(date, value);
          }
          if (attendanceByDate.size === 0 && form.documentsFolderId.trim()) {
            const folderResolved = await resolveAttendanceSpreadsheetIdForRow({
              headers,
              row,
              sheetRow,
              employeeId: form.employeeId.trim(),
              employeeName: form.name.trim() || "Employee",
              documentsFolderId: form.documentsFolderId,
              birthdayDate: form.birthdayDate,
              createIfMissing: false,
              preferFolderSearch: true,
            });
            if (folderResolved && folderResolved !== attendanceSpreadsheetId) {
              attendanceSpreadsheetId = folderResolved;
              const retried = await loadMonthAttendanceByDate({
                employeeId: form.employeeId.trim(),
                attendanceSpreadsheetId,
                year,
                monthIndex: month - 1,
              });
              for (const [date, value] of retried) {
                attendanceByDate.set(date, value);
              }
            }
          }
        } catch (error) {
          console.error(`Salary slip attendance load failed for row ${sheetRow}`, error);
        }
      }

      if (attendanceSpreadsheetId || form.employeeId.trim()) {
        try {
          const leaveApplications = await listLeaveApplications({
            employeeId: form.employeeId,
            employeeName: form.name,
            attendanceSpreadsheetId: attendanceSpreadsheetId || "",
            statusFilter: LEAVE_STATUS.ACCEPTED,
          });
          const overlays = buildAcceptedLeaveAttendanceOverlays(leaveApplications).filter(
            (overlay) => overlay.dateIso >= periodStart && overlay.dateIso <= periodEnd,
          );
          const merged = mergeAttendanceWithApprovedLeaves(attendanceByDate, overlays);
          attendanceByDate.clear();
          for (const [date, value] of merged) {
            attendanceByDate.set(date, value);
          }
        } catch (error) {
          console.error(`Salary slip leave bucket load failed for row ${sheetRow}`, error);
        }
      }

      const employeeId = form.employeeId.trim();
      for (const request of overtimeRequests) {
        if (request.employeeId.trim() !== employeeId) continue;
        if (request.status !== OVERTIME_REQUEST_STATUS.APPROVED) continue;
        if (request.date < periodStart || request.date > periodEnd) continue;
        const existingDay = attendanceByDate.get(request.date) ?? {};
        attendanceByDate.set(request.date, {
          ...existingDay,
          overtime: request.overtime || existingDay.overtime,
          isOvertimeApproved: OVERTIME_APPROVAL.ACCEPTED,
        });
      }

      const employeeScheduledDates = filterDatesForEmployment(
        scheduledDates,
        form.joiningDate,
        form.lastWorkingDay,
      );
      const asOfIso = localDateIso();
      const dueScheduledDates = employeeScheduledDates.filter(
        (date) => date <= asOfIso || attendanceByDate.has(date),
      );
      const loyaltyPercent = Number.isFinite(history.loyaltyBonus) ? history.loyaltyBonus : 10;
      const professionalTax =
        history.professionalTax > 0 ? history.professionalTax : DEFAULT_PROFESSIONAL_TAX;
      const lwf = history.lwf > 0 ? history.lwf : DEFAULT_LWF;
      const payrollResult = calculateEmployeePayroll({
        basic: history.basic,
        hra: history.hra ?? 0,
        organizationAllowance: history.organizationAllowance ?? 0,
        loyaltyPercent,
        professionalTax,
        lwf,
        salaryAdvance: 0,
        workingDays,
        scheduledDates: dueScheduledDates,
        attendanceByDate,
      });
      const netPayableDays = payrollResult.netPayableDays;
      const overtimeAmount = payrollResult.overtimeAmount;
      const unpaidLeaveAmount = payrollResult.unpaidLeaveAmount;
      const breakdown = calculateSalaryBreakdown({
        basic: history.basic,
        hra: history.hra ?? 0,
        organizationAllowance: history.organizationAllowance ?? 0,
        loyaltyBonus: loyaltyPercent,
        professionalTax,
        lwf,
        workingDays,
        netPayableDays,
        overtimeAmount,
        unpaidLeaveAmount,
      });
      const amountInWords = amountToIndianWords(breakdown.totalPay);
      const { yearFolderId } = await getOrCreateSalarySlipsYearFolder({
        employeeId: form.employeeId || `EMP${String(sheetRow - 1).padStart(3, "0")}`,
        employeeName: form.name || "Employee",
        year,
      });

      const branding = await getCompanyBranding();
      const fileName = `${monthLabel(month)}.pdf`;
      const pdf = await renderSalarySlipPdf({
        companyName: branding.companyName.trim(),
        companyAddress: branding.companyAddress.trim(),
        payTitle: `Pay Slip For the Month of ${monthLabel(month)}-${year}`,
        payRange: `(From ${periodStart.split("-").reverse().join("/")} To ${periodEnd.split("-").reverse().join("/")})`,
        employeeName: form.name,
        employeeCode: form.employeeId || `EMP${String(sheetRow - 1).padStart(3, "0")}`,
        fatherName: form.parentName,
        pan: readEmployeeValue(
          headers,
          row,
          form.panNumber,
          "panNumber",
          (key) => key === "pan" || key === "pan_number",
        ),
        bankAccountNo: readEmployeeValue(
          headers,
          row,
          form.bankAccountNumber,
          "bankAccountNumber",
          (key) =>
            (key.includes("bank") &&
              (key.includes("account") || key.includes("ac") || key.includes("a_c"))) ||
            key === "account_number" ||
            key === "account_no",
        ),
        designation: formatEmployeePositionLabel(form.position),
        ifsc: readEmployeeValue(headers, row, form.ifscCode, "ifscCode", (key) =>
          key.includes("ifsc"),
        ),
        netPayableDays,
        aadharNo: readEmployeeValue(
          headers,
          row,
          form.aadharNumber,
          "aadharNumber",
          (key) => (key.includes("aadhar") || key.includes("aadhaar")) && !key.includes("card"),
        ),
        workingDays,
        basic: breakdown.basic,
        hra: breakdown.hra,
        organizationAllowance: breakdown.organizationAllowance,
        loyaltyBonusRate: Number.isFinite(history.loyaltyBonus) ? history.loyaltyBonus : 10,
        loyaltyBonus: breakdown.loyaltyBonus,
        professionalTax: breakdown.professionalTax,
        lwf: breakdown.lwf,
        unpaidLeaveAmount: breakdown.unpaidLeaveAmount,
        totalEarnings: breakdown.totalEarnings,
        totalDeductions: breakdown.totalDeductions,
        netPay: breakdown.netPay,
        overtimeAmount: breakdown.overtimeAmount,
        totalPay: breakdown.totalPay,
        amountInWords,
      });

      const uploaded = await uploadBinaryFileToFolder(
        fileName,
        "application/pdf",
        pdf,
        yearFolderId,
      );

      const slipId = await saveSalarySlipRecord({
        employeeSheetRow: sheetRow,
        employeeName: form.name ?? "",
        year,
        month,
        title: `${monthLabel(month)} ${year}`,
        workingDays,
        netPayableDays,
        basic: breakdown.basic,
        totalEarnings: breakdown.totalEarnings,
        loyaltyBonus: breakdown.loyaltyBonus,
        professionalTax: breakdown.professionalTax,
        totalDeductions: breakdown.totalDeductions,
        netPay: breakdown.netPay,
        overtimeAmount: breakdown.overtimeAmount,
        totalPay: breakdown.totalPay,
        amountInWords,
        status: "Released",
        driveFileId: uploaded.fileId,
        driveFileName: uploaded.fileName,
        driveParentFolderId: yearFolderId,
        releasedAt: new Date().toISOString(),
        deletedAt: "",
      });
      generated.push({ employeeSheetRow: sheetRow, slipId, fileName: uploaded.fileName });
    }

    return NextResponse.json({ success: true, generated });
  } catch (error: unknown) {
    const message = formatGoogleApiClientMessage(error, {
      forHrAdmin: true,
    });
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
});

export const DELETE = withActiveSession(async (req, user) => {
  if (!canManageEmployees(user.role)) {
    return NextResponse.json({ success: false, message: "Forbidden" }, { status: 403 });
  }
  try {
    const { searchParams } = new URL(req.url);
    const slipId = searchParams.get("slipId")?.trim();
    if (!slipId) {
      return NextResponse.json({ success: false, message: "slipId is required" }, { status: 400 });
    }
    const shouldTrash = searchParams.get("trashFile") === "true";
    const slips = await listSalarySlips();
    const row = slips.find((s) => s.slipId === slipId);
    if (!row) {
      return NextResponse.json({ success: false, message: "Slip not found" }, { status: 404 });
    }

    if (shouldTrash && row.driveFileId) {
      await trashDriveFile(row.driveFileId);
    }
    await updateSalarySlipRecord(row.sheetRow, {
      status: "Deleted",
      deletedAt: new Date().toISOString(),
    });
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const message = formatGoogleApiClientMessage(error, { forHrAdmin: true });
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
});
