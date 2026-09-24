import { assertApiSuccess, readResponseJson } from "@/lib/api/read-response-json";
import { toUserFacingActionError } from "@/lib/api/user-facing-error";

export type TodayAttendance = {
  date: string;
  workMode?: string;
  punchIn: string;
  punchOut: string;
  breakStart: string;
  breakEnd: string;
  totalBreakTime: string;
  workingHours: string;
  overtime: string;
  status: string;
  onBreak: boolean;
  hasPunchedIn: boolean;
  hasPunchedOut: boolean;
  workedMs: number;
  workedFormatted: string;
  workedShort: string;
  idealHours: number;
  idealBreakHours: number;
  idealShiftHours: number;
  remainingMs: number;
  remainingFormatted: string;
  breakAllowanceFormatted: string;
  earlyLeaveReason?: string;
  dailyUpdate?: string;
  leavePunchBlocked?: boolean;
  leavePunchBlockMessage?: string;
};

export type AttendanceHistoryRow = {
  id: string;
  date: string;
  workMode?: string;
  punchIn: string;
  punchOut: string;
  breakStart?: string;
  breakEnd?: string;
  breakTime: string;
  workingHours: string;
  overtime: string;
  status: string;
  overtimeApproval?: string;
  earlyLeaveReason?: string;
  dailyUpdate?: string;
};

export type AttendancePeriod = {
  year: number;
  months: { month: number; label: string }[];
};

export type CorrectionRequestDto = {
  id: string;
  employeeId: string;
  employeeName: string;
  date: string;
  field: string;
  originalValue: string;
  requestedValue: string;
  reason: string;
  status: string;
  remarks: string;
  approvedBy: string;
  approvedDate: string;
  createdAt: string;
};

export type OvertimeRequestDto = {
  id: string;
  employeeId: string;
  employeeName: string;
  attendanceSpreadsheetId: string;
  date: string;
  overtime: string;
  comment: string;
  status: "Pending" | "Approved" | "Rejected";
  remarks: string;
  reviewedBy: string;
  reviewedDate: string;
  createdAt: string;
  requestedByRole?: string;
};

function mapTodayRecord(record: Record<string, unknown>, fallbackDate?: string): TodayAttendance {
  const workedMs = Number(record.workedMs ?? 0);
  const idealHours = Number(record.idealHours ?? 8);
  return {
    date: String(record.date || fallbackDate || new Date().toISOString().slice(0, 10)),
    workMode: String(record.workMode ?? ""),
    punchIn: String(record.punchIn ?? ""),
    punchOut: String(record.punchOut ?? ""),
    breakStart: String(record.breakStart ?? ""),
    breakEnd: String(record.breakEnd ?? ""),
    totalBreakTime: String(record.totalBreakTime ?? ""),
    workingHours: String(record.workingHours ?? ""),
    overtime: String(record.overtime ?? "—"),
    status: String(record.status ?? ""),
    onBreak: Boolean(record.onBreak),
    hasPunchedIn: Boolean(record.hasPunchedIn),
    hasPunchedOut: Boolean(record.hasPunchedOut),
    workedMs,
    workedFormatted: String(record.workedFormatted ?? ""),
    workedShort: String(record.workedFormatted ?? ""),
    idealHours,
    idealBreakHours: Number(record.idealBreakHours ?? 1),
    idealShiftHours: Number(record.idealShiftHours ?? 9),
    remainingMs: Math.max(0, idealHours * 60 * 60 * 1000 - workedMs),
    remainingFormatted: "",
    breakAllowanceFormatted: String(record.breakAllowanceFormatted ?? "0h / 1h"),
    earlyLeaveReason: String(record.earlyLeaveReason ?? ""),
    dailyUpdate: String(record.dailyUpdate ?? ""),
  };
}

export async function fetchTodayAttendance(): Promise<TodayAttendance | null> {
  const res = await fetch("/api/attendance", { credentials: "include" });
  const data = await readResponseJson<{
    success?: boolean;
    message?: string;
    today?: TodayAttendance | null;
  }>(res, "fetch");
  assertApiSuccess(data, "fetch");
  return data.today ?? null;
}

export type AttendanceActionPayload = {
  earlyLeaveReason?: string;
  dailyUpdate?: string;
  workMode?: string;
};

export async function postAttendanceAction(
  action: "punch-in" | "punch-out" | "break-start" | "break-end",
  payload?: AttendanceActionPayload,
): Promise<TodayAttendance> {
  const res = await fetch("/api/attendance", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...payload }),
  });
  const data = await readResponseJson<{
    success?: boolean;
    message?: string;
    record?: Record<string, unknown>;
  }>(res, "action");
  assertApiSuccess(data, "action");
  return mapTodayRecord(data.record ?? {});
}

export async function updateDailyUpdate(
  date: string,
  dailyUpdate: string,
): Promise<TodayAttendance> {
  const res = await fetch("/api/attendance", {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ date, dailyUpdate }),
  });
  const data = await readResponseJson<{
    success?: boolean;
    message?: string;
    record?: Record<string, unknown>;
  }>(res, "action");
  assertApiSuccess(data, "action");
  return mapTodayRecord(data.record ?? {}, date);
}

function attendanceSearchParams(base: Record<string, string>, employeeSheetRow?: number): string {
  const params = new URLSearchParams(base);
  if (employeeSheetRow != null) {
    params.set("employeeSheetRow", String(employeeSheetRow));
  }
  return params.toString();
}

export async function fetchAttendancePeriods(
  employeeSheetRow?: number,
): Promise<AttendancePeriod[]> {
  const res = await fetch(
    `/api/attendance?${attendanceSearchParams({ mode: "periods" }, employeeSheetRow)}`,
    { credentials: "include" },
  );
  const data = await readResponseJson<{
    success?: boolean;
    message?: string;
    periods?: AttendancePeriod[];
  }>(res, "fetch");
  assertApiSuccess(data, "fetch");
  return data.periods ?? [];
}

export async function fetchAttendanceHistory(
  year: number,
  month: number,
  employeeSheetRow?: number,
): Promise<AttendanceHistoryRow[]> {
  const res = await fetch(
    `/api/attendance?${attendanceSearchParams({ year: String(year), month: String(month) }, employeeSheetRow)}`,
    { credentials: "include" },
  );
  const data = await readResponseJson<{
    success?: boolean;
    message?: string;
    records?: AttendanceHistoryRow[];
  }>(res, "fetch");
  assertApiSuccess(data, "fetch");
  return data.records ?? [];
}

export async function submitCorrectionRequest(body: {
  field: string;
  requestedTime: string;
  reason: string;
  date?: string;
}): Promise<void> {
  const res = await fetch("/api/attendance/corrections", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await readResponseJson<{ success?: boolean; message?: string }>(res, "action");
  assertApiSuccess(data, "action");
}

export async function fetchCorrectionRequests(): Promise<CorrectionRequestDto[]> {
  const res = await fetch("/api/attendance/corrections", { credentials: "include" });
  const data = await readResponseJson<{
    success?: boolean;
    message?: string;
    requests?: CorrectionRequestDto[];
  }>(res, "fetch");
  assertApiSuccess(data, "fetch");
  return data.requests ?? [];
}

export type ImportAttendanceResult = {
  message: string;
  imported: number;
  updated: number;
  holidaysSkipped: number;
  errors: string[];
  employee?: {
    employeeId: string;
    employeeName: string;
  };
};

export async function importAttendanceCsv(
  file: File,
  employeeSheetRow: number,
): Promise<ImportAttendanceResult> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("employeeSheetRow", String(employeeSheetRow));

  const res = await fetch("/api/attendance/import", {
    method: "POST",
    credentials: "include",
    body: formData,
  });
  const data = await readResponseJson<{
    success?: boolean;
    message?: string;
    imported?: number;
    updated?: number;
    holidaysSkipped?: number;
    errors?: string[];
    employee?: { employeeId: string; employeeName: string };
  }>(res, "action");
  if (!data.success) {
    throw new Error(
      data.errors?.length
        ? `${toUserFacingActionError(data.message)}: ${data.errors.join("; ")}`
        : toUserFacingActionError(data.message),
    );
  }
  return {
    message: data.message ?? "Import completed",
    imported: data.imported ?? 0,
    updated: data.updated ?? 0,
    holidaysSkipped: data.holidaysSkipped ?? 0,
    errors: data.errors ?? [],
    employee: data.employee,
  };
}

export async function reviewCorrection(
  id: string,
  status: "Approved" | "Rejected",
  remarks?: string,
): Promise<void> {
  const res = await fetch("/api/attendance/corrections", {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, status, remarks }),
  });
  const data = await readResponseJson<{ success?: boolean; message?: string }>(res, "action");
  assertApiSuccess(data, "action");
}

export async function submitOvertimeRequest(body: {
  date: string;
  comment?: string;
  employeeSheetRow?: number;
}): Promise<void> {
  const res = await fetch("/api/attendance/overtime-requests", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await readResponseJson<{ success?: boolean; message?: string }>(res, "action");
  assertApiSuccess(data, "action");
}

export async function fetchOvertimeRequests(): Promise<OvertimeRequestDto[]> {
  const res = await fetch("/api/attendance/overtime-requests", { credentials: "include" });
  const data = await readResponseJson<{
    success?: boolean;
    message?: string;
    requests?: OvertimeRequestDto[];
  }>(res, "fetch");
  assertApiSuccess(data, "fetch");
  return data.requests ?? [];
}

export async function saveHrAttendance(body: {
  employeeSheetRow: number;
  date: string;
  workMode?: string;
  punchIn?: string;
  punchOut?: string;
  breakStart?: string;
  breakEnd?: string;
}): Promise<{ message: string }> {
  const res = await fetch("/api/attendance/manual", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await readResponseJson<{ success?: boolean; message?: string }>(res, "action");
  assertApiSuccess(data, "action");
  return { message: data.message ?? "Attendance saved" };
}

export async function reviewOvertimeRequest(
  id: string,
  status: "Approved" | "Rejected",
  remarks?: string,
): Promise<void> {
  const res = await fetch("/api/attendance/overtime-requests", {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, status, remarks }),
  });
  const data = await readResponseJson<{ success?: boolean; message?: string }>(res, "action");
  assertApiSuccess(data, "action");
}
