import { randomUUID } from "node:crypto";

import { sheets } from "@/lib/google/auth";
import { applySheetHeaderFormatByTitle } from "@/lib/google/sheet-format";
import { headerToFormKey } from "@/lib/employee/form";
import { toPayrollDateOnly } from "@/lib/payroll/employment";

import {
  SALARY_HISTORY_SHEET_NAME,
  SALARY_SLIPS_SHEET_NAME,
  type SalaryHistoryRecord,
  type SalarySlipRecord,
} from "./types";

const spreadsheetId = process.env.GOOGLE_SHEET_ID as string;

const SALARY_HISTORY_HEADERS = [
  "employeeSheetRow",
  "employeeName",
  "effectiveFrom",
  "effectiveTo",
  "basic",
  "loyaltyBonus",
  "professionalTax",
  "status",
  "createdAt",
  "updatedAt",
  "hra",
  "organizationAllowance",
  "lwf",
] as const;

const SALARY_SLIPS_HEADERS = [
  "slipId",
  "employeeSheetRow",
  "employeeName",
  "year",
  "month",
  "title",
  "workingDays",
  "netPayableDays",
  "basic",
  "totalEarnings",
  "loyaltyBonus",
  "professionalTax",
  "totalDeductions",
  "netPay",
  "amountInWords",
  "status",
  "driveFileId",
  "driveFileName",
  "driveParentFolderId",
  "createdAt",
  "releasedAt",
  "deletedAt",
  "overtimeAmount",
  "totalPay",
] as const;

function nowIso(): string {
  return new Date().toISOString();
}

function asNumber(value: string): number {
  const n = Number(
    String(value ?? "")
      .replace(/,/g, "")
      .trim(),
  );
  return Number.isFinite(n) ? n : 0;
}

function normalizeDateOnly(value: string): string {
  return toPayrollDateOnly(value);
}

/** effectiveFrom + 1 year − 1 day (12-month salary window). */
export function defaultSalaryEffectiveTo(effectiveFrom: string): string {
  const from = normalizeDateOnly(effectiveFrom);
  if (!from) return "";
  const [y, m, d] = from.split("-").map(Number);
  const dt = new Date(Date.UTC(y + 1, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - 1);
  return dt.toISOString().slice(0, 10);
}

function historyRowValues(payload: SalaryHistoryRecord): (string | number)[] {
  return [
    payload.employeeSheetRow,
    payload.employeeName,
    payload.effectiveFrom,
    payload.effectiveTo,
    payload.basic,
    payload.loyaltyBonus,
    payload.professionalTax,
    payload.status,
    payload.createdAt,
    payload.updatedAt,
    payload.hra,
    payload.organizationAllowance,
    payload.lwf,
  ];
}

async function getSheetMeta() {
  const response = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties",
  });
  return response.data.sheets ?? [];
}

async function ensureSheetExists(title: string): Promise<void> {
  const all = await getSheetMeta();
  const exists = all.some((s) => s.properties?.title === title);
  if (exists) return;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{ addSheet: { properties: { title } } }],
    },
  });
}

async function ensureHeaders(title: string, headers: readonly string[]): Promise<void> {
  await ensureSheetExists(title);
  const range = `${title}!1:1`;
  const current = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  const headerRow = (current.data.values?.[0] as string[] | undefined) ?? [];
  const same =
    headerRow.length >= headers.length &&
    headers.every((h, i) => String(headerRow[i] ?? "").trim() === h);
  if (same) return;

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${title}!A1`,
    valueInputOption: "RAW",
    requestBody: { values: [[...headers]] },
  });
}

async function ensureHeadersWithFormat(title: string, headers: readonly string[]): Promise<void> {
  await ensureHeaders(title, headers);
  await applySheetHeaderFormatByTitle(spreadsheetId, title, headers.length);
}

function sheetRowRange(title: string, row: number, colCount: number): string {
  const end = columnIndexToLetter(colCount);
  return `${title}!A${row}:${end}${row}`;
}

function columnIndexToLetter(columnCount: number): string {
  let letter = "";
  let n = Math.max(1, columnCount);
  while (n > 0) {
    const rem = (n - 1) % 26;
    letter = String.fromCharCode(65 + rem) + letter;
    n = Math.floor((n - 1) / 26);
  }
  return letter;
}

async function readRows(title: string): Promise<string[][]> {
  await ensureSheetExists(title);
  const data = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: title,
  });
  return (data.data.values as string[][] | undefined) ?? [];
}

function readCell(row: string[], headers: readonly string[], key: string): string {
  const idx = headers.indexOf(key);
  return idx >= 0 ? String(row[idx] ?? "") : "";
}

function looksLikePersonName(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  if (normalizeDateOnly(v)) return false;
  if (/^\d+(\.\d+)?$/.test(v)) return false;
  return /[a-zA-Z]/.test(v);
}

/** True when a history row can be shown as an effective salary period. */
export function isValidSalaryHistoryRecord(record: SalaryHistoryRecord): boolean {
  return (
    Number.isInteger(record.employeeSheetRow) &&
    record.employeeSheetRow >= 2 &&
    Boolean(record.effectiveFrom) &&
    Number(record.basic) > 0
  );
}

function parseSalaryHistoryRow(row: string[], sheetRow: number): SalaryHistoryRecord | null {
  const employeeSheetRow = asNumber(readCell(row, SALARY_HISTORY_HEADERS, "employeeSheetRow"));
  let employeeName = readCell(row, SALARY_HISTORY_HEADERS, "employeeName").trim();
  let effectiveFrom = normalizeDateOnly(readCell(row, SALARY_HISTORY_HEADERS, "effectiveFrom"));
  let effectiveTo = normalizeDateOnly(readCell(row, SALARY_HISTORY_HEADERS, "effectiveTo"));
  let basic = asNumber(readCell(row, SALARY_HISTORY_HEADERS, "basic"));
  const hra = asNumber(readCell(row, SALARY_HISTORY_HEADERS, "hra"));
  const organizationAllowance = asNumber(
    readCell(row, SALARY_HISTORY_HEADERS, "organizationAllowance"),
  );
  const lwf = asNumber(readCell(row, SALARY_HISTORY_HEADERS, "lwf"));
  let loyaltyBonus = asNumber(readCell(row, SALARY_HISTORY_HEADERS, "loyaltyBonus"));
  let professionalTax = asNumber(readCell(row, SALARY_HISTORY_HEADERS, "professionalTax"));
  let statusRaw = readCell(row, SALARY_HISTORY_HEADERS, "status");
  const createdAt = readCell(row, SALARY_HISTORY_HEADERS, "createdAt");
  const updatedAt = readCell(row, SALARY_HISTORY_HEADERS, "updatedAt");

  // Recover rows written without employeeName (values shifted left by one).
  const nameAsDate = normalizeDateOnly(employeeName);
  if (nameAsDate && !effectiveFrom) {
    effectiveFrom = nameAsDate;
    effectiveTo = normalizeDateOnly(String(row[2] ?? "")) || effectiveTo;
    basic = asNumber(String(row[3] ?? ""));
    loyaltyBonus = asNumber(String(row[4] ?? ""));
    professionalTax = asNumber(String(row[5] ?? ""));
    statusRaw = String(row[6] ?? statusRaw);
    employeeName = "";
  }

  if (!Number.isInteger(employeeSheetRow) || employeeSheetRow < 2) return null;

  // If "to" landed in an absurd far-future year from bad Date math, recompute from from+1y-1d.
  if (effectiveFrom && effectiveTo) {
    const fromYear = Number(effectiveFrom.slice(0, 4));
    const toYear = Number(effectiveTo.slice(0, 4));
    if (Number.isFinite(fromYear) && Number.isFinite(toYear) && toYear - fromYear > 2) {
      effectiveTo = defaultSalaryEffectiveTo(effectiveFrom);
    }
  }
  if (effectiveFrom && !effectiveTo) {
    effectiveTo = defaultSalaryEffectiveTo(effectiveFrom);
  }

  if (!looksLikePersonName(employeeName)) {
    employeeName = "";
  }

  const status =
    String(statusRaw).trim().toLowerCase() === "inactive"
      ? ("Inactive" as const)
      : ("Active" as const);

  return {
    sheetRow,
    employeeSheetRow,
    employeeName,
    effectiveFrom,
    effectiveTo,
    basic,
    hra,
    organizationAllowance,
    loyaltyBonus,
    professionalTax: professionalTax > 0 ? professionalTax : 200,
    lwf: lwf > 0 ? lwf : 6,
    status,
    createdAt,
    updatedAt,
  };
}

export async function listSalaryHistoryRecords(options?: {
  /** When true (default), omit corrupt rows (no start date / no basic). */
  validOnly?: boolean;
}): Promise<SalaryHistoryRecord[]> {
  await ensureHeadersWithFormat(SALARY_HISTORY_SHEET_NAME, SALARY_HISTORY_HEADERS);
  const rows = await readRows(SALARY_HISTORY_SHEET_NAME);
  if (rows.length <= 1) return [];

  const validOnly = options?.validOnly !== false;
  const parsed = rows
    .slice(1)
    .map((row, i) => parseSalaryHistoryRow(row, i + 2))
    .filter((row): row is SalaryHistoryRecord => Boolean(row));

  return validOnly ? parsed.filter(isValidSalaryHistoryRecord) : parsed;
}

/**
 * Delete Active salary-history rows that are corrupt (blank start / zero basic)
 * so they no longer appear for an employee.
 */
export async function cleanupCorruptSalaryHistoryRecords(): Promise<number> {
  const all = await listSalaryHistoryRecords({ validOnly: false });
  const corrupt = all.filter((row) => row.status === "Active" && !isValidSalaryHistoryRecord(row));
  if (!corrupt.length) return 0;
  await deleteSalaryHistorySheetRows(corrupt.map((row) => row.sheetRow));
  return corrupt.length;
}

export function assertNonOverlappingEffectiveRanges(records: SalaryHistoryRecord[]): void {
  const sorted = [...records]
    .filter((row) => row.status !== "Inactive" && row.effectiveFrom)
    .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));

  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    const prevEnd = prev.effectiveTo || "9999-12-31";
    if (curr.effectiveFrom <= prevEnd) {
      throw new Error(
        `Salary history overlap detected (${prev.effectiveFrom}..${prevEnd}) and ${curr.effectiveFrom}`,
      );
    }
  }
}

async function getSalaryHistorySheetId(): Promise<number> {
  const meta = await getSheetMeta();
  const sheet = meta.find((s) => s.properties?.title === SALARY_HISTORY_SHEET_NAME);
  const sheetId = sheet?.properties?.sheetId;
  if (sheetId == null) {
    throw new Error(`Sheet "${SALARY_HISTORY_SHEET_NAME}" not found`);
  }
  return sheetId;
}

/** Physically remove sheet rows (1-based), highest index first so indices stay valid. */
async function deleteSalaryHistorySheetRows(sheetRows: number[]): Promise<void> {
  const unique = [...new Set(sheetRows.filter((row) => Number.isInteger(row) && row >= 2))].sort(
    (a, b) => b - a,
  );
  if (!unique.length) return;

  const sheetId = await getSalaryHistorySheetId();
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: unique.map((row) => ({
        deleteDimension: {
          range: {
            sheetId,
            dimension: "ROWS",
            startIndex: row - 1,
            endIndex: row,
          },
        },
      })),
    },
  });
}

/**
 * Remove every Active salary-history row for an employee so a new effective
 * salary can be added without overlap.
 */
async function deleteActiveSalaryHistoryForEmployee(
  employeeSheetRow: number,
): Promise<SalaryHistoryRecord[]> {
  const all = await listSalaryHistoryRecords({ validOnly: false });
  const employeeRows = all.filter((r) => r.employeeSheetRow === employeeSheetRow);
  const activeRows = employeeRows.filter((r) => r.status === "Active");
  await deleteSalaryHistorySheetRows(activeRows.map((r) => r.sheetRow));
  return employeeRows.filter((r) => r.status !== "Active" && isValidSalaryHistoryRecord(r));
}

/**
 * Keep the employee roster salary column in sync with the latest salary revision
 * (same source as All Employees via `DAILY_DATA_STORAGE`).
 */
async function syncEmployeeSheetSalary(params: {
  employeeSheetRow: number;
  basic: number;
  effectiveFrom: string;
}): Promise<void> {
  const sheetRow = params.employeeSheetRow;
  if (!Number.isInteger(sheetRow) || sheetRow < 2) return;

  const amount = Number(params.basic);
  const salaryValue =
    Number.isFinite(amount) && amount > 0 ? String(Math.round(amount * 100) / 100) : "";
  if (!salaryValue) {
    throw new Error("Cannot sync employee salary: basic must be greater than 0");
  }

  const { getEmployeeBySheetRow, updateEmployeeRow } = await import("@/lib/employees/repository");
  const { mergeRowWithFormFields, withSheetRowUpdatedAt } = await import("@/lib/employee");

  const record = await getEmployeeBySheetRow(sheetRow);
  if (!record) {
    throw new Error("Employee not found while syncing salary");
  }

  const { headers, row } = record;
  const patch: { salary: string; lastIncrementDate?: string } = { salary: salaryValue };
  if (params.effectiveFrom) {
    patch.lastIncrementDate = params.effectiveFrom;
  }

  const hasSalaryColumn = headers.some((header) => headerToFormKey(header) === "salary");
  if (!hasSalaryColumn) {
    throw new Error(
      'Employees sheet is missing a Salary column (expected header like "salary" or "Salary (monthly)")',
    );
  }

  await updateEmployeeRow(
    sheetRow,
    withSheetRowUpdatedAt(headers, mergeRowWithFormFields(headers, row, patch)),
  );
}

/** Latest Active salary-history row for an employee (by effectiveFrom desc). */
export async function findLatestActiveSalaryForEmployee(
  employeeSheetRow: number,
): Promise<SalaryHistoryRecord | null> {
  const records = await listSalaryHistoryRecords();
  const filtered = records
    .filter((r) => r.employeeSheetRow === employeeSheetRow && r.status === "Active")
    .filter((r) => Boolean(r.effectiveFrom) && r.basic > 0)
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
  return filtered[0] ?? null;
}

/**
 * If the Employees sheet salary cell is blank, fill it from Active salary history
 * (in-memory only — used by employee GET so Edit form shows the current basic).
 */
export function hydrateEmployeeRowSalaryFromHistory(
  headers: string[],
  row: string[],
  history: SalaryHistoryRecord | null,
): string[] {
  if (!history || !(history.basic > 0)) return row;
  const next = [...row];
  while (next.length < headers.length) next.push("");

  let wrote = false;
  headers.forEach((header, index) => {
    if (headerToFormKey(header) !== "salary") return;
    const current = String(next[index] ?? "")
      .replace(/,/g, "")
      .trim();
    if (current && Number(current) > 0) return;
    next[index] = String(history.basic);
    wrote = true;
  });
  return wrote ? next : next;
}

export async function createSalaryHistoryRecord(input: {
  employeeSheetRow: number;
  employeeName: string;
  effectiveFrom: string;
  effectiveTo?: string;
  basic: number;
  hra?: number;
  organizationAllowance?: number;
  lwf?: number;
  loyaltyBonus: number;
  professionalTax: number;
  status?: "Active" | "Inactive";
}) {
  await ensureHeaders(SALARY_HISTORY_SHEET_NAME, SALARY_HISTORY_HEADERS);

  const effectiveFrom = normalizeDateOnly(input.effectiveFrom);
  if (!effectiveFrom) {
    throw new Error("effectiveFrom is required (YYYY-MM-DD)");
  }

  const basicAmount = Number(input.basic);
  if (!Number.isFinite(basicAmount) || basicAmount <= 0) {
    throw new Error("Basic salary must be greater than 0");
  }

  const effectiveTo =
    normalizeDateOnly(input.effectiveTo ?? "") || defaultSalaryEffectiveTo(effectiveFrom);

  // Delete the employee's current effective salary row(s), then insert the new one.
  const remainingRows = await deleteActiveSalaryHistoryForEmployee(input.employeeSheetRow);

  const payload: SalaryHistoryRecord = {
    sheetRow: 0,
    employeeSheetRow: input.employeeSheetRow,
    employeeName: input.employeeName,
    effectiveFrom,
    effectiveTo,
    basic: Math.round(basicAmount * 100) / 100,
    hra: Math.round(Math.max(0, Number(input.hra) || 0) * 100) / 100,
    organizationAllowance:
      Math.round(Math.max(0, Number(input.organizationAllowance) || 0) * 100) / 100,
    lwf: Number(input.lwf) > 0 ? Math.round(Number(input.lwf) * 100) / 100 : 6,
    loyaltyBonus: Math.min(20, Math.max(0, Number(input.loyaltyBonus) || 0)),
    professionalTax: Number(input.professionalTax) > 0 ? Number(input.professionalTax) : 200,
    status: input.status ?? "Active",
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };

  assertNonOverlappingEffectiveRanges([...remainingRows, payload]);

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: SALARY_HISTORY_SHEET_NAME,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [historyRowValues(payload)],
    },
  });

  // Mirror basic salary onto the Employees sheet for HR / Super Admin views.
  if (payload.status === "Active") {
    await syncEmployeeSheetSalary({
      employeeSheetRow: payload.employeeSheetRow,
      basic: payload.basic,
      effectiveFrom: payload.effectiveFrom,
    });
  }
}

export async function findEffectiveSalaryForPeriod(args: {
  employeeSheetRow: number;
  periodStart: string;
  periodEnd: string;
}): Promise<SalaryHistoryRecord | null> {
  const records = await listSalaryHistoryRecords();
  const filtered = records
    .filter((r) => r.employeeSheetRow === args.employeeSheetRow && r.status === "Active")
    .filter((r) => Boolean(r.effectiveFrom))
    .filter((r) => r.effectiveFrom <= args.periodEnd)
    .filter((r) => !r.effectiveTo || r.effectiveTo >= args.periodStart)
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
  return filtered[0] ?? null;
}

/**
 * Find effective salary from a preloaded list of records to avoid extra
 * Sheets API calls when resolving multiple employees in a loop.
 */
export function findEffectiveSalaryForPeriodFromRecords(
  records: SalaryHistoryRecord[],
  args: { employeeSheetRow: number; periodStart: string; periodEnd: string },
): SalaryHistoryRecord | null {
  const filtered = records
    .filter((r) => r.employeeSheetRow === args.employeeSheetRow && r.status === "Active")
    .filter((r) => Boolean(r.effectiveFrom))
    .filter((r) => r.effectiveFrom <= args.periodEnd)
    .filter((r) => !r.effectiveTo || r.effectiveTo >= args.periodStart)
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
  return filtered[0] ?? null;
}

function normalizeSalarySlipRow(row: string[]): string[] {
  const normalized = [...row];

  while (normalized.length < SALARY_SLIPS_HEADERS.length) {
    normalized.push("");
  }

  return normalized;
}

export async function listSalarySlips(): Promise<SalarySlipRecord[]> {
  await ensureHeadersWithFormat(SALARY_SLIPS_SHEET_NAME, SALARY_SLIPS_HEADERS);
  const rows = await readRows(SALARY_SLIPS_SHEET_NAME);
  if (rows.length <= 1) return [];

  return rows.slice(1).map((row, i) => {
    const normalizedRow = normalizeSalarySlipRow(row);
    return {
      sheetRow: i + 2,
      slipId: readCell(normalizedRow, SALARY_SLIPS_HEADERS, "slipId"),
      employeeSheetRow: asNumber(readCell(normalizedRow, SALARY_SLIPS_HEADERS, "employeeSheetRow")),
      employeeName: readCell(normalizedRow, SALARY_SLIPS_HEADERS, "employeeName"),
      year: asNumber(readCell(normalizedRow, SALARY_SLIPS_HEADERS, "year")),
      month: asNumber(readCell(normalizedRow, SALARY_SLIPS_HEADERS, "month")),
      title: readCell(normalizedRow, SALARY_SLIPS_HEADERS, "title"),
      workingDays: asNumber(readCell(normalizedRow, SALARY_SLIPS_HEADERS, "workingDays")),
      netPayableDays: asNumber(readCell(normalizedRow, SALARY_SLIPS_HEADERS, "netPayableDays")),
      basic: asNumber(readCell(normalizedRow, SALARY_SLIPS_HEADERS, "basic")),
      totalEarnings: asNumber(readCell(normalizedRow, SALARY_SLIPS_HEADERS, "totalEarnings")),
      loyaltyBonus: asNumber(readCell(normalizedRow, SALARY_SLIPS_HEADERS, "loyaltyBonus")),
      professionalTax: asNumber(readCell(normalizedRow, SALARY_SLIPS_HEADERS, "professionalTax")),
      totalDeductions: asNumber(readCell(normalizedRow, SALARY_SLIPS_HEADERS, "totalDeductions")),
      netPay: asNumber(readCell(normalizedRow, SALARY_SLIPS_HEADERS, "netPay")),
      overtimeAmount: asNumber(readCell(normalizedRow, SALARY_SLIPS_HEADERS, "overtimeAmount")),
      totalPay: asNumber(readCell(normalizedRow, SALARY_SLIPS_HEADERS, "totalPay")),
      amountInWords: readCell(normalizedRow, SALARY_SLIPS_HEADERS, "amountInWords"),
      status:
        (readCell(normalizedRow, SALARY_SLIPS_HEADERS, "status") as SalarySlipRecord["status"]) ||
        "Draft",
      driveFileId: readCell(normalizedRow, SALARY_SLIPS_HEADERS, "driveFileId"),
      driveFileName: readCell(normalizedRow, SALARY_SLIPS_HEADERS, "driveFileName"),
      driveParentFolderId: readCell(normalizedRow, SALARY_SLIPS_HEADERS, "driveParentFolderId"),
      createdAt: readCell(normalizedRow, SALARY_SLIPS_HEADERS, "createdAt"),
      releasedAt: readCell(normalizedRow, SALARY_SLIPS_HEADERS, "releasedAt"),
      deletedAt: readCell(normalizedRow, SALARY_SLIPS_HEADERS, "deletedAt"),
    };
  });
}

export async function saveSalarySlipRecord(
  row: Omit<SalarySlipRecord, "sheetRow" | "slipId" | "createdAt"> & {
    slipId?: string;
    createdAt?: string;
  },
): Promise<string> {
  await ensureHeadersWithFormat(SALARY_SLIPS_SHEET_NAME, SALARY_SLIPS_HEADERS);
  const slipId = row.slipId?.trim() || randomUUID();
  const createdAt = row.createdAt?.trim() || nowIso();
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: SALARY_SLIPS_SHEET_NAME,
    valueInputOption: "RAW",
    requestBody: {
      values: [
        [
          slipId,
          row.employeeSheetRow,
          row.employeeName ?? "",
          row.year,
          String(row.month),
          row.title,
          row.workingDays,
          row.netPayableDays,
          row.basic,
          row.totalEarnings,
          row.loyaltyBonus,
          row.professionalTax,
          row.totalDeductions,
          row.netPay,
          row.amountInWords,
          row.status,
          row.driveFileId,
          row.driveFileName,
          row.driveParentFolderId,
          createdAt,
          row.releasedAt ?? "",
          row.deletedAt ?? "",
          row.overtimeAmount ?? 0,
          row.totalPay ?? row.netPay,
        ],
      ],
    },
  });
  return slipId;
}

export async function updateSalarySlipRecord(
  sheetRow: number,
  patch: Partial<Pick<SalarySlipRecord, "status" | "deletedAt" | "driveFileId" | "driveFileName">>,
): Promise<void> {
  const records = await listSalarySlips();
  const current = records.find((r) => r.sheetRow === sheetRow);
  if (!current) throw new Error("Salary slip not found");
  const merged = { ...current, ...patch };
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: sheetRowRange(SALARY_SLIPS_SHEET_NAME, sheetRow, SALARY_SLIPS_HEADERS.length),
    valueInputOption: "RAW",
    requestBody: {
      values: [
        [
          merged.slipId,
          merged.employeeSheetRow,
          merged.employeeName ?? "",
          merged.year,
          String(merged.month),
          merged.title,
          merged.workingDays,
          merged.netPayableDays,
          merged.basic,
          merged.totalEarnings,
          merged.loyaltyBonus,
          merged.professionalTax,
          merged.totalDeductions,
          merged.netPay,
          merged.amountInWords,
          merged.status,
          merged.driveFileId,
          merged.driveFileName,
          merged.driveParentFolderId,
          merged.createdAt,
          merged.releasedAt ?? "",
          merged.deletedAt ?? "",
          merged.overtimeAmount ?? 0,
          merged.totalPay ?? merged.netPay,
        ],
      ],
    },
  });
}
