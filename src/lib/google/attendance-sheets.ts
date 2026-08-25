import type { LeaveBucketType } from "@/lib/attendance/leave-bucket-layout";
import { mergeLeaveBucketCsvIntoRows } from "@/lib/attendance/leave-bucket/csv-import";
import { applyLeaveDatesToRows } from "@/lib/attendance/leave-bucket/operations";
import {
  getLeaveBucketTemplateRows,
  isCurrentLeaveBucketHeaders,
  LEAVE_BUCKET_COLUMN_COUNT,
  migrateLeaveBucketRows,
  normalizeLeaveBucketRow,
} from "@/lib/attendance/leave-bucket-layout";
import { applyLeaveBucketRowFormats } from "@/lib/attendance/leave-bucket-format";
import { LEAVE_STATUS } from "@/lib/attendance/leave-status";
import {
  ATTENDANCE_COL,
  ATTENDANCE_HEADERS,
  ATTENDANCE_LAST_COLUMN,
  EARLY_LEAVE_REASON_MIN_LENGTH,
  IMPORT_DEFAULT_BREAK,
  OVERTIME_APPROVAL,
  WORK_MODE,
  WORK_MODE_OPTIONS,
  WORKING_STATUS,
  canonicalizeWorkMode,
  isHalfDayUnpaidWorkMode,
  isPunchOptionalWorkMode,
} from "@/lib/attendance/constants";
import {
  computeAttendanceMetrics,
  formatClockTime,
  formatDuration,
  formatIsoDate,
  formatSheetDateLiteral,
  formatWallClockTime,
  monthlySheetTitle,
  normalizeSheetDate,
  parseDurationToMs,
  resolveLiveBreakMs,
  resolveTotalBreakTimeFromClocks,
  parseSheetClockTime,
  parseTimeOnDate,
} from "@/lib/attendance/time";

import { formatDriveError, getDrive, getSheetsClient } from "./drive-auth";
import {
  applySheetHeaderFormatByTitle,
  applySheetHeaderFormatForTitles,
  applySheetHeaderRowFormat,
} from "./sheet-format";

const attendanceSpreadsheetLocks = new Map<string, Promise<string>>();
const yearSpreadsheetIdCache = new Map<string, string>();
const attendanceSpreadsheetMetaCache = new Map<
  string,
  {
    name: string;
    parentFolderId: string | null;
    employeeSlug: string;
    legacyRootName: string;
    sourceYear: number | null;
  }
>();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const isQuotaError = (error: unknown): boolean => {
  const text = String(
    (error as { message?: string })?.message ??
      (error as { errors?: Array<{ message?: string }> })?.errors?.[0]?.message ??
      "",
  ).toLowerCase();
  return text.includes("quota") || text.includes("rate limit") || text.includes("429");
};

async function withQuotaRetry<T>(fn: () => Promise<T>): Promise<T> {
  const delays = [400, 1000, 2200];
  let lastError: unknown;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isQuotaError(error) || attempt === delays.length) break;
      await sleep(delays[attempt]);
    }
  }
  throw lastError;
}

function parseAttendanceFileName(name: string): {
  sourceYear: number | null;
  employeeSlug: string;
  legacyRootName: string;
} {
  const trimmed = name.trim();
  const yearPrefixed = trimmed.match(/^(\d{4})-(.+)$/);
  if (yearPrefixed) {
    const parsedYear = Number.parseInt(yearPrefixed[1], 10);
    const employeeSlug = yearPrefixed[2].trim();
    return {
      sourceYear: Number.isFinite(parsedYear) ? parsedYear : null,
      employeeSlug,
      legacyRootName: employeeSlug.split("-").join(" - ") + " - Attendance",
    };
  }

  const legacyYearSuffixed = trimmed.match(/^(.*)\s-\s(\d{4})$/);
  const legacyRootName = legacyYearSuffixed ? legacyYearSuffixed[1].trim() : trimmed;
  const parsedYear = legacyYearSuffixed ? Number.parseInt(legacyYearSuffixed[2], 10) : NaN;
  const withoutAttendance = legacyRootName.replace(/\s-\sAttendance$/i, "").trim();
  const employeeSlug = withoutAttendance.replace(/\s*-\s*/g, "-");

  return {
    sourceYear: Number.isFinite(parsedYear) ? parsedYear : null,
    employeeSlug,
    legacyRootName,
  };
}

async function getAttendanceSpreadsheetMeta(spreadsheetId: string): Promise<{
  name: string;
  parentFolderId: string | null;
  employeeSlug: string;
  legacyRootName: string;
  sourceYear: number | null;
}> {
  const cached = attendanceSpreadsheetMetaCache.get(spreadsheetId);
  if (cached) return cached;
  const drive = await getDrive();
  const file = await withQuotaRetry(() =>
    drive.files.get({
      fileId: spreadsheetId,
      fields: "name,parents",
      supportsAllDrives: true,
    }),
  );
  const fileData = file.data as { name?: string | null; parents?: string[] | null };
  const name = fileData.name ?? "Attendance";
  const parentFolderId = fileData.parents?.[0] ?? null;
  const parsed = parseAttendanceFileName(name);
  const meta = {
    name,
    parentFolderId,
    employeeSlug: parsed.employeeSlug,
    legacyRootName: parsed.legacyRootName,
    sourceYear: parsed.sourceYear,
  };
  attendanceSpreadsheetMetaCache.set(spreadsheetId, meta);
  return meta;
}

async function resolveYearSpreadsheetId(
  baseSpreadsheetId: string,
  year: number,
  options?: { createIfMissing?: boolean },
): Promise<string> {
  const createIfMissing = options?.createIfMissing !== false;
  // Separate cache keys so a read-only fallback to the base workbook is never
  // reused by write paths that should create/find the year spreadsheet.
  const cacheKey = `${baseSpreadsheetId}:${year}:${createIfMissing ? "w" : "r"}`;
  const cached = yearSpreadsheetIdCache.get(cacheKey);
  if (cached) return cached;

  const meta = await getAttendanceSpreadsheetMeta(baseSpreadsheetId);
  const parentFolderId = meta.parentFolderId;
  if (!parentFolderId) {
    yearSpreadsheetIdCache.set(cacheKey, baseSpreadsheetId);
    return baseSpreadsheetId;
  }

  if (meta.sourceYear === year) {
    yearSpreadsheetIdCache.set(cacheKey, baseSpreadsheetId);
    return baseSpreadsheetId;
  }

  const targetName = `${year}-${meta.employeeSlug}`;
  if (targetName === meta.name) {
    yearSpreadsheetIdCache.set(cacheKey, baseSpreadsheetId);
    return baseSpreadsheetId;
  }

  const drive = await getDrive();
  const query = [
    "mimeType = 'application/vnd.google-apps.spreadsheet'",
    "trashed = false",
    `'${parentFolderId}' in parents`,
    `name = '${targetName.replace(/'/g, "\\'")}'`,
  ].join(" and ");
  const existing = await withQuotaRetry(() =>
    drive.files.list({
      q: query,
      fields: "files(id,createdTime)",
      orderBy: "createdTime",
      pageSize: 1,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    }),
  );
  const foundId = existing.data.files?.[0]?.id;
  if (foundId) {
    yearSpreadsheetIdCache.set(cacheKey, foundId);
    return foundId;
  }

  // Backward compatibility: reuse old naming format if it already exists.
  const legacyTargetName = `${meta.legacyRootName} - ${year}`;
  const legacyQuery = [
    "mimeType = 'application/vnd.google-apps.spreadsheet'",
    "trashed = false",
    `'${parentFolderId}' in parents`,
    `name = '${legacyTargetName.replace(/'/g, "\\'")}'`,
  ].join(" and ");
  const legacyExisting = await withQuotaRetry(() =>
    drive.files.list({
      q: legacyQuery,
      fields: "files(id,createdTime)",
      orderBy: "createdTime",
      pageSize: 1,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    }),
  );
  const legacyId = legacyExisting.data.files?.[0]?.id;
  if (legacyId) {
    yearSpreadsheetIdCache.set(cacheKey, legacyId);
    return legacyId;
  }

  // Read paths must not create empty year workbooks — that hid real data on the base sheet.
  if (!createIfMissing) {
    yearSpreadsheetIdCache.set(cacheKey, baseSpreadsheetId);
    return baseSpreadsheetId;
  }

  const created = await withQuotaRetry(() =>
    drive.files.create({
      requestBody: {
        name: targetName,
        mimeType: "application/vnd.google-apps.spreadsheet",
        parents: [parentFolderId],
      },
      fields: "id",
      supportsAllDrives: true,
    }),
  );
  const createdId = created.data.id;
  if (!createdId) throw new Error(`Failed to create attendance spreadsheet for year ${year}`);
  yearSpreadsheetIdCache.set(cacheKey, createdId);
  return createdId;
}

async function resolveSpreadsheetForDate(baseSpreadsheetId: string, date: Date): Promise<string> {
  const year = date.getFullYear();
  if (!Number.isFinite(year)) return baseSpreadsheetId;
  return resolveYearSpreadsheetId(baseSpreadsheetId, year);
}

async function listYearlySpreadsheetIds(baseSpreadsheetId: string): Promise<string[]> {
  const meta = await getAttendanceSpreadsheetMeta(baseSpreadsheetId);
  if (!meta.parentFolderId) return [baseSpreadsheetId];
  const drive = await getDrive();
  const query = [
    "mimeType = 'application/vnd.google-apps.spreadsheet'",
    "trashed = false",
    `'${meta.parentFolderId}' in parents`,
  ].join(" and ");

  const yearlyFiles = await withQuotaRetry(() =>
    drive.files.list({
      q: query,
      fields: "files(id,name)",
      pageSize: 100,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    }),
  );

  const ids = new Set<string>([baseSpreadsheetId]);
  for (const file of yearlyFiles.data.files ?? []) {
    const name = file.name ?? "";
    const parsed = parseAttendanceFileName(name);
    const isLegacyPatternMatch = name.startsWith(`${meta.legacyRootName} - `);
    if (
      file.id &&
      parsed.sourceYear != null &&
      (parsed.employeeSlug === meta.employeeSlug || isLegacyPatternMatch)
    ) {
      ids.add(file.id);
    }
  }
  return [...ids];
}

export type AttendanceRow = {
  sheetRow: number;
  date: string;
  workMode: string;
  punchIn: string;
  punchOut: string;
  breakStart: string;
  breakEnd: string;
  totalBreakTime: string;
  workingHours: string;
  status: string;
  overtime: string;
  earlyLeaveReason: string;
  dailyUpdate: string;
  isOvertimeApproved: string;
};

function applyAttendanceMetrics(rowValues: string[], baseDate: Date): void {
  const punchOut = (rowValues[ATTENDANCE_COL.punchOut] ?? "").trim();
  const workMode = rowValues[ATTENDANCE_COL.workMode] ?? WORK_MODE.FULL_DAY_ONSITE;
  rowValues[ATTENDANCE_COL.totalBreakTime] = resolveTotalBreakTimeFromClocks({
    breakStart: rowValues[ATTENDANCE_COL.breakStart] ?? "",
    breakEnd: rowValues[ATTENDANCE_COL.breakEnd] ?? "",
    punchIn: rowValues[ATTENDANCE_COL.punchIn] ?? "",
    existingTotalBreakTime: rowValues[ATTENDANCE_COL.totalBreakTime] ?? "",
    baseDate,
    workMode,
  });
  const metrics = computeAttendanceMetrics({
    punchIn: rowValues[ATTENDANCE_COL.punchIn] ?? "",
    punchOut: rowValues[ATTENDANCE_COL.punchOut] ?? "",
    totalBreakTime: rowValues[ATTENDANCE_COL.totalBreakTime] ?? "",
    baseDate,
    punchedOut: Boolean(punchOut),
    workMode,
  });

  if (punchOut) {
    rowValues[ATTENDANCE_COL.workingHours] = metrics.workingHours;
    rowValues[ATTENDANCE_COL.overtime] = metrics.overtime;
    rowValues[ATTENDANCE_COL.status] = resolveAttendanceStatus(
      metrics.status,
      rowValues[ATTENDANCE_COL.isOvertimeApproved] ?? OVERTIME_APPROVAL.NOT_CONSIDERED,
      metrics.overtime,
    );
    if (rowValues[ATTENDANCE_COL.status] !== WORKING_STATUS.SHORT) {
      rowValues[ATTENDANCE_COL.earlyLeaveReason] = "";
    }
  } else {
    rowValues[ATTENDANCE_COL.overtime] = "—";
    rowValues[ATTENDANCE_COL.status] = WORKING_STATUS.IN_PROGRESS;
  }
}

function resolveAttendanceStatus(
  baseStatus: string,
  overtimeApproval: string,
  overtimeValue: string,
): string {
  const approval = overtimeApproval.trim();
  const overtime = overtimeValue.trim();
  const hasPositiveOvertime =
    overtime.length > 0 && overtime !== "—" && !overtime.startsWith("-") && /\d/.test(overtime);

  if (!hasPositiveOvertime) {
    return baseStatus;
  }

  if (approval === OVERTIME_APPROVAL.PENDING) return WORKING_STATUS.OVERTIME_REQUESTED;
  if (approval === OVERTIME_APPROVAL.ACCEPTED) return WORKING_STATUS.OVERTIME_APPROVED;
  if (approval === OVERTIME_APPROVAL.REJECTED) return WORKING_STATUS.OVERTIME_REJECTED;
  return baseStatus;
}

function rowFromValues(values: string[], sheetRow: number): AttendanceRow {
  const dateStr = normalizeSheetDate(values[ATTENDANCE_COL.date] ?? "");
  const baseDate = dateStr ? new Date(`${dateStr}T12:00:00`) : new Date();
  const punchOut = values[ATTENDANCE_COL.punchOut] ?? "";
  const punchedOut = Boolean(punchOut.trim());
  const workMode = values[ATTENDANCE_COL.workMode] ?? WORK_MODE.FULL_DAY_ONSITE;
  const overtimeApproval =
    values[ATTENDANCE_COL.isOvertimeApproved] ?? OVERTIME_APPROVAL.NOT_CONSIDERED;
  const totalBreakTime = resolveTotalBreakTimeFromClocks({
    breakStart: values[ATTENDANCE_COL.breakStart] ?? "",
    breakEnd: values[ATTENDANCE_COL.breakEnd] ?? "",
    punchIn: values[ATTENDANCE_COL.punchIn] ?? "",
    existingTotalBreakTime: values[ATTENDANCE_COL.totalBreakTime] ?? "",
    baseDate,
    workMode,
  });

  const metrics = computeAttendanceMetrics({
    punchIn: values[ATTENDANCE_COL.punchIn] ?? "",
    punchOut,
    totalBreakTime,
    baseDate,
    punchedOut,
    workMode,
  });

  // Prefer persisted WH / OT / status so totals match column H/J (not a live recompute
  // that ignores a break already baked into stored working hours).
  const storedWorkingHours = (values[ATTENDANCE_COL.workingHours] ?? "").trim();
  const useStored = punchedOut && storedWorkingHours.length > 0;
  const workingHours = punchedOut ? (useStored ? storedWorkingHours : metrics.workingHours) : "";
  const overtime = punchedOut
    ? useStored
      ? (values[ATTENDANCE_COL.overtime] ?? "").trim() || "—"
      : metrics.overtime
    : "—";
  const status = punchedOut
    ? resolveAttendanceStatus(
        useStored ? (values[ATTENDANCE_COL.status] ?? "").trim() || metrics.status : metrics.status,
        overtimeApproval,
        overtime,
      )
    : (values[ATTENDANCE_COL.status] ?? WORKING_STATUS.IN_PROGRESS);

  return {
    sheetRow,
    date: dateStr,
    workMode,
    punchIn: values[ATTENDANCE_COL.punchIn] ?? "",
    punchOut,
    breakStart: values[ATTENDANCE_COL.breakStart] ?? "",
    breakEnd: values[ATTENDANCE_COL.breakEnd] ?? "",
    totalBreakTime,
    workingHours,
    status,
    overtime,
    earlyLeaveReason:
      punchedOut && status !== WORKING_STATUS.SHORT
        ? ""
        : (values[ATTENDANCE_COL.earlyLeaveReason] ?? ""),
    dailyUpdate: values[ATTENDANCE_COL.dailyUpdate] ?? "",
    isOvertimeApproved: overtimeApproval,
  };
}

export function attendanceSpreadsheetFileName(employeeId: string, employeeName: string): string {
  return `${employeeId} - ${employeeName} - Attendance`;
}

function attendanceYearSpreadsheetFileName(
  employeeId: string,
  employeeName: string,
  year: number = new Date().getFullYear(),
): string {
  return `${year}-${employeeId}-${employeeName}`;
}

/** Reuse an existing attendance file in the employee folder (avoids duplicates). */
export async function findAttendanceSpreadsheetInFolder(
  parentFolderId: string,
  employeeId: string,
  employeeName: string,
): Promise<string | null> {
  const drive = await getDrive();
  const slug = `${employeeId}-${employeeName}`.toLowerCase();
  const legacyName = attendanceSpreadsheetFileName(employeeId, employeeName).toLowerCase();
  const query = [
    "mimeType = 'application/vnd.google-apps.spreadsheet'",
    "trashed = false",
    `'${parentFolderId}' in parents`,
  ].join(" and ");

  const response = await drive.files.list({
    q: query,
    fields: "files(id,name,createdTime)",
    orderBy: "createdTime desc",
    pageSize: 100,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  const files = response.data.files ?? [];
  const yearPattern = /^\d{4}-.+$/;

  for (const file of files) {
    const name = (file.name ?? "").trim().toLowerCase();
    if (!file.id || !name) continue;
    if (yearPattern.test(name) && name.endsWith(slug)) return file.id;
  }

  for (const file of files) {
    const name = (file.name ?? "").trim().toLowerCase();
    if (!file.id || !name) continue;
    if (name === legacyName) return file.id;
  }

  return null;
}

export async function getOrCreateEmployeeAttendanceSpreadsheet(
  employeeId: string,
  employeeName: string,
  parentFolderId: string,
  birthdayDate = "",
): Promise<string> {
  const lockKey = `${parentFolderId}:${employeeId}`;
  const existing = attendanceSpreadsheetLocks.get(lockKey);
  if (existing) return existing;

  const promise = (async () => {
    const found = await findAttendanceSpreadsheetInFolder(parentFolderId, employeeId, employeeName);
    if (found) return found;
    return createEmployeeAttendanceSpreadsheet(
      employeeId,
      employeeName,
      parentFolderId,
      birthdayDate,
    );
  })();

  attendanceSpreadsheetLocks.set(lockKey, promise);
  try {
    return await promise;
  } finally {
    attendanceSpreadsheetLocks.delete(lockKey);
  }
}

export async function createEmployeeAttendanceSpreadsheet(
  employeeId: string,
  employeeName: string,
  parentFolderId: string,
  birthdayDate = "",
): Promise<string> {
  const title = attendanceYearSpreadsheetFileName(employeeId, employeeName);
  const sheetName = monthlySheetTitle();

  try {
    const drive = await getDrive();
    const created = await drive.files.create({
      requestBody: {
        name: title,
        mimeType: "application/vnd.google-apps.spreadsheet",
        parents: [parentFolderId],
      },
      fields: "id",
      supportsAllDrives: true,
    });

    const spreadsheetId = created.data.id;
    if (!spreadsheetId) {
      throw new Error("Failed to create attendance spreadsheet in Drive");
    }

    const sheetsApi = await getSheetsClient();
    const meta = await sheetsApi.spreadsheets.get({
      spreadsheetId,
      fields: "sheets.properties",
    });
    const defaultSheetId = meta.data.sheets?.[0]?.properties?.sheetId;

    if (defaultSheetId != null) {
      await sheetsApi.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              updateSheetProperties: {
                properties: { sheetId: defaultSheetId, title: sheetName },
                fields: "title",
              },
            },
          ],
        },
      });
    }

    await sheetsApi.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!A1:${ATTENDANCE_LAST_COLUMN}1`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [ATTENDANCE_HEADERS as unknown as string[]],
      },
    });

    const sheetId = defaultSheetId ?? (await getSheetId(spreadsheetId, sheetName));
    if (sheetId != null) {
      await applySheetHeaderRowFormat(sheetsApi, spreadsheetId, sheetId, ATTENDANCE_HEADERS.length);
    }
    await applyWorkModeDropdownByTitle(spreadsheetId, sheetName);
    await applyOvertimeApprovalDropdownByTitle(spreadsheetId, sheetName);
    await ensureLeaveBucketSheet(spreadsheetId, { birthdayDate });

    return spreadsheetId;
  } catch (error) {
    throw formatDriveError(error);
  }
}

const LEAVE_BUCKET_SHEET_NAME = "Leave Bucket";
const LEAVE_BUCKET_SHEET_RANGE = "A:X";
const LEAVE_BUCKET_READY_TTL_MS = 5 * 60 * 1000;

const leaveBucketReadyAt = new Map<string, number>();
const leaveBucketReadyRequests = new Map<string, Promise<void>>();

async function ensureLeaveBucketReady(spreadsheetId: string): Promise<void> {
  const trimmed = spreadsheetId.trim();
  if (!trimmed) return;

  const readyAt = leaveBucketReadyAt.get(trimmed) ?? 0;
  if (Date.now() - readyAt < LEAVE_BUCKET_READY_TTL_MS) return;

  const inflight = leaveBucketReadyRequests.get(trimmed);
  if (inflight) {
    await inflight;
    return;
  }

  const request = (async () => {
    await ensureLeaveBucketSheet(trimmed);
    await ensureLeaveBucketLayout(trimmed);
    leaveBucketReadyAt.set(trimmed, Date.now());
  })().finally(() => {
    leaveBucketReadyRequests.delete(trimmed);
  });

  leaveBucketReadyRequests.set(trimmed, request);
  await request;
}

async function ensureLeaveBucketLayout(spreadsheetId: string): Promise<void> {
  const sheetsApi = await getSheetsClient();
  const existingId = await getSheetId(spreadsheetId, LEAVE_BUCKET_SHEET_NAME);
  if (existingId == null) return;

  const response = await sheetsApi.spreadsheets.values.get({
    spreadsheetId,
    range: `${LEAVE_BUCKET_SHEET_NAME}!${LEAVE_BUCKET_SHEET_RANGE}`,
  });

  const values = response.data.values ?? [];
  if (values.length === 0 || isCurrentLeaveBucketHeaders(values[0] ?? [])) {
    return;
  }

  const migrated = migrateLeaveBucketRows(values);

  await sheetsApi.spreadsheets.values.update({
    spreadsheetId,
    range: `${LEAVE_BUCKET_SHEET_NAME}!A1:X${Math.max(migrated.length, 13)}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: migrated },
  });

  await applySheetHeaderFormatByTitle(
    spreadsheetId,
    LEAVE_BUCKET_SHEET_NAME,
    LEAVE_BUCKET_COLUMN_COUNT,
  );
}

export async function ensureLeaveBucketSheet(
  spreadsheetId: string,
  options?: { birthdayDate?: string },
): Promise<void> {
  const sheetsApi = await getSheetsClient();
  const existingId = await getSheetId(spreadsheetId, LEAVE_BUCKET_SHEET_NAME);
  if (existingId != null) return;

  await sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{ addSheet: { properties: { title: LEAVE_BUCKET_SHEET_NAME } } }],
    },
  });

  await sheetsApi.spreadsheets.values.update({
    spreadsheetId,
    range: `${LEAVE_BUCKET_SHEET_NAME}!A1:X13`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: getLeaveBucketTemplateRows(options?.birthdayDate ?? ""),
    },
  });

  await applySheetHeaderFormatByTitle(
    spreadsheetId,
    LEAVE_BUCKET_SHEET_NAME,
    LEAVE_BUCKET_COLUMN_COUNT,
  );
}

function normalizeLeaveBucketType(value: string): LeaveBucketType {
  const normalized = value.trim().toLowerCase();

  if (normalized === "paid" || normalized === "paid leave") return "paid";
  if (normalized === "casual" || normalized === "casual leave") return "casual";
  if (normalized === "sick" || normalized === "sick leave" || normalized === "sl") return "sick";
  if (normalized === "birthday" || normalized === "birthday leave") return "birthday";
  return "unpaid";
}

// function parsePlainDate(value: string): Date | null {
//   const trimmed = value.trim();
//   if (!trimmed) return null;

//   const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
//   if (slashMatch) {
//     const month = Number(slashMatch[1]);
//     const day = Number(slashMatch[2]);
//     const year = Number(slashMatch[3]);
//     const date = new Date(year, month - 1, day);
//     if (!Number.isNaN(date.getTime())) return date;
//   }

//   const isoDate = new Date(trimmed);
//   if (!Number.isNaN(isoDate.getTime())) return isoDate;

//   return null;
// }

export async function addLeaveDatesToBucket(
  spreadsheetId: string,
  leaveType: string,
  dates: Date[],
  duration: "full" | "half_am" | "half_pm" = "full",
  reason = "",
): Promise<void> {
  const targetType = normalizeLeaveBucketType(leaveType);
  await addGroupedLeaveDatesToBucket(
    spreadsheetId,
    [{ leaveType: targetType, dates }],
    duration,
    reason,
  );
}

export async function addGroupedLeaveDatesToBucket(
  spreadsheetId: string,
  groups: Array<{ leaveType: LeaveBucketType; dates: Date[] }>,
  duration: "full" | "half_am" | "half_pm" = "full",
  reason = "",
): Promise<void> {
  const sheetsApi = await getSheetsClient();
  await ensureLeaveBucketSheet(spreadsheetId);
  await ensureLeaveBucketLayout(spreadsheetId);

  const response = await sheetsApi.spreadsheets.values.get({
    spreadsheetId,
    range: `${LEAVE_BUCKET_SHEET_NAME}!${LEAVE_BUCKET_SHEET_RANGE}`,
  });

  const values = response.data.values ?? getLeaveBucketTemplateRows();
  const rows = migrateLeaveBucketRows(values).map((row) => normalizeLeaveBucketRow(row));
  const appliedRows: Array<{ rowIndex: number; leaveType: LeaveBucketType }> = [];

  for (const group of groups) {
    if (group.dates.length === 0) continue;
    appliedRows.push(
      ...applyLeaveDatesToRows(rows, group.leaveType, group.dates, duration, reason),
    );
  }

  await sheetsApi.spreadsheets.values.update({
    spreadsheetId,
    range: `${LEAVE_BUCKET_SHEET_NAME}!A1:X${rows.length}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: rows },
  });

  await applyLeaveBucketRowFormats(
    spreadsheetId,
    appliedRows.map((entry) => ({
      ...entry,
      status: LEAVE_STATUS.APPLIED,
    })),
  );
}

export async function readLeaveBucketRows(spreadsheetId: string): Promise<string[][]> {
  const sheetsApi = await getSheetsClient();
  await ensureLeaveBucketReady(spreadsheetId);

  const response = await sheetsApi.spreadsheets.values.get({
    spreadsheetId,
    range: `${LEAVE_BUCKET_SHEET_NAME}!${LEAVE_BUCKET_SHEET_RANGE}`,
  });

  const values = response.data.values ?? getLeaveBucketTemplateRows();
  return migrateLeaveBucketRows(values).map((row) => normalizeLeaveBucketRow(row));
}

export async function writeLeaveBucketRows(spreadsheetId: string, rows: string[][]): Promise<void> {
  const sheetsApi = await getSheetsClient();
  await ensureLeaveBucketReady(spreadsheetId);
  const normalized = migrateLeaveBucketRows(rows).map((row) => normalizeLeaveBucketRow(row));

  await sheetsApi.spreadsheets.values.update({
    spreadsheetId,
    range: `${LEAVE_BUCKET_SHEET_NAME}!A1:X${normalized.length}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: normalized },
  });
}

export async function importLeaveBucketCsv(spreadsheetId: string, content: string): Promise<void> {
  await ensureLeaveBucketSheet(spreadsheetId);
  await ensureLeaveBucketLayout(spreadsheetId);

  const sheetsApi = await getSheetsClient();
  const response = await sheetsApi.spreadsheets.values.get({
    spreadsheetId,
    range: `${LEAVE_BUCKET_SHEET_NAME}!${LEAVE_BUCKET_SHEET_RANGE}`,
  });

  const existingValues = migrateLeaveBucketRows(
    response.data.values ?? getLeaveBucketTemplateRows(),
  ).map((row) => normalizeLeaveBucketRow(row));
  const resultValues = mergeLeaveBucketCsvIntoRows(existingValues, content);

  await sheetsApi.spreadsheets.values.update({
    spreadsheetId,
    range: `${LEAVE_BUCKET_SHEET_NAME}!A1:X${resultValues.length}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: resultValues },
  });
}

async function getSheetId(spreadsheetId: string, title: string): Promise<number | null> {
  const sheetsApi = await getSheetsClient();
  const meta = await sheetsApi.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties",
  });

  const normalized = title.trim().toLowerCase();
  const sheet = meta.data.sheets?.find(
    (s) => (s.properties?.title ?? "").trim().toLowerCase() === normalized,
  );
  return sheet?.properties?.sheetId ?? null;
}

async function applyWorkModeDropdownByTitle(
  spreadsheetId: string,
  sheetTitle: string,
): Promise<void> {
  const sheetsApi = await getSheetsClient();
  const meta = await sheetsApi.spreadsheets.get({
    spreadsheetId,
    fields: "sheets(properties(sheetId,title),conditionalFormats)",
  });
  const normalized = sheetTitle.trim().toLowerCase();
  const targetSheet = meta.data.sheets?.find(
    (s) => (s.properties?.title ?? "").trim().toLowerCase() === normalized,
  );
  const sheetId = targetSheet?.properties?.sheetId;
  if (sheetId == null) return;

  const workModeColumnStart = ATTENDANCE_COL.workMode;
  const workModeColumnEnd = ATTENDANCE_COL.workMode + 1;
  const hasRulesAlready = (targetSheet?.conditionalFormats ?? []).some((rule) => {
    const range = rule.ranges?.[0];
    const condition = rule.booleanRule?.condition;
    return (
      range?.sheetId === sheetId &&
      range.startColumnIndex === workModeColumnStart &&
      range.endColumnIndex === workModeColumnEnd &&
      condition?.type === "TEXT_EQ"
    );
  });

  const workModeColors: Record<string, { red: number; green: number; blue: number }> = {
    [WORK_MODE.WFH]: { red: 0.86, green: 0.93, blue: 1 },
    [WORK_MODE.WFH_HALF_DAY]: { red: 0.82, green: 0.9, blue: 1 },
    [WORK_MODE.UNPAID_LEAVE]: { red: 1, green: 0.9, blue: 0.9 },
    [WORK_MODE.SICK_LEAVE]: { red: 1, green: 0.9, blue: 0.95 },
    [WORK_MODE.PUBLIC_HOLIDAY]: { red: 0.95, green: 0.88, blue: 1 },
    [WORK_MODE.WEEKEND_HOLIDAY]: { red: 0.92, green: 0.92, blue: 0.92 },
    [WORK_MODE.FULL_DAY_ONSITE]: { red: 0.86, green: 0.97, blue: 0.89 },
    [WORK_MODE.HALF_DAY_UNPAID_LEAVE]: { red: 1, green: 0.95, blue: 0.83 },
  };

  const requests = [
    {
      setDataValidation: {
        range: {
          sheetId,
          startRowIndex: 1,
          startColumnIndex: workModeColumnStart,
          endColumnIndex: workModeColumnEnd,
        },
        rule: {
          condition: {
            type: "ONE_OF_LIST",
            values: WORK_MODE_OPTIONS.map((mode) => ({ userEnteredValue: mode })),
          },
          strict: true,
          showCustomUi: true,
        },
      },
    },
    ...(!hasRulesAlready
      ? WORK_MODE_OPTIONS.map((mode, index) => ({
          addConditionalFormatRule: {
            index,
            rule: {
              ranges: [
                {
                  sheetId,
                  startRowIndex: 1,
                  startColumnIndex: workModeColumnStart,
                  endColumnIndex: workModeColumnEnd,
                },
              ],
              booleanRule: {
                condition: {
                  type: "TEXT_EQ",
                  values: [{ userEnteredValue: mode }],
                },
                format: {
                  backgroundColor: workModeColors[mode],
                  textFormat: { bold: true },
                },
              },
            },
          },
        }))
      : []),
  ];

  await sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests },
  });
}

async function applyOvertimeApprovalDropdownByTitle(
  spreadsheetId: string,
  sheetTitle: string,
): Promise<void> {
  const sheetsApi = await getSheetsClient();
  const meta = await sheetsApi.spreadsheets.get({
    spreadsheetId,
    fields: "sheets(properties(sheetId,title))",
  });
  const normalized = sheetTitle.trim().toLowerCase();
  const targetSheet = meta.data.sheets?.find(
    (s) => (s.properties?.title ?? "").trim().toLowerCase() === normalized,
  );
  const sheetId = targetSheet?.properties?.sheetId;
  if (sheetId == null) return;

  await sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          setDataValidation: {
            range: {
              sheetId,
              startRowIndex: 1,
              startColumnIndex: ATTENDANCE_COL.isOvertimeApproved,
              endColumnIndex: ATTENDANCE_COL.isOvertimeApproved + 1,
            },
            rule: {
              condition: {
                type: "ONE_OF_LIST",
                values: [
                  { userEnteredValue: OVERTIME_APPROVAL.ACCEPTED },
                  { userEnteredValue: OVERTIME_APPROVAL.REJECTED },
                  { userEnteredValue: OVERTIME_APPROVAL.PENDING },
                  { userEnteredValue: OVERTIME_APPROVAL.NOT_CONSIDERED },
                ],
              },
              strict: true,
              showCustomUi: true,
            },
          },
        },
      ],
    },
  });
}

export async function listMonthlySheets(spreadsheetId: string): Promise<string[]> {
  const sheetsApi = await getSheetsClient();
  const meta = await sheetsApi.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties.title",
  });

  return (
    meta.data.sheets
      ?.map((s) => s.properties?.title ?? "")
      .filter((title) => /^[A-Za-z]{3}-\d{4}$/.test(title)) ?? []
  );
}

async function ensureAttendanceHeaderRow(spreadsheetId: string, sheetTitle: string): Promise<void> {
  const sheetsApi = await getSheetsClient();
  const response = await sheetsApi.spreadsheets.values.get({
    spreadsheetId,
    range: `'${sheetTitle}'!A1:${ATTENDANCE_LAST_COLUMN}1`,
  });
  const row = response.data.values?.[0] ?? [];
  const expected = ATTENDANCE_HEADERS as unknown as string[];
  const isLegacyWithoutWorkMode =
    row.length === expected.length - 1 &&
    (row[0] ?? "").trim() === "Date" &&
    (row[1] ?? "").trim() === "Punch In";

  if (isLegacyWithoutWorkMode) {
    const sheetId = await getSheetId(spreadsheetId, sheetTitle);
    if (sheetId != null) {
      await sheetsApi.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              insertDimension: {
                range: {
                  sheetId,
                  dimension: "COLUMNS",
                  startIndex: ATTENDANCE_COL.workMode,
                  endIndex: ATTENDANCE_COL.workMode + 1,
                },
                inheritFromBefore: false,
              },
            },
          ],
        },
      });

      const dataRows = await sheetsApi.spreadsheets.values.get({
        spreadsheetId,
        range: `'${sheetTitle}'!A2:A`,
      });
      const existingDataRows = (dataRows.data.values ?? []).length;
      if (existingDataRows > 0) {
        await sheetsApi.spreadsheets.values.update({
          spreadsheetId,
          range: `'${sheetTitle}'!B2:B${existingDataRows + 1}`,
          valueInputOption: "USER_ENTERED",
          requestBody: {
            values: Array.from({ length: existingDataRows }, () => [WORK_MODE.FULL_DAY_ONSITE]),
          },
        });
      }
    }
  }

  const refreshedHeader = await sheetsApi.spreadsheets.values.get({
    spreadsheetId,
    range: `'${sheetTitle}'!A1:${ATTENDANCE_LAST_COLUMN}1`,
  });
  const updatedRow = refreshedHeader.data.values?.[0] ?? [];
  const needsUpdate =
    updatedRow.length < expected.length ||
    expected.some((header, i) => (updatedRow[i] ?? "").trim() !== header);

  if (needsUpdate) {
    await sheetsApi.spreadsheets.values.update({
      spreadsheetId,
      range: `'${sheetTitle}'!A1:${ATTENDANCE_LAST_COLUMN}1`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [expected] },
    });
  }

  await applySheetHeaderFormatByTitle(spreadsheetId, sheetTitle, ATTENDANCE_HEADERS.length);
  await applyWorkModeDropdownByTitle(spreadsheetId, sheetTitle);
  await applyOvertimeApprovalDropdownByTitle(spreadsheetId, sheetTitle);
}

export async function ensureMonthlySheet(
  spreadsheetId: string,
  date: Date = new Date(),
): Promise<string> {
  const title = monthlySheetTitle(date);
  const existingId = await getSheetId(spreadsheetId, title);
  if (existingId != null) {
    await ensureAttendanceHeaderRow(spreadsheetId, title);
    return title;
  }

  const sheetsApi = await getSheetsClient();
  const meta = await sheetsApi.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties",
  });
  const sheets = meta.data.sheets ?? [];

  const defaultSheet = sheets.find((s) => {
    const t = s.properties?.title ?? "";
    return t === "Employees" || /^Sheet\d+$/.test(t);
  });

  if (sheets.length === 1 && defaultSheet?.properties?.sheetId != null) {
    await sheetsApi.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            updateSheetProperties: {
              properties: {
                sheetId: defaultSheet.properties.sheetId,
                title,
              },
              fields: "title",
            },
          },
        ],
      },
    });
  } else {
    await sheetsApi.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: { title },
            },
          },
        ],
      },
    });
  }

  await sheetsApi.spreadsheets.values.update({
    spreadsheetId,
    range: `${title}!A1:${ATTENDANCE_LAST_COLUMN}1`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [ATTENDANCE_HEADERS as unknown as string[]],
    },
  });

  await applySheetHeaderFormatByTitle(spreadsheetId, title, ATTENDANCE_HEADERS.length);
  await applyWorkModeDropdownByTitle(spreadsheetId, title);
  await applyOvertimeApprovalDropdownByTitle(spreadsheetId, title);
  await ensureLeaveBucketSheet(spreadsheetId);

  return title;
}

/** Apply standard header styling to every monthly tab (existing + new). */
export async function formatAllAttendanceMonthlyHeaders(spreadsheetId: string): Promise<void> {
  const titles = await listMonthlySheets(spreadsheetId);
  for (const sheetTitle of titles) {
    await ensureAttendanceHeaderRow(spreadsheetId, sheetTitle);
  }
  if (titles.length > 0) {
    await applySheetHeaderFormatForTitles(spreadsheetId, titles, ATTENDANCE_HEADERS.length);
  }
}

async function readMonthlyRows(spreadsheetId: string, sheetTitle: string): Promise<string[][]> {
  const sheetsApi = await getSheetsClient();
  const response = await sheetsApi.spreadsheets.values.get({
    spreadsheetId,
    range: `'${sheetTitle}'!A:${ATTENDANCE_LAST_COLUMN}`,
  });

  return response.data.values ?? [];
}

function findTodayRow(rows: string[][], today: string): { row: string[]; sheetRow: number } | null {
  const target = normalizeSheetDate(today);

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const rowDate = normalizeSheetDate(row[ATTENDANCE_COL.date] ?? "");
    if (rowDate === target) {
      return { row, sheetRow: i + 1 };
    }
  }

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const punchIn = (row[ATTENDANCE_COL.punchIn] ?? "").trim();
    const punchOut = (row[ATTENDANCE_COL.punchOut] ?? "").trim();
    const rowDate = normalizeSheetDate(row[ATTENDANCE_COL.date] ?? "");
    if (!rowDate && punchIn && !punchOut) {
      return { row, sheetRow: i + 1 };
    }
  }

  return null;
}

export async function getTodayAttendance(
  spreadsheetId: string,
  date: Date = new Date(),
): Promise<AttendanceRow | null> {
  const targetSpreadsheetId = await resolveSpreadsheetForDate(spreadsheetId, date);
  const sheetTitle = await ensureMonthlySheet(targetSpreadsheetId, date);
  const rows = await readMonthlyRows(targetSpreadsheetId, sheetTitle);
  const today = formatIsoDate(date);
  const found = findTodayRow(rows, today);
  if (!found) return null;
  return rowFromValues(found.row, found.sheetRow);
}

async function updateAttendanceRow(
  spreadsheetId: string,
  sheetTitle: string,
  sheetRow: number,
  values: string[],
): Promise<void> {
  const sheetsApi = await getSheetsClient();
  await sheetsApi.spreadsheets.values.update({
    spreadsheetId,
    range: `'${sheetTitle}'!A${sheetRow}:${ATTENDANCE_LAST_COLUMN}${sheetRow}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [values] },
  });
}

function buildRowValues(existing: string[] | undefined, date: Date): string[] {
  const base = [...(existing ?? [])];
  while (base.length < ATTENDANCE_HEADERS.length) base.push("");
  if (!normalizeSheetDate(base[ATTENDANCE_COL.date] ?? "")) {
    base[ATTENDANCE_COL.date] = formatSheetDateLiteral(date);
  }
  if (!(base[ATTENDANCE_COL.workMode] ?? "").trim()) {
    base[ATTENDANCE_COL.workMode] = WORK_MODE.FULL_DAY_ONSITE;
  }
  if (!(base[ATTENDANCE_COL.isOvertimeApproved] ?? "").trim()) {
    base[ATTENDANCE_COL.isOvertimeApproved] = OVERTIME_APPROVAL.NOT_CONSIDERED;
  }
  return base;
}

async function ensureSheetHasRows(
  spreadsheetId: string,
  sheetTitle: string,
  requiredRow: number,
): Promise<void> {
  const sheetsApi = await getSheetsClient();
  const meta = await sheetsApi.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties(sheetId,title,gridProperties.rowCount)",
  });
  const normalized = sheetTitle.trim().toLowerCase();
  const targetSheet = meta.data.sheets?.find(
    (s) => (s.properties?.title ?? "").trim().toLowerCase() === normalized,
  );
  const sheetId = targetSheet?.properties?.sheetId;
  const rowCount = targetSheet?.properties?.gridProperties?.rowCount ?? 0;
  if (sheetId == null || rowCount >= requiredRow) return;

  await sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          appendDimension: {
            sheetId,
            dimension: "ROWS",
            length: requiredRow - rowCount,
          },
        },
      ],
    },
  });
}

export async function punchIn(
  spreadsheetId: string,
  date: Date = new Date(),
  options?: { workMode?: string },
): Promise<AttendanceRow> {
  const targetSpreadsheetId = await resolveSpreadsheetForDate(spreadsheetId, date);
  const sheetTitle = await ensureMonthlySheet(targetSpreadsheetId, date);
  const rows = await readMonthlyRows(targetSpreadsheetId, sheetTitle);
  const today = formatIsoDate(date);
  const found = findTodayRow(rows, today);

  if (found?.row[ATTENDANCE_COL.punchIn]?.trim()) {
    throw new Error("Already punched in today");
  }

  const now = formatClockTime(date);
  const rowValues = buildRowValues(found?.row, date);
  rowValues[ATTENDANCE_COL.workMode] =
    options?.workMode?.trim() || rowValues[ATTENDANCE_COL.workMode] || WORK_MODE.FULL_DAY_ONSITE;
  rowValues[ATTENDANCE_COL.punchIn] = now;
  rowValues[ATTENDANCE_COL.overtime] = "—";
  rowValues[ATTENDANCE_COL.status] = WORKING_STATUS.IN_PROGRESS;
  rowValues[ATTENDANCE_COL.breakStart] = "";
  rowValues[ATTENDANCE_COL.breakEnd] = "";
  rowValues[ATTENDANCE_COL.totalBreakTime] = "";

  const targetRow = found?.sheetRow ?? Math.max(rows.length + 1, 2);
  await updateAttendanceRow(targetSpreadsheetId, sheetTitle, targetRow, rowValues);

  return rowFromValues(rowValues, targetRow);
}

export async function punchOut(
  spreadsheetId: string,
  date: Date = new Date(),
  options?: { earlyLeaveReason?: string; dailyUpdate?: string },
): Promise<AttendanceRow> {
  const targetSpreadsheetId = await resolveSpreadsheetForDate(spreadsheetId, date);
  const sheetTitle = await ensureMonthlySheet(targetSpreadsheetId, date);
  const rows = await readMonthlyRows(targetSpreadsheetId, sheetTitle);
  const today = formatIsoDate(date);
  const found = findTodayRow(rows, today);

  if (!found?.row[ATTENDANCE_COL.punchIn]?.trim()) {
    throw new Error("Punch in first before punching out");
  }
  if (found.row[ATTENDANCE_COL.punchOut]?.trim()) {
    throw new Error("Already punched out today");
  }
  if (found.row[ATTENDANCE_COL.breakStart]?.trim() && !found.row[ATTENDANCE_COL.breakEnd]?.trim()) {
    throw new Error("End your break before punching out");
  }

  const rowValues = [...found.row];
  while (rowValues.length < ATTENDANCE_HEADERS.length) rowValues.push("");

  rowValues[ATTENDANCE_COL.punchOut] = formatClockTime(date);
  applyAttendanceMetrics(rowValues, date);

  const status = rowValues[ATTENDANCE_COL.status] ?? "";
  if (status === WORKING_STATUS.SHORT) {
    const reason = options?.earlyLeaveReason?.trim() ?? "";
    if (!reason) {
      throw new Error("Please provide a reason for leaving early");
    }
    if (reason.length < EARLY_LEAVE_REASON_MIN_LENGTH) {
      throw new Error(
        `Early leave reason must be at least ${EARLY_LEAVE_REASON_MIN_LENGTH} characters`,
      );
    }
    rowValues[ATTENDANCE_COL.earlyLeaveReason] = reason;
  } else {
    rowValues[ATTENDANCE_COL.earlyLeaveReason] = "";
  }
  rowValues[ATTENDANCE_COL.dailyUpdate] = options?.dailyUpdate?.trim() ?? "";

  await updateAttendanceRow(targetSpreadsheetId, sheetTitle, found.sheetRow, rowValues);

  return rowFromValues(rowValues, found.sheetRow);
}

/** End-of-day clock used when a session is left open past midnight (same calendar day). */
export const AUTO_PUNCH_OUT_CLOCK = formatWallClockTime(23, 59);

const AUTO_PUNCH_OUT_NOTE =
  "Auto punch-out at midnight (forgot to punch out). Contact HR or Super Admin to correct punch-out time.";

/**
 * Close an open punch session for a past date (punch in set, punch out empty).
 * Uses 11:59 pm on that calendar day so working-hours math stays valid for same-day punches.
 * Returns null when there is nothing to close.
 */
export async function autoPunchOutOpenSession(
  spreadsheetId: string,
  dateIso: string,
): Promise<AttendanceRow | null> {
  const normalizedDate = normalizeSheetDate(dateIso);
  if (!normalizedDate) {
    throw new Error("Invalid attendance date for auto punch-out");
  }

  const baseDate = new Date(`${normalizedDate}T12:00:00`);
  const targetSpreadsheetId = await resolveSpreadsheetForDate(spreadsheetId, baseDate);
  const sheetTitle = await ensureMonthlySheet(targetSpreadsheetId, baseDate);
  const rows = await readMonthlyRows(targetSpreadsheetId, sheetTitle);
  const found = findTodayRow(rows, normalizedDate);

  if (!found?.row[ATTENDANCE_COL.punchIn]?.trim()) return null;
  if (found.row[ATTENDANCE_COL.punchOut]?.trim()) return null;

  const rowValues = [...found.row];
  while (rowValues.length < ATTENDANCE_HEADERS.length) rowValues.push("");

  // Close an open break before auto punch-out so metrics stay consistent.
  if (rowValues[ATTENDANCE_COL.breakStart]?.trim() && !rowValues[ATTENDANCE_COL.breakEnd]?.trim()) {
    const breakEnd = AUTO_PUNCH_OUT_CLOCK;
    rowValues[ATTENDANCE_COL.breakEnd] = breakEnd;
    const breakStartMs = parseTimeOnDate(rowValues[ATTENDANCE_COL.breakStart], baseDate);
    const breakEndMs = parseTimeOnDate(breakEnd, baseDate);
    const breakMs =
      breakStartMs != null && breakEndMs != null && breakEndMs > breakStartMs
        ? breakEndMs - breakStartMs
        : 0;
    const existingBreakMs = parseDurationToMs(rowValues[ATTENDANCE_COL.totalBreakTime] ?? "");
    rowValues[ATTENDANCE_COL.totalBreakTime] = formatDuration(existingBreakMs + breakMs);
  }

  rowValues[ATTENDANCE_COL.punchOut] = AUTO_PUNCH_OUT_CLOCK;
  applyAttendanceMetrics(rowValues, baseDate);

  if ((rowValues[ATTENDANCE_COL.status] ?? "") === WORKING_STATUS.SHORT) {
    if (!(rowValues[ATTENDANCE_COL.earlyLeaveReason] ?? "").trim()) {
      rowValues[ATTENDANCE_COL.earlyLeaveReason] = AUTO_PUNCH_OUT_NOTE;
    }
  }

  const existingUpdate = (rowValues[ATTENDANCE_COL.dailyUpdate] ?? "").trim();
  if (!existingUpdate) {
    rowValues[ATTENDANCE_COL.dailyUpdate] = AUTO_PUNCH_OUT_NOTE;
  } else if (!existingUpdate.toLowerCase().includes("auto punch-out")) {
    rowValues[ATTENDANCE_COL.dailyUpdate] = `${existingUpdate}\n${AUTO_PUNCH_OUT_NOTE}`;
  }

  await updateAttendanceRow(targetSpreadsheetId, sheetTitle, found.sheetRow, rowValues);
  return rowFromValues(rowValues, found.sheetRow);
}

export async function startBreak(
  spreadsheetId: string,
  date: Date = new Date(),
): Promise<AttendanceRow> {
  const targetSpreadsheetId = await resolveSpreadsheetForDate(spreadsheetId, date);
  const sheetTitle = await ensureMonthlySheet(targetSpreadsheetId, date);
  const rows = await readMonthlyRows(targetSpreadsheetId, sheetTitle);
  const today = formatIsoDate(date);
  const found = findTodayRow(rows, today);

  if (!found?.row[ATTENDANCE_COL.punchIn]?.trim()) {
    throw new Error("Punch in first before starting a break");
  }
  if (found.row[ATTENDANCE_COL.punchOut]?.trim()) {
    throw new Error("Cannot start a break after punch out");
  }
  if (isHalfDayUnpaidWorkMode(found.row[ATTENDANCE_COL.workMode])) {
    throw new Error("Break is not allowed for Half Day Unpaid Leave");
  }
  if (found.row[ATTENDANCE_COL.breakStart]?.trim() && !found.row[ATTENDANCE_COL.breakEnd]?.trim()) {
    throw new Error("Already on break");
  }

  const rowValues = [...found.row];
  while (rowValues.length < ATTENDANCE_HEADERS.length) rowValues.push("");

  rowValues[ATTENDANCE_COL.breakStart] = formatClockTime(date);
  rowValues[ATTENDANCE_COL.breakEnd] = "";

  await updateAttendanceRow(targetSpreadsheetId, sheetTitle, found.sheetRow, rowValues);

  return rowFromValues(rowValues, found.sheetRow);
}

export async function endBreak(
  spreadsheetId: string,
  date: Date = new Date(),
): Promise<AttendanceRow> {
  const targetSpreadsheetId = await resolveSpreadsheetForDate(spreadsheetId, date);
  const sheetTitle = await ensureMonthlySheet(targetSpreadsheetId, date);
  const rows = await readMonthlyRows(targetSpreadsheetId, sheetTitle);
  const today = formatIsoDate(date);
  const found = findTodayRow(rows, today);

  if (!found?.row[ATTENDANCE_COL.breakStart]?.trim()) {
    throw new Error("No active break to end");
  }
  if (found.row[ATTENDANCE_COL.breakEnd]?.trim()) {
    throw new Error("No active break to end");
  }

  const rowValues = [...found.row];
  while (rowValues.length < ATTENDANCE_HEADERS.length) rowValues.push("");

  const breakEnd = formatClockTime(date);
  rowValues[ATTENDANCE_COL.breakEnd] = breakEnd;

  const breakStartMs = parseTimeOnDate(rowValues[ATTENDANCE_COL.breakStart], date);
  const breakEndMs = parseTimeOnDate(breakEnd, date);
  const breakMs =
    breakStartMs != null && breakEndMs != null && breakEndMs > breakStartMs
      ? breakEndMs - breakStartMs
      : 0;

  const existingBreakMs = parseDurationToMs(rowValues[ATTENDANCE_COL.totalBreakTime] ?? "");
  rowValues[ATTENDANCE_COL.totalBreakTime] = formatDuration(existingBreakMs + breakMs);

  await updateAttendanceRow(targetSpreadsheetId, sheetTitle, found.sheetRow, rowValues);

  return rowFromValues(rowValues, found.sheetRow);
}

export async function getMonthAttendance(
  spreadsheetId: string,
  year: number,
  monthIndex: number,
): Promise<AttendanceRow[]> {
  const date = new Date(year, monthIndex, 1);
  const sheetTitle = monthlySheetTitle(date);

  // Never create year workbooks while reading — that previously pointed payroll at an
  // empty new file while punches still lived on the employee's base attendance sheet.
  const yearSpreadsheetId = await resolveYearSpreadsheetId(spreadsheetId, year, {
    createIfMissing: false,
  });

  const tried = new Set<string>();
  const candidateIds =
    yearSpreadsheetId === spreadsheetId ? [yearSpreadsheetId] : [yearSpreadsheetId, spreadsheetId];

  const readCandidate = async (candidateId: string): Promise<AttendanceRow[]> => {
    if (tried.has(candidateId)) return [];
    tried.add(candidateId);
    const sheetId = await getSheetId(candidateId, sheetTitle);
    if (sheetId == null) return [];

    const rows = await readMonthlyRows(candidateId, sheetTitle);
    const records: AttendanceRow[] = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i] ?? [];
      if (!String(row[ATTENDANCE_COL.date] ?? "").trim()) continue;
      records.push(rowFromValues(row, i + 1));
    }
    return records;
  };

  for (const candidateId of candidateIds) {
    const records = await readCandidate(candidateId);
    if (records.length > 0) return records;
  }

  // Empty year workbook / wrong stored ID: scan sibling attendance files in the folder.
  try {
    for (const siblingId of await listYearlySpreadsheetIds(spreadsheetId)) {
      const records = await readCandidate(siblingId);
      if (records.length > 0) return records;
    }
  } catch (error) {
    console.error("getMonthAttendance: sibling workbook scan failed", error);
  }

  return [];
}

/**
 * Write / update the monthly attendance row when leave is accepted so payroll
 * and attendance views see the correct work mode (e.g. Half Day Unpaid Leave).
 */
export async function upsertApprovedLeaveAttendance(params: {
  spreadsheetId: string;
  dateIso: string;
  workMode: string;
}): Promise<void> {
  const dateIso = normalizeSheetDate(params.dateIso);
  if (!dateIso) {
    throw new Error("Invalid leave date for attendance sync");
  }

  const baseDate = new Date(`${dateIso}T12:00:00`);
  const targetSpreadsheetId = await resolveSpreadsheetForDate(params.spreadsheetId, baseDate);
  const sheetTitle = await ensureMonthlySheet(targetSpreadsheetId, baseDate);
  const rows = await readMonthlyRows(targetSpreadsheetId, sheetTitle);
  const found = findTodayRow(rows, dateIso);
  const targetRow = found?.sheetRow ?? Math.max(rows.length + 1, 2);
  const rowValues = buildRowValues(found?.row, baseDate);

  rowValues[ATTENDANCE_COL.date] = formatSheetDateLiteral(baseDate);
  rowValues[ATTENDANCE_COL.workMode] = params.workMode;
  rowValues[ATTENDANCE_COL.status] = WORKING_STATUS.ON_LEAVE;

  const isHalfDay =
    params.workMode === WORK_MODE.HALF_DAY_UNPAID_LEAVE ||
    params.workMode === WORK_MODE.HALF_DAY_PAID_LEAVE ||
    params.workMode === WORK_MODE.WFH_HALF_DAY ||
    isHalfDayUnpaidWorkMode(params.workMode);

  // Full-day leave should not keep punch metrics; half-day may keep existing punches.
  if (!isHalfDay) {
    rowValues[ATTENDANCE_COL.punchIn] = "";
    rowValues[ATTENDANCE_COL.punchOut] = "";
    rowValues[ATTENDANCE_COL.breakStart] = "";
    rowValues[ATTENDANCE_COL.breakEnd] = "";
    rowValues[ATTENDANCE_COL.totalBreakTime] = "";
    rowValues[ATTENDANCE_COL.workingHours] = "";
    rowValues[ATTENDANCE_COL.overtime] = "";
    rowValues[ATTENDANCE_COL.earlyLeaveReason] = "";
  } else if (!(rowValues[ATTENDANCE_COL.punchIn] ?? "").trim()) {
    rowValues[ATTENDANCE_COL.workingHours] = "";
    rowValues[ATTENDANCE_COL.overtime] = "";
  }

  await ensureSheetHasRows(targetSpreadsheetId, sheetTitle, targetRow);
  await updateAttendanceRow(targetSpreadsheetId, sheetTitle, targetRow, rowValues);
}

/** HR manual create/update of punch and break times for a specific date. */
export async function upsertManualAttendanceRecord(params: {
  spreadsheetId: string;
  dateIso: string;
  punchIn?: string;
  punchOut?: string;
  breakStart?: string;
  breakEnd?: string;
  totalBreakTime?: string;
  workMode?: string;
}): Promise<AttendanceRow> {
  const dateIso = normalizeSheetDate(params.dateIso);
  if (!dateIso) {
    throw new Error("Invalid attendance date");
  }

  const baseDate = new Date(`${dateIso}T12:00:00`);
  const targetSpreadsheetId = await resolveSpreadsheetForDate(params.spreadsheetId, baseDate);
  const sheetTitle = await ensureMonthlySheet(targetSpreadsheetId, baseDate);
  const rows = await readMonthlyRows(targetSpreadsheetId, sheetTitle);
  const found = findTodayRow(rows, dateIso);
  const targetRow = found?.sheetRow ?? Math.max(rows.length + 1, 2);
  const rowValues = buildRowValues(found?.row, baseDate);

  rowValues[ATTENDANCE_COL.date] = formatSheetDateLiteral(baseDate);

  const workMode = canonicalizeWorkMode(
    params.workMode?.trim() || rowValues[ATTENDANCE_COL.workMode] || WORK_MODE.FULL_DAY_ONSITE,
  );
  rowValues[ATTENDANCE_COL.workMode] = workMode;

  const punchOptional = isPunchOptionalWorkMode(workMode);

  if (punchOptional && !params.punchIn?.trim() && !params.punchOut?.trim()) {
    // Full-day leave / holiday: clear punch metrics and mark as on leave.
    rowValues[ATTENDANCE_COL.punchIn] = "";
    rowValues[ATTENDANCE_COL.punchOut] = "";
    rowValues[ATTENDANCE_COL.breakStart] = "";
    rowValues[ATTENDANCE_COL.breakEnd] = "";
    rowValues[ATTENDANCE_COL.totalBreakTime] = "";
    rowValues[ATTENDANCE_COL.workingHours] = "";
    rowValues[ATTENDANCE_COL.overtime] = "—";
    rowValues[ATTENDANCE_COL.earlyLeaveReason] = "";
    rowValues[ATTENDANCE_COL.status] = WORKING_STATUS.ON_LEAVE;
  } else {
    if (params.punchIn !== undefined) {
      rowValues[ATTENDANCE_COL.punchIn] = params.punchIn;
    }
    if (params.punchOut !== undefined) {
      rowValues[ATTENDANCE_COL.punchOut] = params.punchOut;
    }

    // Keep break start/end on the row so HR can edit them later.
    if (
      params.breakStart !== undefined ||
      params.breakEnd !== undefined ||
      params.totalBreakTime !== undefined
    ) {
      rowValues[ATTENDANCE_COL.breakStart] = params.breakStart ?? "";
      rowValues[ATTENDANCE_COL.breakEnd] = params.breakEnd ?? "";
      rowValues[ATTENDANCE_COL.totalBreakTime] = params.totalBreakTime ?? "";
    }

    const punchedOut = Boolean((rowValues[ATTENDANCE_COL.punchOut] ?? "").trim());
    if (punchedOut) {
      applyAttendanceMetrics(rowValues, baseDate);
    } else if ((rowValues[ATTENDANCE_COL.punchIn] ?? "").trim()) {
      rowValues[ATTENDANCE_COL.status] = WORKING_STATUS.IN_PROGRESS;
      rowValues[ATTENDANCE_COL.overtime] = "—";
      rowValues[ATTENDANCE_COL.workingHours] = "";
    }
  }

  await ensureSheetHasRows(targetSpreadsheetId, sheetTitle, targetRow);
  await updateAttendanceRow(targetSpreadsheetId, sheetTitle, targetRow, rowValues);

  return rowFromValues(rowValues, targetRow);
}

/**
 * Sync attendance day from Firebase to the employee's monthly Sheets.
 * This is meant for idempotent "backup" runs after the day ends.
 */
export async function upsertAttendanceDayFromFirestoreRow(params: {
  spreadsheetId: string;
  dateIso: string;
  row: AttendanceRow;
}): Promise<AttendanceRow> {
  const dateIso = normalizeSheetDate(params.dateIso);
  if (!dateIso) {
    throw new Error("Invalid attendance date");
  }

  const baseDate = new Date(`${dateIso}T12:00:00`);
  const targetSpreadsheetId = await resolveSpreadsheetForDate(params.spreadsheetId, baseDate);
  const sheetTitle = await ensureMonthlySheet(targetSpreadsheetId, baseDate);
  const rows = await withQuotaRetry(() => readMonthlyRows(targetSpreadsheetId, sheetTitle));
  const found = findTodayRow(rows, dateIso);
  const targetRow = found?.sheetRow ?? Math.max(rows.length + 1, 2);

  const rowValues = buildRowValues(found?.row, baseDate);
  rowValues[ATTENDANCE_COL.date] = formatSheetDateLiteral(baseDate);

  const workMode = canonicalizeWorkMode(
    params.row.workMode?.trim() || rowValues[ATTENDANCE_COL.workMode] || WORK_MODE.FULL_DAY_ONSITE,
  );
  rowValues[ATTENDANCE_COL.workMode] = workMode;

  rowValues[ATTENDANCE_COL.punchIn] = params.row.punchIn ?? "";
  rowValues[ATTENDANCE_COL.punchOut] = params.row.punchOut ?? "";
  rowValues[ATTENDANCE_COL.breakStart] = params.row.breakStart ?? "";
  rowValues[ATTENDANCE_COL.breakEnd] = params.row.breakEnd ?? "";
  rowValues[ATTENDANCE_COL.totalBreakTime] = params.row.totalBreakTime ?? "";
  rowValues[ATTENDANCE_COL.workingHours] = params.row.workingHours ?? "";

  // Keep these columns exactly as stored in Firebase so HR backups
  // match the daily computed values.
  rowValues[ATTENDANCE_COL.overtime] = params.row.overtime ?? "—";
  rowValues[ATTENDANCE_COL.status] = params.row.status ?? WORKING_STATUS.IN_PROGRESS;
  rowValues[ATTENDANCE_COL.earlyLeaveReason] = params.row.earlyLeaveReason ?? "";
  rowValues[ATTENDANCE_COL.dailyUpdate] = params.row.dailyUpdate ?? "";
  rowValues[ATTENDANCE_COL.isOvertimeApproved] =
    params.row.isOvertimeApproved ?? OVERTIME_APPROVAL.NOT_CONSIDERED;

  await ensureSheetHasRows(targetSpreadsheetId, sheetTitle, targetRow);
  await withQuotaRetry(() =>
    updateAttendanceRow(targetSpreadsheetId, sheetTitle, targetRow, rowValues),
  );

  return rowFromValues(rowValues, targetRow);
}

export async function updateAttendanceField(
  spreadsheetId: string,
  dateIso: string,
  field: keyof typeof ATTENDANCE_COL,
  value: string,
): Promise<AttendanceRow> {
  const [year, month] = dateIso.split("-").map((p) => parseInt(p, 10));
  const date = new Date(year, (month || 1) - 1, 1);
  const targetSpreadsheetId = await resolveSpreadsheetForDate(spreadsheetId, date);
  const sheetTitle = monthlySheetTitle(date);
  const rows = await readMonthlyRows(targetSpreadsheetId, sheetTitle);
  const found = findTodayRow(rows, dateIso);

  if (!found) {
    throw new Error("Attendance record not found for correction date");
  }

  const rowValues = [...found.row];
  while (rowValues.length < ATTENDANCE_HEADERS.length) rowValues.push("");

  const col = ATTENDANCE_COL[field];
  rowValues[col] = value;

  const baseDate = new Date(`${dateIso}T12:00:00`);
  const overwriteFromClocks = field === "breakStart" || field === "breakEnd";
  rowValues[ATTENDANCE_COL.totalBreakTime] = resolveTotalBreakTimeFromClocks({
    breakStart: rowValues[ATTENDANCE_COL.breakStart] ?? "",
    breakEnd: rowValues[ATTENDANCE_COL.breakEnd] ?? "",
    punchIn: rowValues[ATTENDANCE_COL.punchIn] ?? "",
    existingTotalBreakTime: rowValues[ATTENDANCE_COL.totalBreakTime] ?? "",
    baseDate,
    workMode: rowValues[ATTENDANCE_COL.workMode] ?? "",
    overwriteFromClocks,
  });

  if (rowValues[ATTENDANCE_COL.punchIn] && rowValues[ATTENDANCE_COL.punchOut]) {
    applyAttendanceMetrics(rowValues, baseDate);
  }

  await updateAttendanceRow(targetSpreadsheetId, sheetTitle, found.sheetRow, rowValues);

  return rowFromValues(rowValues, found.sheetRow);
}

export async function updateDailyUpdate(
  spreadsheetId: string,
  dateIso: string,
  dailyUpdate: string,
): Promise<AttendanceRow> {
  return updateAttendanceField(spreadsheetId, dateIso, "dailyUpdate", dailyUpdate.trim());
}

export async function updateOvertimeApproval(
  spreadsheetId: string,
  dateIso: string,
  overtimeApproval: string,
): Promise<AttendanceRow> {
  return updateAttendanceField(
    spreadsheetId,
    dateIso,
    "isOvertimeApproved",
    overtimeApproval.trim(),
  );
}

export async function importAttendanceRecords(
  spreadsheetId: string,
  records: Array<{
    dateIso: string;
    punchIn: string;
    punchOut: string;
    dailyUpdate?: string;
    workMode?: string;
  }>,
): Promise<{ imported: number; updated: number }> {
  const isHolidayMode = (mode: string): boolean => {
    const normalized = mode.trim().toLowerCase();
    return (
      normalized === WORK_MODE.WEEKEND_HOLIDAY.toLowerCase() ||
      normalized === WORK_MODE.PUBLIC_HOLIDAY.toLowerCase()
    );
  };
  const isLeaveMode = (mode: string): boolean => {
    const normalized = canonicalizeWorkMode(mode).toLowerCase();
    return (
      normalized === WORK_MODE.HALF_DAY_PAID_LEAVE.toLowerCase() ||
      normalized === WORK_MODE.HALF_DAY_UNPAID_LEAVE.toLowerCase() ||
      normalized === WORK_MODE.PAID_LEAVE.toLowerCase() ||
      normalized === WORK_MODE.SICK_LEAVE.toLowerCase() ||
      normalized === WORK_MODE.CASUAL_LEAVE.toLowerCase() ||
      normalized === WORK_MODE.UNPAID_LEAVE.toLowerCase()
    );
  };
  let imported = 0;
  let updated = 0;
  if (!records.length) return { imported, updated };

  const grouped = new Map<string, { targetSpreadsheetId: string; records: typeof records }>();
  for (const record of records) {
    const [year, month] = record.dateIso.split("-");
    const yearNum = parseInt(year, 10);
    const targetSpreadsheetId = Number.isFinite(yearNum)
      ? await resolveYearSpreadsheetId(spreadsheetId, yearNum)
      : spreadsheetId;
    const key = `${targetSpreadsheetId}:${year}-${month}`;
    const group = grouped.get(key) ?? { targetSpreadsheetId, records: [] };
    const list = group.records;
    list.push(record);
    grouped.set(key, group);
  }

  const sheetsApi = await getSheetsClient();

  for (const group of grouped.values()) {
    const { targetSpreadsheetId, records: monthRecords } = group;
    const sampleDate = new Date(monthRecords[0].dateIso);
    const sheetTitle = await withQuotaRetry(() =>
      ensureMonthlySheet(targetSpreadsheetId, sampleDate),
    );
    const existingRows = await withQuotaRetry(() =>
      readMonthlyRows(targetSpreadsheetId, sheetTitle),
    );
    const rowIndexByDate = new Map<string, number>();
    for (let i = 1; i < existingRows.length; i++) {
      const dateIso = normalizeSheetDate(existingRows[i]?.[ATTENDANCE_COL.date] ?? "");
      if (dateIso) rowIndexByDate.set(dateIso, i + 1);
    }

    let nextRow = Math.max(existingRows.length + 1, 2);
    const data: Array<{ range: string; values: string[][] }> = [];
    for (const record of monthRecords) {
      const baseDate = new Date(record.dateIso);
      const existingSheetRow = rowIndexByDate.get(record.dateIso);
      const existing = existingSheetRow != null ? existingRows[existingSheetRow - 1] : undefined;
      const rowValues = buildRowValues(existing, baseDate);
      rowValues[ATTENDANCE_COL.workMode] =
        record.workMode?.trim() || rowValues[ATTENDANCE_COL.workMode] || WORK_MODE.FULL_DAY_ONSITE;
      rowValues[ATTENDANCE_COL.punchIn] = record.punchIn;
      rowValues[ATTENDANCE_COL.punchOut] = record.punchOut;
      rowValues[ATTENDANCE_COL.dailyUpdate] = record.dailyUpdate?.trim() ?? "";
      rowValues[ATTENDANCE_COL.breakStart] = "";
      rowValues[ATTENDANCE_COL.breakEnd] = "";
      rowValues[ATTENDANCE_COL.totalBreakTime] = isHalfDayUnpaidWorkMode(
        rowValues[ATTENDANCE_COL.workMode],
      )
        ? ""
        : IMPORT_DEFAULT_BREAK;

      const hasIn = record.punchIn.trim().length > 0;
      const hasOut = record.punchOut.trim().length > 0;
      const normalizedMode = rowValues[ATTENDANCE_COL.workMode] ?? "";
      if (isHolidayMode(normalizedMode)) {
        rowValues[ATTENDANCE_COL.breakStart] = "";
        rowValues[ATTENDANCE_COL.breakEnd] = "";
        rowValues[ATTENDANCE_COL.totalBreakTime] = "";
        rowValues[ATTENDANCE_COL.workingHours] = "";
        rowValues[ATTENDANCE_COL.status] = "";
        rowValues[ATTENDANCE_COL.overtime] = "";
      } else if (isLeaveMode(normalizedMode) && !hasIn && !hasOut) {
        rowValues[ATTENDANCE_COL.breakStart] = "";
        rowValues[ATTENDANCE_COL.breakEnd] = "";
        rowValues[ATTENDANCE_COL.totalBreakTime] = "";
        rowValues[ATTENDANCE_COL.workingHours] = "";
        rowValues[ATTENDANCE_COL.status] = WORKING_STATUS.ON_LEAVE;
        rowValues[ATTENDANCE_COL.overtime] = "";
      } else if (!hasIn && !hasOut) {
        rowValues[ATTENDANCE_COL.breakStart] = "";
        rowValues[ATTENDANCE_COL.breakEnd] = "";
        rowValues[ATTENDANCE_COL.totalBreakTime] = "";
        rowValues[ATTENDANCE_COL.workingHours] = "";
        rowValues[ATTENDANCE_COL.status] = "";
        rowValues[ATTENDANCE_COL.overtime] = "";
      } else if (hasOut) {
        applyAttendanceMetrics(rowValues, baseDate);
      } else {
        rowValues[ATTENDANCE_COL.overtime] = "—";
        rowValues[ATTENDANCE_COL.status] = WORKING_STATUS.IN_PROGRESS;
        rowValues[ATTENDANCE_COL.workingHours] = "";
      }

      const targetRow = existingSheetRow ?? nextRow++;
      data.push({
        range: `'${sheetTitle}'!A${targetRow}:${ATTENDANCE_LAST_COLUMN}${targetRow}`,
        values: [rowValues],
      });

      if (existingSheetRow != null) updated++;
      else imported++;
    }

    const maxTargetRow = data.reduce((max, entry) => {
      const match = entry.range.match(/!A(\d+):/);
      const row = match ? Number.parseInt(match[1], 10) : 0;
      return Math.max(max, row);
    }, 0);
    if (maxTargetRow > 0) {
      await withQuotaRetry(() => ensureSheetHasRows(targetSpreadsheetId, sheetTitle, maxTargetRow));
    }

    await withQuotaRetry(() =>
      sheetsApi.spreadsheets.values.batchUpdate({
        spreadsheetId: targetSpreadsheetId,
        requestBody: {
          valueInputOption: "USER_ENTERED",
          data,
        },
      }),
    );
  }

  for (const targetSpreadsheetId of new Set(grouped.values().map((g) => g.targetSpreadsheetId))) {
    await withQuotaRetry(() => formatAllAttendanceMonthlyHeaders(targetSpreadsheetId));
  }

  return { imported, updated };
}

export async function listAttendanceMonthlySheetsAcrossYears(
  spreadsheetId: string,
): Promise<string[]> {
  const spreadsheetIds = await listYearlySpreadsheetIds(spreadsheetId);
  const unique = new Set<string>();
  for (const targetSpreadsheetId of spreadsheetIds) {
    const titles = await listMonthlySheets(targetSpreadsheetId);
    for (const title of titles) unique.add(title);
  }
  return [...unique];
}

export function computeLiveWorkedMs(record: AttendanceRow, now: Date = new Date()): number {
  if (!record.punchIn.trim()) return 0;

  const baseDate = new Date(record.date);

  if (record.punchOut.trim()) {
    return computeAttendanceMetrics({
      punchIn: record.punchIn,
      punchOut: record.punchOut,
      totalBreakTime: record.totalBreakTime,
      baseDate,
      punchedOut: true,
      workMode: record.workMode,
    }).workingMs;
  }

  const punchInMs = parseSheetClockTime(record.punchIn, baseDate, { role: "in" });
  if (punchInMs == null) return 0;

  const skipBreak = isHalfDayUnpaidWorkMode(record.workMode);
  let totalBreakMs = resolveLiveBreakMs(record.totalBreakTime, record.workMode, {
    inProgress: true,
  });

  if (!skipBreak && record.breakStart.trim() && !record.breakEnd.trim()) {
    const breakStartMs = parseSheetClockTime(record.breakStart, baseDate, {
      punchIn: record.punchIn,
      role: "out",
    });
    if (breakStartMs != null) {
      totalBreakMs += Math.max(0, now.getTime() - breakStartMs);
    }
  }

  return Math.max(0, now.getTime() - punchInMs - totalBreakMs);
}
