import { randomUUID } from "node:crypto";

import {
  OVERTIME_APPROVAL,
  OVERTIME_REQUEST_HEADERS,
  OVERTIME_REQUEST_SHEET_TITLE,
  OVERTIME_REQUEST_STATUS,
  type OvertimeRequestStatus,
} from "@/lib/attendance/constants";
import type { AttendanceEmployeeContext } from "@/lib/attendance/employee";
import { updateOvertimeApproval } from "@/lib/google/attendance-sheets";
import { sheets } from "@/lib/google/auth";
import { applySheetHeaderFormatByTitle } from "@/lib/google/sheet-format";
import { readSheet } from "@/lib/google/sheets";

import type { OvertimeRequest } from "./types";

export type { OvertimeRequest };

const masterSpreadsheetId = process.env.GOOGLE_SHEET_ID as string;
const SHEET_RANGE = `'${OVERTIME_REQUEST_SHEET_TITLE}'!A:M`;

const COL = {
  id: 0,
  employeeId: 1,
  employeeName: 2,
  attendanceSpreadsheetId: 3,
  date: 4,
  overtime: 5,
  comment: 6,
  status: 7,
  remarks: 8,
  reviewedBy: 9,
  reviewedDate: 10,
  createdAt: 11,
  requestedByRole: 12,
} as const;

function rowToOvertimeRequest(row: string[], sheetRow: number): OvertimeRequest {
  return {
    id: row[COL.id] ?? "",
    employeeId: row[COL.employeeId] ?? "",
    employeeName: row[COL.employeeName] ?? "",
    attendanceSpreadsheetId: row[COL.attendanceSpreadsheetId] ?? "",
    date: row[COL.date] ?? "",
    overtime: row[COL.overtime] ?? "",
    comment: row[COL.comment] ?? "",
    status: (row[COL.status] ?? OVERTIME_REQUEST_STATUS.PENDING) as OvertimeRequestStatus,
    remarks: row[COL.remarks] ?? "",
    reviewedBy: row[COL.reviewedBy] ?? "",
    reviewedDate: row[COL.reviewedDate] ?? "",
    createdAt: row[COL.createdAt] ?? "",
    requestedByRole: String(row[COL.requestedByRole] ?? "").trim(),
    sheetRow,
  };
}

function hasPositiveOvertime(value: string): boolean {
  const overtime = value.trim();
  if (!overtime || overtime === "—") return false;
  if (overtime.startsWith("-")) return false;
  return /\d/.test(overtime);
}

function requestToRow(request: OvertimeRequest): string[] {
  return [
    request.id,
    request.employeeId,
    request.employeeName,
    request.attendanceSpreadsheetId,
    request.date,
    request.overtime,
    request.comment,
    request.status,
    request.remarks,
    request.reviewedBy,
    request.reviewedDate,
    request.createdAt,
    request.requestedByRole,
  ];
}

async function ensureOvertimeRequestSheet(): Promise<void> {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: masterSpreadsheetId,
    fields: "sheets.properties.title",
  });

  const exists = meta.data.sheets?.some(
    (s) => s.properties?.title === OVERTIME_REQUEST_SHEET_TITLE,
  );

  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: masterSpreadsheetId,
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: { title: OVERTIME_REQUEST_SHEET_TITLE },
            },
          },
        ],
      },
    });
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId: masterSpreadsheetId,
    range: `'${OVERTIME_REQUEST_SHEET_TITLE}'!A1:M1`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [OVERTIME_REQUEST_HEADERS as unknown as string[]],
    },
  });

  await applySheetHeaderFormatByTitle(
    masterSpreadsheetId,
    OVERTIME_REQUEST_SHEET_TITLE,
    OVERTIME_REQUEST_HEADERS.length,
  );
}

async function readOvertimeRequests(): Promise<OvertimeRequest[]> {
  await ensureOvertimeRequestSheet();
  const rows = await readSheet(SHEET_RANGE);
  const results: OvertimeRequest[] = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] ?? [];
    if (!(row[COL.id] ?? "").trim()) continue;
    results.push(rowToOvertimeRequest(row, i + 1));
  }

  return results;
}

export async function listOvertimeRequestsSheets(options: {
  employeeId?: string;
}): Promise<OvertimeRequest[]> {
  const all = await readOvertimeRequests();
  const filtered = options.employeeId
    ? all.filter((r) => r.employeeId === options.employeeId)
    : all;
  return filtered.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getOvertimeRequestByIdSheets(id: string): Promise<OvertimeRequest | null> {
  const all = await readOvertimeRequests();
  return all.find((r) => r.id === id) ?? null;
}

export async function createOvertimeRequestSheets(params: {
  employee: AttendanceEmployeeContext;
  date: string;
  overtime: string;
  comment?: string;
  requestedByRole: string;
}): Promise<OvertimeRequest> {
  if (!hasPositiveOvertime(params.overtime)) {
    throw new Error("Overtime request can only be raised for positive overtime");
  }

  const existing = await readOvertimeRequests();
  const duplicate = existing.find(
    (r) => r.employeeId === params.employee.employeeId && r.date === params.date,
  );
  if (duplicate) {
    throw new Error("Overtime request already exists for this date");
  }

  await ensureOvertimeRequestSheet();

  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const comment = params.comment?.trim() ?? "";
  const request: OvertimeRequest = {
    id,
    employeeId: params.employee.employeeId,
    employeeName: params.employee.employeeName,
    attendanceSpreadsheetId: params.employee.attendanceSpreadsheetId,
    date: params.date,
    overtime: params.overtime,
    comment,
    status: OVERTIME_REQUEST_STATUS.PENDING,
    remarks: "",
    reviewedBy: "",
    reviewedDate: "",
    createdAt,
    requestedByRole: params.requestedByRole.trim(),
    sheetRow: 0,
  };

  await sheets.spreadsheets.values.append({
    spreadsheetId: masterSpreadsheetId,
    range: SHEET_RANGE,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [requestToRow(request)] },
  });

  await updateOvertimeApproval(
    params.employee.attendanceSpreadsheetId,
    params.date,
    OVERTIME_APPROVAL.PENDING,
  );

  return request;
}

export async function reviewOvertimeRequestSheets(params: {
  id: string;
  status: typeof OVERTIME_REQUEST_STATUS.APPROVED | typeof OVERTIME_REQUEST_STATUS.REJECTED;
  remarks?: string;
  reviewerName: string;
}): Promise<OvertimeRequest> {
  const all = await readOvertimeRequests();
  const request = all.find((r) => r.id === params.id);
  if (!request) {
    throw new Error("Overtime request not found");
  }
  if (request.status !== OVERTIME_REQUEST_STATUS.PENDING) {
    throw new Error("Overtime request already reviewed");
  }
  if (params.status === OVERTIME_REQUEST_STATUS.REJECTED && !(params.remarks ?? "").trim()) {
    throw new Error("Remarks are required when rejecting overtime");
  }

  const reviewedDate = new Date().toISOString();
  const remarks = params.remarks?.trim() ?? "";
  const updated: OvertimeRequest = {
    ...request,
    status: params.status,
    remarks,
    reviewedBy: params.reviewerName,
    reviewedDate,
  };

  await sheets.spreadsheets.values.update({
    spreadsheetId: masterSpreadsheetId,
    range: `'${OVERTIME_REQUEST_SHEET_TITLE}'!A${request.sheetRow}:M${request.sheetRow}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [requestToRow(updated)] },
  });

  await updateOvertimeApproval(
    request.attendanceSpreadsheetId,
    request.date,
    params.status === OVERTIME_REQUEST_STATUS.APPROVED
      ? OVERTIME_APPROVAL.ACCEPTED
      : OVERTIME_APPROVAL.REJECTED,
  );

  return updated;
}
