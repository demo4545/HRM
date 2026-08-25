import {
  EARLY_LEAVE_REASON_MIN_LENGTH,
  IMPORT_DEFAULT_BREAK,
  OVERTIME_APPROVAL,
  WORK_MODE,
  WORKING_STATUS,
  canonicalizeWorkMode,
  isHalfDayUnpaidWorkMode,
  isPunchOptionalWorkMode,
  type CorrectionField,
} from "@/lib/attendance/constants";
import {
  computeAttendanceMetrics,
  formatClockTime,
  formatDuration,
  formatIsoDate,
  formatWallClockTime,
  monthlySheetTitle,
  normalizeSheetDate,
  parseDurationToMs,
  parseTimeOnDate,
  resolveTotalBreakTimeFromClocks,
} from "@/lib/attendance/time";
import type { AttendanceRow } from "@/lib/google/attendance-sheets";
import { getAdminFirestore } from "@/lib/firebase/admin";

import type { AttendanceRepository, AttendanceStorageRef } from "./types";

const COLLECTION = "attendance";
const AUTO_PUNCH_OUT_CLOCK = formatWallClockTime(23, 59);
const AUTO_PUNCH_OUT_NOTE =
  "Auto punch-out at midnight (forgot to punch out). Contact HR or Super Admin to correct punch-out time.";

type DayFields = Omit<AttendanceRow, "sheetRow">;

function resolveAttendanceStatus(
  baseStatus: string,
  overtimeApproval: string,
  overtimeValue: string,
): string {
  const approval = overtimeApproval.trim();
  const overtime = overtimeValue.trim();
  const hasPositiveOvertime =
    overtime.length > 0 && overtime !== "—" && !overtime.startsWith("-") && /\d/.test(overtime);

  if (!hasPositiveOvertime) return baseStatus;

  if (approval === OVERTIME_APPROVAL.PENDING) return WORKING_STATUS.OVERTIME_REQUESTED;
  if (approval === OVERTIME_APPROVAL.ACCEPTED) return WORKING_STATUS.OVERTIME_APPROVED;
  if (approval === OVERTIME_APPROVAL.REJECTED) return WORKING_STATUS.OVERTIME_REJECTED;
  return baseStatus;
}

function emptyDay(date: Date): DayFields {
  return {
    date: formatIsoDate(date),
    workMode: WORK_MODE.FULL_DAY_ONSITE,
    punchIn: "",
    punchOut: "",
    breakStart: "",
    breakEnd: "",
    totalBreakTime: "",
    workingHours: "",
    status: WORKING_STATUS.IN_PROGRESS,
    overtime: "—",
    earlyLeaveReason: "",
    dailyUpdate: "",
    isOvertimeApproved: OVERTIME_APPROVAL.NOT_CONSIDERED,
  };
}

function toAttendanceRow(fields: DayFields): AttendanceRow {
  const dateStr = normalizeSheetDate(fields.date);
  const baseDate = dateStr ? new Date(`${dateStr}T12:00:00`) : new Date();
  const punchedOut = Boolean(fields.punchOut.trim());
  const totalBreakTime = resolveTotalBreakTimeFromClocks({
    breakStart: fields.breakStart,
    breakEnd: fields.breakEnd,
    punchIn: fields.punchIn,
    existingTotalBreakTime: fields.totalBreakTime,
    baseDate,
    workMode: fields.workMode,
  });
  const metrics = computeAttendanceMetrics({
    punchIn: fields.punchIn,
    punchOut: fields.punchOut,
    totalBreakTime,
    baseDate,
    punchedOut,
    workMode: fields.workMode,
  });

  // Prefer persisted WH / OT / status so Performance matches the sheet when break
  // cells were cleared or differ from what was used when hours were saved.
  const storedWorkingHours = fields.workingHours.trim();
  const useStored = punchedOut && storedWorkingHours.length > 0;
  const workingHours = punchedOut
    ? useStored
      ? storedWorkingHours
      : metrics.workingHours
    : fields.workingHours;
  const overtime = punchedOut
    ? useStored
      ? fields.overtime.trim() || "—"
      : metrics.overtime
    : fields.overtime;
  const status = punchedOut
    ? resolveAttendanceStatus(
        useStored ? fields.status.trim() || metrics.status : metrics.status,
        fields.isOvertimeApproved,
        overtime,
      )
    : fields.status;

  return {
    sheetRow: 0,
    date: dateStr,
    workMode: fields.workMode,
    punchIn: fields.punchIn,
    punchOut: fields.punchOut,
    breakStart: fields.breakStart,
    breakEnd: fields.breakEnd,
    totalBreakTime,
    workingHours,
    status,
    overtime,
    earlyLeaveReason: punchedOut && status !== WORKING_STATUS.SHORT ? "" : fields.earlyLeaveReason,
    dailyUpdate: fields.dailyUpdate,
    isOvertimeApproved: fields.isOvertimeApproved,
  };
}

function applyPunchOutMetrics(fields: DayFields, baseDate: Date): void {
  fields.totalBreakTime = resolveTotalBreakTimeFromClocks({
    breakStart: fields.breakStart,
    breakEnd: fields.breakEnd,
    punchIn: fields.punchIn,
    existingTotalBreakTime: fields.totalBreakTime,
    baseDate,
    workMode: fields.workMode,
  });
  const metrics = computeAttendanceMetrics({
    punchIn: fields.punchIn,
    punchOut: fields.punchOut,
    totalBreakTime: fields.totalBreakTime,
    baseDate,
    punchedOut: true,
    workMode: fields.workMode,
  });
  fields.workingHours = metrics.workingHours;
  fields.overtime = metrics.overtime;
  fields.status = resolveAttendanceStatus(
    metrics.status,
    fields.isOvertimeApproved,
    metrics.overtime,
  );
  if (fields.status !== WORKING_STATUS.SHORT) {
    fields.earlyLeaveReason = "";
  }
}

function daysCollection(employeeId: string) {
  return getAdminFirestore().collection(COLLECTION).doc(employeeId).collection("days");
}

async function getDayFields(ref: AttendanceStorageRef, dateIso: string): Promise<DayFields | null> {
  const snap = await daysCollection(ref.employeeId).doc(dateIso).get();
  if (!snap.exists) return null;
  const data = snap.data() as Partial<DayFields>;
  return {
    ...emptyDay(new Date(`${dateIso}T12:00:00`)),
    ...data,
    date: normalizeSheetDate(String(data.date ?? dateIso)),
  };
}

async function saveDayFields(ref: AttendanceStorageRef, fields: DayFields): Promise<AttendanceRow> {
  const dateIso = normalizeSheetDate(fields.date);
  await daysCollection(ref.employeeId).doc(dateIso).set(fields, { merge: true });
  return toAttendanceRow({ ...fields, date: dateIso });
}

/** HR manual create/update of punch and break times for a specific date (Firebase). */
export async function upsertManualAttendanceInFirestore(params: {
  employeeId: string;
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

  const ref: AttendanceStorageRef = {
    employeeId: params.employeeId,
    spreadsheetId: "",
  };
  const baseDate = new Date(`${dateIso}T12:00:00`);
  const fields = (await getDayFields(ref, dateIso)) ?? emptyDay(baseDate);
  fields.date = dateIso;

  const workMode = canonicalizeWorkMode(
    params.workMode?.trim() || fields.workMode || WORK_MODE.FULL_DAY_ONSITE,
  );
  fields.workMode = workMode;

  const punchOptional = isPunchOptionalWorkMode(workMode);

  if (punchOptional && !params.punchIn?.trim() && !params.punchOut?.trim()) {
    fields.punchIn = "";
    fields.punchOut = "";
    fields.breakStart = "";
    fields.breakEnd = "";
    fields.totalBreakTime = "";
    fields.workingHours = "";
    fields.overtime = "—";
    fields.earlyLeaveReason = "";
    fields.status = WORKING_STATUS.ON_LEAVE;
  } else {
    if (params.punchIn !== undefined) {
      fields.punchIn = params.punchIn;
    }
    if (params.punchOut !== undefined) {
      fields.punchOut = params.punchOut;
    }
    if (
      params.breakStart !== undefined ||
      params.breakEnd !== undefined ||
      params.totalBreakTime !== undefined
    ) {
      fields.breakStart = params.breakStart ?? "";
      fields.breakEnd = params.breakEnd ?? "";
      fields.totalBreakTime = params.totalBreakTime ?? "";
    }

    if (fields.punchOut.trim()) {
      applyPunchOutMetrics(fields, baseDate);
    } else if (fields.punchIn.trim()) {
      fields.status = WORKING_STATUS.IN_PROGRESS;
      fields.overtime = "—";
      fields.workingHours = "";
    }
  }

  return saveDayFields(ref, fields);
}

async function getOrCreateDayFields(ref: AttendanceStorageRef, date: Date): Promise<DayFields> {
  const dateIso = formatIsoDate(date);
  const existing = await getDayFields(ref, dateIso);
  return existing ?? emptyDay(date);
}

export const firestoreAttendanceRepository: AttendanceRepository = {
  async getTodayAttendance(ref, date = new Date()) {
    const fields = await getDayFields(ref, formatIsoDate(date));
    if (!fields || !fields.punchIn.trim()) return null;
    return toAttendanceRow(fields);
  },

  async getAttendanceForDate(ref, dateIso) {
    const normalized = normalizeSheetDate(dateIso);
    if (!normalized) return null;
    const fields = await getDayFields(ref, normalized);
    if (!fields) return null;
    return toAttendanceRow(fields);
  },

  async getMonthAttendance(ref, year, monthIndex) {
    const start = formatIsoDate(new Date(year, monthIndex, 1));
    const end = formatIsoDate(new Date(year, monthIndex + 1, 0));
    const snap = await daysCollection(ref.employeeId)
      .where("date", ">=", start)
      .where("date", "<=", end)
      .get();

    const records: AttendanceRow[] = [];
    for (const doc of snap.docs) {
      const data = doc.data() as Partial<DayFields>;
      if (!String(data.date ?? doc.id).trim()) continue;
      records.push(toAttendanceRow({ ...emptyDay(new Date(`${doc.id}T12:00:00`)), ...data }));
    }
    return records.sort((a, b) => a.date.localeCompare(b.date));
  },

  async listMonthlySheetsAcrossYears(ref) {
    const snap = await daysCollection(ref.employeeId).select("date").get();
    const unique = new Set<string>();
    for (const doc of snap.docs) {
      const dateIso = normalizeSheetDate(String(doc.data().date ?? doc.id));
      if (!dateIso) continue;
      const parsed = new Date(`${dateIso}T12:00:00`);
      unique.add(monthlySheetTitle(parsed));
    }
    return [...unique];
  },

  async punchIn(ref, date = new Date(), options) {
    const fields = await getOrCreateDayFields(ref, date);
    if (fields.punchIn.trim()) {
      throw new Error("Already punched in today");
    }

    fields.workMode = options?.workMode?.trim() || fields.workMode || WORK_MODE.FULL_DAY_ONSITE;
    fields.punchIn = formatClockTime(date);
    fields.punchOut = "";
    fields.breakStart = "";
    fields.breakEnd = "";
    fields.totalBreakTime = "";
    fields.workingHours = "";
    fields.overtime = "—";
    fields.status = WORKING_STATUS.IN_PROGRESS;

    return saveDayFields(ref, fields);
  },

  async punchOut(ref, date = new Date(), options) {
    const fields = await getOrCreateDayFields(ref, date);
    if (!fields.punchIn.trim()) {
      throw new Error("Punch in first before punching out");
    }
    if (fields.punchOut.trim()) {
      throw new Error("Already punched out today");
    }
    if (fields.breakStart.trim() && !fields.breakEnd.trim()) {
      throw new Error("End your break before punching out");
    }

    fields.punchOut = formatClockTime(date);
    applyPunchOutMetrics(fields, date);

    if (fields.status === WORKING_STATUS.SHORT) {
      const reason = options?.earlyLeaveReason?.trim() ?? "";
      if (!reason) {
        throw new Error("Please provide a reason for leaving early");
      }
      if (reason.length < EARLY_LEAVE_REASON_MIN_LENGTH) {
        throw new Error(
          `Early leave reason must be at least ${EARLY_LEAVE_REASON_MIN_LENGTH} characters`,
        );
      }
      fields.earlyLeaveReason = reason;
    } else {
      fields.earlyLeaveReason = "";
    }
    fields.dailyUpdate = options?.dailyUpdate?.trim() ?? "";

    return saveDayFields(ref, fields);
  },

  async startBreak(ref, date = new Date()) {
    const fields = await getOrCreateDayFields(ref, date);
    if (!fields.punchIn.trim()) {
      throw new Error("Punch in first before starting a break");
    }
    if (fields.punchOut.trim()) {
      throw new Error("Cannot start a break after punch out");
    }
    if (isHalfDayUnpaidWorkMode(fields.workMode)) {
      throw new Error("Break is not allowed for Half Day Unpaid Leave");
    }
    if (fields.breakStart.trim() && !fields.breakEnd.trim()) {
      throw new Error("Already on break");
    }

    fields.breakStart = formatClockTime(date);
    fields.breakEnd = "";

    return saveDayFields(ref, fields);
  },

  async endBreak(ref, date = new Date()) {
    const fields = await getOrCreateDayFields(ref, date);
    if (!fields.breakStart.trim() || fields.breakEnd.trim()) {
      throw new Error("No active break to end");
    }

    const breakEnd = formatClockTime(date);
    const breakStartMs = parseTimeOnDate(fields.breakStart, date);
    const breakEndMs = parseTimeOnDate(breakEnd, date);
    const breakMs =
      breakStartMs != null && breakEndMs != null && breakEndMs > breakStartMs
        ? breakEndMs - breakStartMs
        : 0;

    const existingBreakMs = parseDurationToMs(fields.totalBreakTime);
    fields.totalBreakTime = formatDuration(existingBreakMs + breakMs);
    fields.breakEnd = breakEnd;

    return saveDayFields(ref, fields);
  },

  async updateDailyUpdate(ref, dateIso, dailyUpdate) {
    const normalized = normalizeSheetDate(dateIso);
    if (!normalized) {
      throw new Error("Date is required for daily update");
    }
    const fields = await getOrCreateDayFields(ref, new Date(`${normalized}T12:00:00`));
    fields.dailyUpdate = dailyUpdate.trim();
    return saveDayFields(ref, fields);
  },

  async autoPunchOutOpenSession(ref, dateIso) {
    const normalized = normalizeSheetDate(dateIso);
    if (!normalized) {
      throw new Error("Invalid attendance date for auto punch-out");
    }

    const baseDate = new Date(`${normalized}T12:00:00`);
    const fields = await getDayFields(ref, normalized);
    if (!fields?.punchIn.trim() || fields.punchOut.trim()) return null;

    if (fields.breakStart.trim() && !fields.breakEnd.trim()) {
      const breakStartMs = parseTimeOnDate(fields.breakStart, baseDate);
      const breakEndMs = parseTimeOnDate(AUTO_PUNCH_OUT_CLOCK, baseDate);
      const breakMs =
        breakStartMs != null && breakEndMs != null && breakEndMs > breakStartMs
          ? breakEndMs - breakStartMs
          : 0;
      const existingBreakMs = parseDurationToMs(fields.totalBreakTime);
      fields.totalBreakTime = formatDuration(existingBreakMs + breakMs);
      fields.breakEnd = AUTO_PUNCH_OUT_CLOCK;
    }

    fields.punchOut = AUTO_PUNCH_OUT_CLOCK;
    applyPunchOutMetrics(fields, baseDate);

    if (fields.status === WORKING_STATUS.SHORT && !fields.earlyLeaveReason.trim()) {
      fields.earlyLeaveReason = AUTO_PUNCH_OUT_NOTE;
    }

    const existingUpdate = fields.dailyUpdate.trim();
    if (!existingUpdate) {
      fields.dailyUpdate = AUTO_PUNCH_OUT_NOTE;
    } else if (!existingUpdate.toLowerCase().includes("auto punch-out")) {
      fields.dailyUpdate = `${existingUpdate}\n${AUTO_PUNCH_OUT_NOTE}`;
    }

    return saveDayFields(ref, fields);
  },

  async updateAttendanceField(ref, dateIso, field, value) {
    const normalized = normalizeSheetDate(dateIso);
    if (!normalized) {
      throw new Error("Attendance record not found for correction date");
    }

    const fields = await getDayFields(ref, normalized);
    if (!fields) {
      throw new Error("Attendance record not found for correction date");
    }

    const key = field as CorrectionField | "dailyUpdate" | "isOvertimeApproved";
    if (key === "punchIn") fields.punchIn = value;
    else if (key === "punchOut") fields.punchOut = value;
    else if (key === "breakStart") fields.breakStart = value;
    else if (key === "breakEnd") fields.breakEnd = value;
    else if (key === "dailyUpdate") fields.dailyUpdate = value;
    else if (key === "isOvertimeApproved") fields.isOvertimeApproved = value;
    else {
      throw new Error(`Unsupported attendance field: ${field}`);
    }

    const baseDate = new Date(`${normalized}T12:00:00`);
    const overwriteFromClocks = key === "breakStart" || key === "breakEnd";
    fields.totalBreakTime = resolveTotalBreakTimeFromClocks({
      breakStart: fields.breakStart,
      breakEnd: fields.breakEnd,
      punchIn: fields.punchIn,
      existingTotalBreakTime: fields.totalBreakTime,
      baseDate,
      workMode: fields.workMode,
      overwriteFromClocks,
    });

    if (fields.punchIn.trim() && fields.punchOut.trim()) {
      applyPunchOutMetrics(fields, baseDate);
    }

    return saveDayFields(ref, fields);
  },

  async updateOvertimeApproval(ref, dateIso, overtimeApproval) {
    return this.updateAttendanceField(ref, dateIso, "isOvertimeApproved", overtimeApproval.trim());
  },

  async importAttendanceRecords(ref, records) {
    let imported = 0;
    let updated = 0;
    if (!records.length) return { imported, updated };

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

    for (const record of records) {
      const dateIso = normalizeSheetDate(record.dateIso);
      if (!dateIso) continue;

      const baseDate = new Date(`${dateIso}T12:00:00`);
      const existing = await getDayFields(ref, dateIso);
      const fields = existing ?? emptyDay(baseDate);
      fields.date = dateIso;
      fields.workMode = record.workMode?.trim() || fields.workMode || WORK_MODE.FULL_DAY_ONSITE;
      fields.punchIn = record.punchIn;
      fields.punchOut = record.punchOut;
      fields.dailyUpdate = record.dailyUpdate?.trim() ?? "";
      fields.breakStart = "";
      fields.breakEnd = "";
      fields.totalBreakTime = isHalfDayUnpaidWorkMode(fields.workMode) ? "" : IMPORT_DEFAULT_BREAK;

      const hasIn = record.punchIn.trim().length > 0;
      const hasOut = record.punchOut.trim().length > 0;
      const normalizedMode = fields.workMode;

      if (isHolidayMode(normalizedMode)) {
        fields.breakStart = "";
        fields.breakEnd = "";
        fields.totalBreakTime = "";
        fields.workingHours = "";
        fields.status = "";
        fields.overtime = "";
      } else if (isLeaveMode(normalizedMode) && !hasIn && !hasOut) {
        fields.breakStart = "";
        fields.breakEnd = "";
        fields.totalBreakTime = "";
        fields.workingHours = "";
        fields.status = WORKING_STATUS.ON_LEAVE;
        fields.overtime = "";
      } else if (!hasIn && !hasOut) {
        fields.breakStart = "";
        fields.breakEnd = "";
        fields.totalBreakTime = "";
        fields.workingHours = "";
        fields.status = "";
        fields.overtime = "";
      } else if (hasOut) {
        applyPunchOutMetrics(fields, baseDate);
      } else {
        fields.overtime = "—";
        fields.status = WORKING_STATUS.IN_PROGRESS;
        fields.workingHours = "";
      }

      await saveDayFields(ref, fields);
      if (existing) updated += 1;
      else imported += 1;
    }

    return { imported, updated };
  },

  async upsertManualAttendance(ref, params) {
    return upsertManualAttendanceInFirestore({
      employeeId: ref.employeeId,
      ...params,
    });
  },
};
