import { formatIsoDate, parseLegacyImportClockTime } from "@/lib/attendance/time";
import { WORK_MODE, WORK_MODE_OPTIONS } from "@/lib/attendance/constants";

export type LegacyAttendanceCsvRow = {
  dateIso: string;
  punchIn: string;
  punchOut: string;
  dailyUpdate: string;
  workMode: string;
  skipped: boolean;
  skipReason?: string;
};

export type ParseLegacyCsvResult = {
  rows: LegacyAttendanceCsvRow[];
  errors: string[];
  skipped: number;
};

function parseDelimitedRows(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    const next = content[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && (ch === "," || ch === "\t")) {
      row.push(cell.trim());
      cell = "";
      continue;
    }

    if (!inQuotes && (ch === "\n" || ch === "\r")) {
      if (ch === "\r" && next === "\n") i++;
      row.push(cell.trim());
      const hasAnyValue = row.some((c) => c.length > 0);
      if (hasAnyValue) rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += ch;
  }

  row.push(cell.trim());
  if (row.some((c) => c.length > 0)) rows.push(row);

  return rows;
}

function normalizeHeader(value: string): string {
  return value
    .replace(/^\ufeff/, "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ");
}

function normalizeHeaderKey(value: string): string {
  return normalizeHeader(value).replace(/\s+/g, "");
}

function resolveHeaderIndex(headerCells: string[], candidates: string[]): number {
  const normalizedCandidates = candidates.map(normalizeHeader);
  const compactCandidates = normalizedCandidates.map((candidate) => candidate.replace(/\s+/g, ""));

  for (let index = 0; index < headerCells.length; index++) {
    const normalized = normalizeHeader(headerCells[index] ?? "");
    if (!normalized) continue;

    if (normalizedCandidates.includes(normalized)) return index;

    const compact = normalized.replace(/\s+/g, "");
    if (compactCandidates.includes(compact)) return index;

    if (normalizedCandidates.some((candidate) => normalized.includes(candidate))) {
      return index;
    }
    if (compactCandidates.some((candidate) => compact.includes(candidate))) {
      return index;
    }
  }

  return -1;
}

function parseLegacyDate(value: string): Date | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const slash = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) {
    const month = parseInt(slash[1], 10);
    const day = parseInt(slash[2], 10);
    const year = parseInt(slash[3], 10);
    const date = new Date(year, month - 1, day);
    if (!Number.isNaN(date.getTime())) return date;
  }

  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const date = new Date(parseInt(iso[1], 10), parseInt(iso[2], 10) - 1, parseInt(iso[3], 10));
    if (!Number.isNaN(date.getTime())) return date;
  }

  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) return parsed;

  return null;
}

/** @deprecated Use parseLegacyImportClockTime from `@/lib/attendance/time`. */
export const parseLegacyClockTime = parseLegacyImportClockTime;

function isHolidayRow(workMode: string): boolean {
  const mode = workMode.toLowerCase();
  return mode.includes("holiday") || mode.includes("weekend");
}

function normalizeWorkMode(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return WORK_MODE.FULL_DAY_ONSITE;

  const compact = trimmed.toLowerCase().replace(/\s+/g, " ");
  const known = WORK_MODE_OPTIONS.find((mode) => mode.toLowerCase() === compact);
  if (known) return known;

  if (compact.includes("wfh") && compact.includes("hd")) return WORK_MODE.WFH_HALF_DAY;
  if (compact === "wfh") return WORK_MODE.WFH;
  if (
    compact.includes("half day onsite") ||
    (compact.includes("onsite") && (compact.includes("half") || compact.includes("hd")))
  ) {
    return WORK_MODE.HALF_DAY_ONSITE;
  }
  if (compact.includes("half day unpaid") || compact === "half day leave") {
    return WORK_MODE.HALF_DAY_UNPAID_LEAVE;
  }
  if (compact.includes("half day paid")) return WORK_MODE.HALF_DAY_PAID_LEAVE;
  if (compact.includes("half day")) return WORK_MODE.HALF_DAY_UNPAID_LEAVE;
  if (compact.includes("paid leave")) return WORK_MODE.PAID_LEAVE;
  if (compact.includes("sick leave") || compact.includes("seak leave")) return WORK_MODE.SICK_LEAVE;
  if (compact.includes("casual leave")) return WORK_MODE.CASUAL_LEAVE;
  if (compact.includes("unpaid leave")) return WORK_MODE.UNPAID_LEAVE;
  if (compact.includes("onsite")) return WORK_MODE.FULL_DAY_ONSITE;
  if (compact.includes("public holiday")) return WORK_MODE.PUBLIC_HOLIDAY;
  if (compact.includes("weekend holiday")) return WORK_MODE.WEEKEND_HOLIDAY;
  if (compact.includes("full day leave")) return WORK_MODE.UNPAID_LEAVE;
  if (compact === "pl") return WORK_MODE.PAID_LEAVE;
  if (compact === "cl") return WORK_MODE.CASUAL_LEAVE;
  if (compact === "ul") return WORK_MODE.UNPAID_LEAVE;
  if (compact === "sl") return WORK_MODE.SICK_LEAVE;

  return WORK_MODE.FULL_DAY_ONSITE;
}

export function parseLegacyAttendanceCsv(content: string): ParseLegacyCsvResult {
  const lines = parseDelimitedRows(content);

  const errors: string[] = [];
  const rows: LegacyAttendanceCsvRow[] = [];
  const skipped = 0;

  if (lines.length < 2) {
    return {
      rows: [],
      errors: ["CSV must include a header row and at least one data row."],
      skipped: 0,
    };
  }

  const DATE_ALIASES = ["date", "attendance date", "work date"];
  const IN_ALIASES = [
    "in time",
    "in",
    "punch in",
    "clock in",
    "check in",
    "time in",
    "start time",
    "first in",
    "login time",
  ];
  const OUT_ALIASES = [
    "out time",
    "out",
    "punch out",
    "clock out",
    "check out",
    "time out",
    "end time",
    "last out",
    "logout time",
  ];
  const MODE_ALIASES = ["work mode", "mode", "attendance type", "day type", "status"];

  function resolveIndexes(headerCells: string[]) {
    const headerMap = new Map<string, number>();
    headerCells.forEach((cell, index) => {
      headerMap.set(normalizeHeader(cell), index);
      headerMap.set(normalizeHeaderKey(cell), index);
    });

    const dateIdx = headerMap.get("date") ?? resolveHeaderIndex(headerCells, DATE_ALIASES);
    const inIdx =
      headerMap.get("in time") ??
      headerMap.get("intime") ??
      headerMap.get("in") ??
      headerMap.get("clock in") ??
      headerMap.get("clockin") ??
      headerMap.get("check in") ??
      headerMap.get("checkin") ??
      resolveHeaderIndex(headerCells, IN_ALIASES);
    const outIdx =
      headerMap.get("out time") ??
      headerMap.get("outtime") ??
      headerMap.get("out") ??
      headerMap.get("clock out") ??
      headerMap.get("clockout") ??
      headerMap.get("check out") ??
      headerMap.get("checkout") ??
      resolveHeaderIndex(headerCells, OUT_ALIASES);
    const modeIdx =
      headerMap.get("work mode") ??
      headerMap.get("workmode") ??
      headerMap.get("mode") ??
      resolveHeaderIndex(headerCells, MODE_ALIASES);
    const dailyUpdateIdx =
      headerMap.get("daily update") ??
      headerMap.get("dailyupdate") ??
      headerMap.get("work update") ??
      headerMap.get("workupdate") ??
      headerMap.get("any update for hr") ??
      headerMap.get("anyupdateforhr") ??
      resolveHeaderIndex(headerCells, [
        "daily update",
        "work update",
        "any update for hr",
        "hr update",
        "update",
        "remarks",
      ]);

    return { dateIdx, inIdx, outIdx, modeIdx, dailyUpdateIdx };
  }

  let headerLineIndex = 0;
  let headerCells = lines[0] ?? [];
  let { dateIdx, inIdx, outIdx, modeIdx, dailyUpdateIdx } = resolveIndexes(headerCells);

  for (let i = 0; i < Math.min(5, lines.length - 1); i++) {
    const candidateCells = lines[i] ?? [];
    const candidate = resolveIndexes(candidateCells);
    if (candidate.dateIdx >= 0 && (candidate.inIdx >= 0 || candidate.outIdx >= 0)) {
      headerLineIndex = i;
      headerCells = candidateCells;
      ({ dateIdx, inIdx, outIdx, modeIdx, dailyUpdateIdx } = candidate);
      break;
    }
  }

  if (dateIdx < 0) {
    return { rows: [], errors: ["Missing required column: Date"], skipped: 0 };
  }

  for (let i = headerLineIndex + 1; i < lines.length; i++) {
    const cells = lines[i] ?? [];
    const dateRaw = cells[dateIdx] ?? "";
    const workMode = normalizeWorkMode(modeIdx >= 0 ? (cells[modeIdx] ?? "") : "");
    const inRaw = inIdx >= 0 ? (cells[inIdx] ?? "") : "";
    const outRaw = outIdx >= 0 ? (cells[outIdx] ?? "") : "";
    const dailyUpdate = dailyUpdateIdx >= 0 ? (cells[dailyUpdateIdx] ?? "").trim() : "";

    const date = parseLegacyDate(dateRaw);
    if (!date) {
      errors.push(`Row ${i + 1}: invalid date "${dateRaw}"`);
      continue;
    }

    const punchIn = parseLegacyImportClockTime(inRaw, "in", date);
    const punchOut = parseLegacyImportClockTime(outRaw, "out", date);

    if (isHolidayRow(workMode)) {
      rows.push({
        dateIso: formatIsoDate(date),
        punchIn: "",
        punchOut: "",
        dailyUpdate: "",
        workMode,
        skipped: false,
      });
      continue;
    }

    rows.push({
      dateIso: formatIsoDate(date),
      punchIn,
      punchOut,
      dailyUpdate,
      workMode,
      skipped: false,
    });
  }

  return { rows, errors, skipped };
}
