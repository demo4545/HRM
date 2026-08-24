import { getAdminFirestore } from "@/lib/firebase/admin";
import { sheetRowToForm } from "@/lib/employee";
import { listAllEmployeeRows } from "@/lib/employees/repository/firestore";

import {
  upsertAttendanceDayFromFirestoreRow,
  type AttendanceRow,
} from "@/lib/google/attendance-sheets";

const IST_TIME_ZONE = "Asia/Kolkata";
const THROTTLE_MS = 150;

const DEFAULT_LOOKBACK_DAYS = 7;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function dateIsoInIst(date: Date = new Date()): string {
  // en-CA returns YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: IST_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function addDaysIso(iso: string, deltaDays: number): string {
  const [y, m, d] = iso.split("-").map((p) => parseInt(p, 10));
  if (!y || !m || !d) return iso;
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + deltaDays);
  const year = dt.getFullYear();
  const month = String(dt.getMonth() + 1).padStart(2, "0");
  const day = String(dt.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function iterateIsoDates(fromIso: string, toIso: string): string[] {
  const [fy, fm, fd] = fromIso.split("-").map((p) => parseInt(p, 10));
  const [ty, tm, td] = toIso.split("-").map((p) => parseInt(p, 10));
  if (!fy || !fm || !fd || !ty || !tm || !td) return [];

  const start = new Date(fy, fm - 1, fd);
  const end = new Date(ty, tm - 1, td);

  if (start.getTime() > end.getTime()) return [];

  const days: string[] = [];
  for (let cursor = new Date(start); cursor.getTime() <= end.getTime();) {
    const year = cursor.getFullYear();
    const month = String(cursor.getMonth() + 1).padStart(2, "0");
    const day = String(cursor.getDate()).padStart(2, "0");
    days.push(`${year}-${month}-${day}`);
    cursor.setDate(cursor.getDate() + 1);
  }

  return days;
}

export type SyncAttendanceToSheetsResult = {
  fromIso: string;
  toIso: string;
  updatedCount: number;
  skippedCount: number;
  locked?: boolean;
  failedCount?: number;
};

export async function syncAttendanceToSheets(params?: {
  fromIso?: string;
  toIso?: string;
}): Promise<SyncAttendanceToSheetsResult> {
  // Default: previous IST day, plus a short lookback so late auto punch-outs
  // (closed in Firebase after an earlier Sheets copy) still get overwritten.
  const todayIso = dateIsoInIst();
  const previousDayIso = addDaysIso(todayIso, -1);
  const toIso = params?.toIso?.trim() || previousDayIso;
  const fromIso = params?.fromIso?.trim() || addDaysIso(todayIso, -DEFAULT_LOOKBACK_DAYS);

  const dateIsos = iterateIsoDates(fromIso, toIso);
  if (dateIsos.length === 0) {
    return { fromIso, toIso, updatedCount: 0, skippedCount: 0 };
  }

  const db = getAdminFirestore();

  // Prevent overlapping runs from causing a burst against Google Sheets.
  const lockDocRef = db.collection("sync_locks").doc("attendance_to_sheets");
  const now = Date.now();
  const lockTtlMs = 20 * 60 * 1000; // 20 minutes

  // Clear orphaned locks left by the previous buggy writer (set lockedUntil but never released).
  const existingLockSnap = await lockDocRef.get();
  const existingLockedUntil = (existingLockSnap.data()?.lockedUntil as number | undefined) ?? 0;
  const existingLockedAt = (existingLockSnap.data()?.lockedAt as number | undefined) ?? 0;
  const lockStillHeld = existingLockedUntil > now;
  const lockExpiredByAge = existingLockedAt > 0 && now - existingLockedAt >= lockTtlMs;
  const orphanedLock = lockStillHeld && existingLockedAt === 0;
  if (lockStillHeld && (lockExpiredByAge || orphanedLock)) {
    await lockDocRef.set({ lockedUntil: 0, lockedAt: 0 }, { merge: true });
  }

  const lockedUntil = now + lockTtlMs;

  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(lockDocRef);
      const heldUntil = (snap.data()?.lockedUntil as number | undefined) ?? 0;
      const heldAt = (snap.data()?.lockedAt as number | undefined) ?? 0;
      if (heldUntil > now && heldAt > 0 && now - heldAt < lockTtlMs) {
        throw new Error("SYNC_LOCKED");
      }
      tx.set(lockDocRef, { lockedUntil, lockedAt: now }, { merge: true });
    });
  } catch (err) {
    if (String((err as Error)?.message) === "SYNC_LOCKED") {
      return { fromIso, toIso, updatedCount: 0, skippedCount: 0, locked: true };
    }
    throw err;
  }

  try {
    // Map employeeId -> attendance spreadsheetId (all in Firebase, no Sheets calls).
    const employeeRows = await listAllEmployeeRows();
    const attendanceSpreadsheetByEmployeeId = new Map<string, string>();
    for (const record of employeeRows) {
      const form = sheetRowToForm(record.headers, record.row);
      const employeeId = String(form.employeeId ?? "").trim();
      const attendanceSpreadsheetId = String(form.attendanceSpreadsheetId ?? "").trim();
      if (!employeeId || !attendanceSpreadsheetId) continue;
      attendanceSpreadsheetByEmployeeId.set(employeeId, attendanceSpreadsheetId);
    }

    // Sync every employee with an attendance spreadsheet configured.
    // Do not list `attendance` collection docs — parent docs like attendance/EMP003
    // often don't exist (only the `days` subcollection does), so that query returns empty.
    const attendanceEmployeeIds = [...attendanceSpreadsheetByEmployeeId.keys()];

    let updatedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;

    for (const dateIso of dateIsos) {
      for (const employeeId of attendanceEmployeeIds) {
        const attendanceSpreadsheetId = attendanceSpreadsheetByEmployeeId.get(employeeId);
        if (!attendanceSpreadsheetId) {
          skippedCount += 1;
          continue;
        }

        const daySnap = await db
          .collection("attendance")
          .doc(employeeId)
          .collection("days")
          .doc(dateIso)
          .get();

        if (!daySnap.exists) {
          skippedCount += 1;
          continue;
        }

        const data = daySnap.data() as Partial<AttendanceRow>;
        const row: AttendanceRow = {
          sheetRow: 0,
          date: String(data.date ?? dateIso).trim(),
          workMode: String(data.workMode ?? "").trim(),
          punchIn: String(data.punchIn ?? "").trim(),
          punchOut: String(data.punchOut ?? "").trim(),
          breakStart: String(data.breakStart ?? "").trim(),
          breakEnd: String(data.breakEnd ?? "").trim(),
          totalBreakTime: String(data.totalBreakTime ?? "").trim(),
          workingHours: String(data.workingHours ?? "").trim(),
          status: String(data.status ?? "").trim(),
          overtime: String(data.overtime ?? "").trim(),
          earlyLeaveReason: String(data.earlyLeaveReason ?? "").trim(),
          dailyUpdate: String(data.dailyUpdate ?? "").trim(),
          isOvertimeApproved: String(data.isOvertimeApproved ?? "").trim(),
        };

        try {
          await upsertAttendanceDayFromFirestoreRow({
            spreadsheetId: attendanceSpreadsheetId,
            dateIso,
            row,
          });
          updatedCount += 1;
        } catch (error) {
          failedCount += 1;
          console.error(
            `[sync-attendance-to-sheets] failed (employeeId=${employeeId}, dateIso=${dateIso})`,
            error,
          );
        }
        await sleep(THROTTLE_MS);
      }
    }

    return { fromIso, toIso, updatedCount, skippedCount, failedCount };
  } finally {
    await lockDocRef.set({ lockedUntil: 0, lockedAt: 0 }, { merge: true }).catch((error) => {
      console.error("[sync-attendance-to-sheets] failed to release lock", error);
    });
  }
}
