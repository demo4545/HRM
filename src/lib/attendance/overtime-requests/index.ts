import { OVERTIME_REQUEST_STATUS } from "@/lib/attendance/constants";
import type { AttendanceEmployeeContext } from "@/lib/attendance/employee";
import { isFirebaseDailyStorage } from "@/lib/storage/backend";

import {
  createOvertimeRequestFirestore,
  getOvertimeRequestByIdFirestore,
  listOvertimeRequestsFirestore,
  reviewOvertimeRequestFirestore,
} from "./firestore";
import {
  createOvertimeRequestSheets,
  getOvertimeRequestByIdSheets,
  listOvertimeRequestsSheets,
  reviewOvertimeRequestSheets,
} from "./sheets";

export type { OvertimeRequest } from "./types";

export async function listOvertimeRequests(options: { employeeId?: string }) {
  if (isFirebaseDailyStorage()) {
    return listOvertimeRequestsFirestore(options);
  }
  return listOvertimeRequestsSheets(options);
}

export async function getOvertimeRequestById(id: string) {
  if (isFirebaseDailyStorage()) {
    return getOvertimeRequestByIdFirestore(id);
  }
  return getOvertimeRequestByIdSheets(id);
}

export async function createOvertimeRequest(params: {
  employee: AttendanceEmployeeContext;
  date: string;
  overtime: string;
  comment?: string;
  requestedByRole: string;
}) {
  if (isFirebaseDailyStorage()) {
    return createOvertimeRequestFirestore(params);
  }
  return createOvertimeRequestSheets(params);
}

export async function reviewOvertimeRequest(params: {
  id: string;
  status: typeof OVERTIME_REQUEST_STATUS.APPROVED | typeof OVERTIME_REQUEST_STATUS.REJECTED;
  remarks?: string;
  reviewerName: string;
}) {
  if (isFirebaseDailyStorage()) {
    return reviewOvertimeRequestFirestore(params);
  }
  return reviewOvertimeRequestSheets(params);
}
