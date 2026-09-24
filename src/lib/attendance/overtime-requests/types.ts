import type { OvertimeRequestStatus } from "@/lib/attendance/constants";

export type OvertimeRequest = {
  id: string;
  employeeId: string;
  employeeName: string;
  attendanceSpreadsheetId: string;
  date: string;
  overtime: string;
  comment: string;
  status: OvertimeRequestStatus;
  remarks: string;
  reviewedBy: string;
  reviewedDate: string;
  createdAt: string;
  requestedByRole: string;
  sheetRow: number;
};
