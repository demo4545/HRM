import {
  IDEAL_BREAK_HOURS,
  IDEAL_SHIFT_HOURS,
  IDEAL_WORKING_HOURS,
  IMPORT_DEFAULT_BREAK,
  isHalfDayUnpaidWorkMode,
} from "./constants";
import { WORKING_STATUS, type WorkingStatus } from "./constants";

const OVERTIME_REVIEW_THRESHOLD_MS = 30 * 60 * 1000;

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

export type AppZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

/** Business timezone for attendance dates/times (punch, sheets, “today”). */
export function getAppTimeZone(): string {
  return process.env.APP_TIME_ZONE?.trim() || "Asia/Kolkata";
}

export function getAppZonedParts(date: Date = new Date()): AppZonedParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: getAppTimeZone(),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const values: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") values[part.type] = part.value;
  }

  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
  };
}

/**
 * Convert an app-timezone wall clock on a calendar day to a UTC epoch ms.
 * Needed so punch metrics stay correct when the Node host runs in UTC (e.g. Vercel).
 */
export function appZonedDateTimeToUtcMs(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
): number {
  let utcMs = Date.UTC(year, month - 1, day, hour, minute, second);

  for (let i = 0; i < 3; i++) {
    const parts = getAppZonedParts(new Date(utcMs));
    const asUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    const desired = Date.UTC(year, month - 1, day, hour, minute, second);
    const diff = desired - asUtc;
    if (diff === 0) break;
    utcMs += diff;
  }

  return utcMs;
}

/** Sheet tab name: `May-2026` */
export function monthlySheetTitle(date: Date = new Date()): string {
  const parts = getAppZonedParts(date);
  const month = MONTH_NAMES[parts.month - 1];
  return `${month}-${parts.year}`;
}

export function parseMonthlySheetTitle(title: string): { month: number; year: number } | null {
  const match = title.trim().match(/^([A-Za-z]{3})-(\d{4})$/);
  if (!match) return null;

  const monthIndex = MONTH_NAMES.findIndex((m) => m.toLowerCase() === match[1].toLowerCase());
  if (monthIndex < 0) return null;

  const year = parseInt(match[2], 10);
  if (!Number.isFinite(year)) return null;

  return { month: monthIndex, year };
}

export function formatIsoDate(date: Date = new Date()): string {
  const parts = getAppZonedParts(date);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

/** Normalize sheet date cells (ISO, locale strings, serial numbers) for comparison. */
export function normalizeSheetDate(value: string): string {
  const trimmed = String(value ?? "")
    .trim()
    .replace(/^'/, "");
  if (!trimmed) return "";

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

  // Indian locale sheets often return DD/MM/YYYY or DD-MM-YYYY. Parse explicitly —
  // `new Date("22/07/2026")` is Invalid Date in V8, which previously left keys
  // unmatched against ISO scheduled dates used by payroll.
  const dmy = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) {
    const day = Number(dmy[1]);
    const month = Number(dmy[2]);
    const year = Number(dmy[3]);
    if (
      Number.isFinite(day) &&
      Number.isFinite(month) &&
      Number.isFinite(year) &&
      month >= 1 &&
      month <= 12 &&
      day >= 1 &&
      day <= 31
    ) {
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const serial = parseFloat(trimmed);
    const epoch = new Date(1899, 11, 30);
    const parsed = new Date(epoch.getTime() + serial * 86400000);
    if (!Number.isNaN(parsed.getTime())) return formatIsoDate(parsed);
  }

  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) return formatIsoDate(parsed);

  return trimmed;
}

/** Store dates as plain text so reads round-trip reliably. */
export function formatSheetDateLiteral(date: Date = new Date()): string {
  return `'${formatIsoDate(date)}`;
}

export function formatClockTime(date: Date = new Date()): string {
  return date.toLocaleTimeString("en-IN", {
    timeZone: getAppTimeZone(),
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

/** Format hour/minute values that are already app-timezone wall clock as `hh:mm am/pm`. */
export function formatWallClockTime(hours: number, minutes: number, seconds = 0): string {
  const utc = new Date(Date.UTC(2000, 0, 1, hours, minutes, seconds));
  return utc.toLocaleTimeString("en-IN", {
    timeZone: "UTC",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

/** Parse `09:04 AM` / `09:04` / ISO into epoch ms on `baseDate`'s app-timezone calendar day. */
export function parseTimeOnDate(value: string, baseDate: Date): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (trimmed.includes("T")) {
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) return parsed.getTime();
  }

  const match = trimmed.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (!match) return null;

  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const seconds = match[3] ? parseInt(match[3], 10) : 0;
  const meridiem = match[4]?.toUpperCase();

  if (meridiem === "PM" && hours < 12) hours += 12;
  if (meridiem === "AM" && hours === 12) hours = 0;

  const day = getAppZonedParts(baseDate);
  return appZonedDateTimeToUtcMs(day.year, day.month, day.day, hours, minutes, seconds);
}

/**
 * Parse clock times from sheet cells — infers PM for punch-out when meridiem is missing
 * (e.g. `7:33` after `10:33 AM`).
 */
export function parseSheetClockTime(
  value: string,
  baseDate: Date,
  options?: { punchIn?: string; role?: "in" | "out" },
): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const day = getAppZonedParts(baseDate);

  const hourOnly = trimmed.match(/^(\d{1,2})$/);
  if (hourOnly && !/AM|PM/i.test(trimmed)) {
    let hours = parseInt(hourOnly[1], 10);
    if (options?.role === "out" && hours >= 1 && hours <= 11) hours += 12;
    return appZonedDateTimeToUtcMs(day.year, day.month, day.day, hours, 0, 0);
  }

  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const serial = parseFloat(trimmed);
    if (serial > 0 && serial < 1) {
      const ms = Math.round(serial * 24 * 60 * 60 * 1000);
      return appZonedDateTimeToUtcMs(day.year, day.month, day.day, 0, 0, 0) + ms;
    }
  }

  const parsedMs = parseTimeOnDate(trimmed, baseDate);
  if (parsedMs == null) return null;
  if (/AM|PM/i.test(trimmed)) return parsedMs;

  const match = trimmed.match(/^(\d{1,2}):(\d{1,2})/);
  if (!match) return parsedMs;

  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);

  const punchInMs = options?.punchIn ? parseTimeOnDate(options.punchIn, baseDate) : null;

  const treatAsPm =
    options?.role === "out" ||
    (punchInMs != null && parsedMs <= punchInMs && hours >= 1 && hours <= 11);

  if (treatAsPm && hours < 12) {
    return appZonedDateTimeToUtcMs(day.year, day.month, day.day, hours + 12, minutes, 0);
  }

  if (options?.role === "in" && hours >= 1 && hours <= 11 && !/PM/i.test(trimmed)) {
    return appZonedDateTimeToUtcMs(day.year, day.month, day.day, hours, minutes, 0);
  }

  return parsedMs;
}

export function parseDurationToMs(value: string): number {
  const trimmed = value.trim();
  if (!trimmed) return 0;

  // Shortfall is stored as "-4h 27m". ASCII hyphen, Unicode minus, or en-dash.
  // Do not treat em-dash "—" (empty OT placeholder) as a sign.
  const negative = /^[-−–]/.test(trimmed);
  const unsigned = negative ? trimmed.replace(/^[-−–]\s*/, "") : trimmed;
  if (!unsigned) return 0;

  if (/^\d+(\.\d+)?$/.test(unsigned)) {
    const n = parseFloat(unsigned);
    if (n > 0 && n < 1) {
      const ms = Math.round(n * 24 * 60 * 60 * 1000);
      return negative ? -ms : ms;
    }
  }

  let totalMs = 0;
  const hourMatch = unsigned.match(/(\d+)\s*h/i);
  const minMatch = unsigned.match(/(\d+)\s*m/i);
  const secMatch = unsigned.match(/(\d+)\s*s/i);

  if (hourMatch) totalMs += parseInt(hourMatch[1], 10) * 60 * 60 * 1000;
  if (minMatch) totalMs += parseInt(minMatch[1], 10) * 60 * 1000;
  if (secMatch) totalMs += parseInt(secMatch[1], 10) * 1000;

  if (!hourMatch && !minMatch && !secMatch) {
    const parts = unsigned.split(":").map((p) => parseInt(p, 10));
    if (parts.length >= 2 && parts.every((n) => Number.isFinite(n))) {
      const [h, m, s = 0] = parts;
      totalMs = ((h * 60 + m) * 60 + s) * 1000;
    }
  }

  return negative ? -totalMs : totalMs;
}

export function formatDuration(ms: number): string {
  if (ms <= 0) return "0h 0m";

  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return seconds > 0
      ? `${hours}h ${minutes}m ${seconds}s`
      : `${minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`}`;
  }

  if (minutes > 0) {
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }

  return `${seconds}s`;
}

export function formatDurationHms(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, "0")}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;
}

export function computeWorkingHoursMs(params: {
  punchIn: string;
  punchOut: string;
  totalBreakMs: number;
  baseDate: Date;
  workMode?: string;
}): number {
  const inMs = parseSheetClockTime(params.punchIn, params.baseDate, {
    role: "in",
  });
  const outMs = parseSheetClockTime(params.punchOut, params.baseDate, {
    punchIn: params.punchIn,
    role: "out",
  });
  if (inMs == null || outMs == null || outMs <= inMs) return 0;
  const shouldSkipBreak = isHalfDayUnpaidWorkMode(params.workMode);
  const breakMs = shouldSkipBreak ? 0 : params.totalBreakMs;
  return Math.max(0, outMs - inMs - breakMs);
}

export type AttendanceMetrics = {
  workingMs: number;
  workingHours: string;
  overtime: string;
  status: WorkingStatus;
  totalBreakMs: number;
};

/** Single source of truth for worked time, status, and overtime from sheet fields. */
export function computeAttendanceMetrics(params: {
  punchIn: string;
  punchOut: string;
  totalBreakTime: string;
  baseDate: Date;
  punchedOut?: boolean;
  workMode?: string;
}): AttendanceMetrics {
  const totalBreakMs = resolveAttendanceBreakMs(params.totalBreakTime, params.workMode);
  const hasOut = Boolean(params.punchOut.trim());
  const punchedOut = params.punchedOut ?? hasOut;
  const requiredMs = isHalfDayUnpaidWorkMode(params.workMode)
    ? 4 * 60 * 60 * 1000
    : idealWorkingMs();

  if (!params.punchIn.trim() || !hasOut) {
    return {
      workingMs: 0,
      workingHours: "",
      overtime: "—",
      status: WORKING_STATUS.IN_PROGRESS,
      totalBreakMs,
    };
  }

  const workingMs = computeWorkingHoursMs({
    punchIn: params.punchIn,
    punchOut: params.punchOut,
    totalBreakMs,
    baseDate: params.baseDate,
    workMode: params.workMode,
  });

  const status = workingStatusFromHours(workingMs, punchedOut, requiredMs);
  const overtimeMs = computeOvertimeMs(workingMs, requiredMs);
  const shortfallMs = Math.max(0, requiredMs - workingMs);
  const consideredOvertimeMs = overtimeMs >= OVERTIME_REVIEW_THRESHOLD_MS ? overtimeMs : 0;

  let overtime = "—";
  if (punchedOut) {
    if (consideredOvertimeMs > 0) overtime = formatDuration(consideredOvertimeMs);
    else if (shortfallMs > 0) overtime = `-${formatDuration(shortfallMs)}`;
  }

  return {
    workingMs,
    workingHours: punchedOut ? formatDuration(workingMs) : "",
    overtime,
    status,
    totalBreakMs,
  };
}

export function idealWorkingMs(): number {
  return IDEAL_WORKING_HOURS * 60 * 60 * 1000;
}

export function idealBreakMs(): number {
  return IDEAL_BREAK_HOURS * 60 * 60 * 1000;
}

/**
 * Actual break duration to subtract from elapsed punch-in → punch-out time.
 * Empty/missing break is 0 — unused break allowance is never assumed.
 * Legacy CSV imports write `IMPORT_DEFAULT_BREAK` onto the row when needed.
 * Display strings like "45m / 1h" (used / allowance) only count the used side.
 */
export function resolveAttendanceBreakMs(totalBreakTime: string, workMode?: string): number {
  if (isHalfDayUnpaidWorkMode(workMode)) return 0;
  const used = totalBreakTime.split("/")[0]?.trim() ?? "";
  return parseDurationToMs(used);
}

/**
 * Resolve total break time from the last break start/end clocks.
 *
 * Live punch keeps those clocks on the row after break-out so they appear in
 * the sheet. The stored total can include earlier breaks the same day, so it
 * is kept unless `overwriteFromClocks` is set (correction of break times).
 */
export function resolveTotalBreakTimeFromClocks(params: {
  breakStart: string;
  breakEnd: string;
  punchIn?: string;
  existingTotalBreakTime: string;
  baseDate: Date;
  workMode?: string;
  overwriteFromClocks?: boolean;
}): string {
  if (isHalfDayUnpaidWorkMode(params.workMode)) return "";
  const start = params.breakStart.trim();
  const end = params.breakEnd.trim();
  const existing = params.existingTotalBreakTime;
  if (!start || !end) return existing;

  const startMs = parseSheetClockTime(start, params.baseDate, {
    punchIn: params.punchIn,
    role: "in",
  });
  const endMs = parseSheetClockTime(end, params.baseDate, {
    punchIn: params.punchIn,
    role: "out",
  });
  if (startMs == null || endMs == null || endMs <= startMs) {
    return existing;
  }

  const fromClocks = formatDuration(endMs - startMs);
  if (existing.trim() && !params.overwriteFromClocks) {
    return existing;
  }
  return fromClocks;
}

/** Break time already taken today — used for live timers (no assumed allowance). */
export function resolveLiveBreakMs(
  totalBreakTime: string,
  workMode?: string,
  options?: { inProgress?: boolean },
): number {
  if (isHalfDayUnpaidWorkMode(workMode)) return 0;
  const trimmed = totalBreakTime.trim();
  if (options?.inProgress && trimmed.toLowerCase() === IMPORT_DEFAULT_BREAK.toLowerCase()) {
    return 0;
  }
  return parseDurationToMs(trimmed);
}

export function idealShiftMs(): number {
  return IDEAL_SHIFT_HOURS * 60 * 60 * 1000;
}

/** Break used vs allowed, e.g. "35m / 1h". */
/**
 * Parse legacy CSV clock cells: punch-in → AM, punch-out → PM when meridiem is omitted.
 * Supports `7`, `7:08`, `10:14`, and values that already include AM/PM.
 */
export function parseLegacyImportClockTime(
  value: string,
  kind: "in" | "out",
  baseDate: Date,
): string {
  const trimmed = value.trim();
  if (!trimmed) return "";

  if (/AM|PM/i.test(trimmed)) {
    const ms = parseTimeOnDate(trimmed, baseDate);
    return ms != null ? formatClockTime(new Date(ms)) : trimmed;
  }

  let hours: number;
  let minutes = 0;
  let seconds = 0;

  const hourOnly = trimmed.match(/^(\d{1,2})$/);
  const hm = trimmed.match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/);

  if (hourOnly) {
    hours = parseInt(hourOnly[1], 10);
  } else if (hm) {
    hours = parseInt(hm[1], 10);
    minutes = parseInt(hm[2], 10);
    seconds = hm[3] ? parseInt(hm[3], 10) : 0;
  } else {
    const ms = parseSheetClockTime(trimmed, baseDate, { role: kind });
    return ms != null ? formatClockTime(new Date(ms)) : trimmed;
  }

  if (kind === "out" && hours >= 1 && hours <= 11) {
    hours += 12;
  }

  return formatWallClockTime(hours, minutes, seconds);
}

export function formatBreakAllowance(usedMs: number): string {
  const allowed = IDEAL_BREAK_HOURS;
  if (usedMs <= 0) return `0h / ${allowed}h`;
  return `${formatDuration(usedMs)} / ${allowed}h`;
}

export function computeOvertimeMs(
  workingMs: number,
  requiredMs: number = idealWorkingMs(),
): number {
  return Math.max(0, workingMs - requiredMs);
}

/** Overtime beyond 8h, or shortfall prefix when under 8h. */
export function formatOvertimeDuration(workingMs: number): string {
  const overtimeMs = computeOvertimeMs(workingMs);
  if (overtimeMs > 0) return formatDuration(overtimeMs);
  const shortfallMs = idealWorkingMs() - workingMs;
  if (shortfallMs > 0) return `-${formatDuration(shortfallMs)}`;
  return "—";
}

export function workingStatusFromHours(
  workingMs: number,
  punchedOut: boolean,
  requiredMs: number = idealWorkingMs(),
): WorkingStatus {
  if (!punchedOut) return WORKING_STATUS.IN_PROGRESS;

  if (workingMs < requiredMs) return WORKING_STATUS.SHORT;
  if (workingMs > requiredMs) {
    const overtimeMs = computeOvertimeMs(workingMs, requiredMs);
    return overtimeMs >= OVERTIME_REVIEW_THRESHOLD_MS
      ? WORKING_STATUS.OVERTIME
      : WORKING_STATUS.COMPLETED;
  }
  return WORKING_STATUS.COMPLETED;
}

export function monthLabel(monthIndex: number): string {
  return MONTH_NAMES[monthIndex] ?? "Unknown";
}

type LiveBreakFields = {
  date: string;
  workMode?: string;
  punchIn?: string;
  totalBreakTime: string;
  breakStart: string;
  breakEnd: string;
  now?: Date;
};

/** Live break session + day total (includes an open break). */
export function computeLiveBreakMsFromFields(params: LiveBreakFields): {
  sessionMs: number;
  totalUsedMs: number;
  onBreak: boolean;
} {
  const skipBreak = isHalfDayUnpaidWorkMode(params.workMode);
  if (skipBreak) {
    return { sessionMs: 0, totalUsedMs: 0, onBreak: false };
  }

  const now = params.now ?? new Date();
  const baseDate = new Date(params.date);
  const storedMs = resolveLiveBreakMs(params.totalBreakTime, params.workMode, {
    inProgress: true,
  });

  const onBreak = Boolean(params.breakStart.trim() && !params.breakEnd.trim());
  if (!onBreak) {
    return { sessionMs: 0, totalUsedMs: storedMs, onBreak: false };
  }

  const breakStartMs = parseSheetClockTime(params.breakStart, baseDate, {
    punchIn: params.punchIn,
    role: "out",
  });
  const sessionMs = breakStartMs != null ? Math.max(0, now.getTime() - breakStartMs) : 0;

  return {
    sessionMs,
    totalUsedMs: storedMs + sessionMs,
    onBreak: true,
  };
}

/** Client-side live worked duration from today's attendance fields. */
export function computeLiveWorkedMsFromFields(params: {
  date: string;
  workMode?: string;
  punchIn: string;
  punchOut: string;
  totalBreakTime: string;
  breakStart: string;
  breakEnd: string;
  now?: Date;
}): number {
  if (!params.punchIn.trim()) return 0;

  const baseDate = new Date(params.date);
  const punchInMs = parseSheetClockTime(params.punchIn, baseDate, { role: "in" });
  if (punchInMs == null) return 0;

  const now = params.now ?? new Date();
  const endMs = params.punchOut.trim()
    ? (parseSheetClockTime(params.punchOut, baseDate, {
        punchIn: params.punchIn,
        role: "out",
      }) ?? now.getTime())
    : now.getTime();

  const { totalUsedMs: totalBreakMs } = computeLiveBreakMsFromFields({
    date: params.date,
    workMode: params.workMode,
    punchIn: params.punchIn,
    totalBreakTime: params.totalBreakTime,
    breakStart: params.breakStart,
    breakEnd: params.breakEnd,
    now,
  });

  return Math.max(0, endMs - punchInMs - totalBreakMs);
}
