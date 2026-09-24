import { randomUUID } from "node:crypto";

import {
  OVERTIME_APPROVAL,
  OVERTIME_REQUEST_STATUS,
  type OvertimeRequestStatus,
} from "@/lib/attendance/constants";
import type { AttendanceEmployeeContext } from "@/lib/attendance/employee";
import { getAttendanceRepository } from "@/lib/attendance/repository";
import { getAdminFirestore } from "@/lib/firebase/admin";

import type { OvertimeRequest } from "./types";

const COLLECTION = "overtime_requests";

function overtimeCollection() {
  return getAdminFirestore().collection(COLLECTION);
}

function hasPositiveOvertime(value: string): boolean {
  const overtime = value.trim();
  if (!overtime || overtime === "—") return false;
  if (overtime.startsWith("-")) return false;
  return /\d/.test(overtime);
}

function docToRequest(id: string, data: Record<string, unknown>): OvertimeRequest | null {
  const employeeId = String(data.employeeId ?? "").trim();
  if (!employeeId) return null;
  return {
    id,
    employeeId,
    employeeName: String(data.employeeName ?? "").trim(),
    attendanceSpreadsheetId: String(data.attendanceSpreadsheetId ?? "").trim(),
    date: String(data.date ?? "").trim(),
    overtime: String(data.overtime ?? "").trim(),
    comment: String(data.comment ?? ""),
    status: (String(data.status ?? OVERTIME_REQUEST_STATUS.PENDING).trim() ||
      OVERTIME_REQUEST_STATUS.PENDING) as OvertimeRequestStatus,
    remarks: String(data.remarks ?? ""),
    reviewedBy: String(data.reviewedBy ?? ""),
    reviewedDate: String(data.reviewedDate ?? ""),
    createdAt: String(data.createdAt ?? ""),
    requestedByRole: String(data.requestedByRole ?? "").trim(),
    sheetRow: 0,
  };
}

export async function listOvertimeRequestsFirestore(options: {
  employeeId?: string;
}): Promise<OvertimeRequest[]> {
  const snap = options.employeeId
    ? await overtimeCollection().where("employeeId", "==", options.employeeId).get()
    : await overtimeCollection().get();

  return snap.docs
    .map((doc) => docToRequest(doc.id, doc.data() as Record<string, unknown>))
    .filter((row): row is OvertimeRequest => Boolean(row))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getOvertimeRequestByIdFirestore(
  id: string,
): Promise<OvertimeRequest | null> {
  const snap = await overtimeCollection().doc(id).get();
  if (!snap.exists) return null;
  return docToRequest(snap.id, snap.data() as Record<string, unknown>);
}

export async function createOvertimeRequestFirestore(params: {
  employee: AttendanceEmployeeContext;
  date: string;
  overtime: string;
  comment?: string;
  requestedByRole: string;
}): Promise<OvertimeRequest> {
  if (!hasPositiveOvertime(params.overtime)) {
    throw new Error("Overtime request can only be raised for positive overtime");
  }

  const existing = await listOvertimeRequestsFirestore({
    employeeId: params.employee.employeeId,
  });
  if (existing.some((r) => r.date === params.date)) {
    throw new Error("Overtime request already exists for this date");
  }

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

  await overtimeCollection().doc(id).set(request);
  await getAttendanceRepository().updateOvertimeApproval(
    {
      employeeId: params.employee.employeeId,
      spreadsheetId: params.employee.attendanceSpreadsheetId,
    },
    params.date,
    OVERTIME_APPROVAL.PENDING,
  );

  return request;
}

export async function reviewOvertimeRequestFirestore(params: {
  id: string;
  status: typeof OVERTIME_REQUEST_STATUS.APPROVED | typeof OVERTIME_REQUEST_STATUS.REJECTED;
  remarks?: string;
  reviewerName: string;
}): Promise<OvertimeRequest> {
  const ref = overtimeCollection().doc(params.id);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new Error("Overtime request not found");
  }

  const request = docToRequest(snap.id, snap.data() as Record<string, unknown>);
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

  await ref.set(updated);
  await getAttendanceRepository().updateOvertimeApproval(
    {
      employeeId: request.employeeId,
      spreadsheetId: request.attendanceSpreadsheetId,
    },
    request.date,
    params.status === OVERTIME_REQUEST_STATUS.APPROVED
      ? OVERTIME_APPROVAL.ACCEPTED
      : OVERTIME_APPROVAL.REJECTED,
  );

  return updated;
}
