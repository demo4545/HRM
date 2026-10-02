import { ROLES, STATUS } from "@/app/consts/common";
import { isEmployeeStatusActive } from "./form";
import { getSheetHeaders } from "./headers";
import { EMPLOYEE_SEARCH_KEYS } from "./search";
import { headerToKey, type SortOrder } from "./sort";
import { DEFAULT_PAGE_SIZE } from "./pagination";
import type { SheetPagination } from "@/types/sheet";

export type IndexedSheetRow = {
  sheetRow: number;
  values: string[];
};

export function indexSheetBody(
  data: string[][],
  sheetRowNumbers?: number[],
): {
  headers: string[];
  rows: IndexedSheetRow[];
} {
  if (!data.length) return { headers: [], rows: [] };

  const headers = getSheetHeaders(data);
  const body = data.slice(1);

  return {
    headers,
    rows: body.map((values, index) => ({
      sheetRow: sheetRowNumbers?.[index] ?? index + 2,
      values,
    })),
  };
}

export function indexedRowsToSheetData(headers: string[], rows: IndexedSheetRow[]): string[][] {
  return [headers, ...rows.map((r) => r.values)];
}

function compareCellValues(aVal: string, bVal: string, order: SortOrder): number {
  const aTime = Date.parse(aVal);
  const bTime = Date.parse(bVal);
  if (!Number.isNaN(aTime) && !Number.isNaN(bTime)) {
    return order === "desc" ? bTime - aTime : aTime - bTime;
  }

  const cmp = aVal.localeCompare(bVal, undefined, {
    numeric: true,
    sensitivity: "base",
  });
  return order === "desc" ? -cmp : cmp;
}

function matchesStatus(cellValue: string, filter: string): boolean {
  const cell = cellValue.trim().toLowerCase();
  const target = filter.trim().toLowerCase();

  if (target === STATUS.ACTIVE.toLowerCase()) {
    return cell === "active" || cell === STATUS.ACTIVE.toLowerCase();
  }
  if (target === STATUS.INACTIVE.toLowerCase()) {
    return cell === "inactive" || cell === STATUS.INACTIVE.toLowerCase();
  }

  return cell === target;
}

/** Hide inactive rows for viewers who are not HR / super admin. */
export function filterIndexedRowsActiveOnly(
  headers: string[],
  rows: IndexedSheetRow[],
): IndexedSheetRow[] {
  const statusColIndex = headers.map(headerToKey).indexOf("status");
  if (statusColIndex === -1) return rows;

  return rows.filter((row) => isEmployeeStatusActive(String(row.values[statusColIndex] ?? "")));
}

export function isIndexedRowInactive(headers: string[], row: IndexedSheetRow): boolean {
  const statusColIndex = headers.map(headerToKey).indexOf("status");
  if (statusColIndex === -1) return false;
  return !isEmployeeStatusActive(String(row.values[statusColIndex] ?? ""));
}

function filterIndexedRowsByStatus(
  headers: string[],
  rows: IndexedSheetRow[],
  status: string,
): IndexedSheetRow[] {
  if (!status.trim()) return rows;

  const statusColIndex = headers.map(headerToKey).indexOf("status");
  if (statusColIndex === -1) return rows;

  return rows.filter((row) => matchesStatus(String(row.values[statusColIndex] ?? ""), status));
}

function filterIndexedRows(
  headers: string[],
  rows: IndexedSheetRow[],
  query: string,
): IndexedSheetRow[] {
  if (!query.trim()) return rows;

  const keys = headers.map(headerToKey);
  const searchColIndexes = keys
    .map((key, index) => ((EMPLOYEE_SEARCH_KEYS as readonly string[]).includes(key) ? index : -1))
    .filter((index) => index >= 0);

  if (!searchColIndexes.length) return rows;

  const term = query.trim().toLowerCase();
  return rows.filter((row) =>
    searchColIndexes.some((colIndex) =>
      String(row.values[colIndex] ?? "")
        .toLowerCase()
        .includes(term),
    ),
  );
}

function sortIndexedRows(
  headers: string[],
  rows: IndexedSheetRow[],
  sortBy: string | null | undefined,
  order: SortOrder,
): IndexedSheetRow[] {
  if (!sortBy || !rows.length) return rows;

  const keys = headers.map(headerToKey);
  const sortKey = headerToKey(sortBy);

  let colIndex = keys.indexOf(sortKey);
  if (colIndex === -1) {
    colIndex = headers.findIndex((h) => h.trim().toLowerCase() === sortBy.trim().toLowerCase());
  }
  if (colIndex === -1) return rows;

  return [...rows].sort((a, b) => {
    const aVal = String(a.values[colIndex] ?? "");
    const bVal = String(b.values[colIndex] ?? "");
    return compareCellValues(aVal, bVal, order);
  });
}

/** Hide Super Admin accounts from the All Employees directory. */
export function filterIndexedRowsExcludeSuperAdmin(
  headers: string[],
  rows: IndexedSheetRow[],
): IndexedSheetRow[] {
  const roleColIndex = headers.map(headerToKey).indexOf("role");
  if (roleColIndex === -1) return rows;

  return rows.filter((row) => {
    const role = String(row.values[roleColIndex] ?? "")
      .trim()
      .toLowerCase();
    return role !== ROLES.SUPER_ADMIN;
  });
}

export function processEmployeeSheet(params: {
  data: string[][];
  /** When rows come from Firebase, pass real doc sheetRow ids (aligned with data body). */
  sheetRowNumbers?: number[];
  search?: string;
  status?: string;
  sortBy?: string | null;
  order?: SortOrder;
  page?: number;
  pageSize?: number;
  /** When true, inactive employees are omitted (non–HR / non–super-admin lists). */
  excludeInactive?: boolean;
  /** When true, Super Admin accounts are omitted from the directory list. */
  excludeSuperAdmin?: boolean;
}): {
  data: string[][];
  sheetRows: number[];
  pagination: SheetPagination;
} {
  const {
    data,
    sheetRowNumbers,
    search = "",
    status = "",
    sortBy,
    order = "asc",
    page = 1,
    pageSize = DEFAULT_PAGE_SIZE,
    excludeInactive = false,
    excludeSuperAdmin = false,
  } = params;

  const { headers, rows: indexedRows } = indexSheetBody(data, sheetRowNumbers);
  let rows = indexedRows;
  if (excludeSuperAdmin) {
    rows = filterIndexedRowsExcludeSuperAdmin(headers, rows);
  }
  rows = filterIndexedRows(headers, rows, search);
  if (excludeInactive) {
    rows = filterIndexedRowsActiveOnly(headers, rows);
  }
  rows = filterIndexedRowsByStatus(headers, rows, status);
  rows = sortIndexedRows(headers, rows, sortBy, order);

  const total = rows.length;
  const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
  const safePage = totalPages === 0 ? 1 : Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * pageSize;
  const pageRows = rows.slice(start, start + pageSize);

  return {
    data: indexedRowsToSheetData(headers, pageRows),
    sheetRows: pageRows.map((r) => r.sheetRow),
    pagination: {
      page: safePage,
      pageSize,
      total,
      totalPages,
    },
  };
}
