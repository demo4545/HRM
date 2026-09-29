"use client";

import { readResponseJson } from "@/lib/api/read-response-json";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AttendanceHistoryView } from "@/components/attendance/attendance-history-view";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { useAuth } from "@/contexts/auth-provider";
import { useNotifications } from "@/contexts/notifications-provider";
import {
  fetchAttendanceHistory,
  importAttendanceCsv,
  saveHrAttendance,
  submitOvertimeRequest,
  type AttendanceHistoryRow,
} from "@/lib/attendance/client";
import { localTodayIso } from "@/lib/attendance/manual-entry";
import {
  buildAttendancePeriodOptions,
  clampMonthForYear,
  defaultAttendancePeriodSelection,
} from "@/lib/attendance/period-options";
import { toUserFacingActionError, toUserFacingFetchError } from "@/lib/api/user-facing-error";
import type { HrAttendanceFormValues } from "@/components/attendance/hr-attendance-form";
import { ROLES } from "@/app/consts/common";
import { canManageEmployees } from "@/lib/auth/roles";
import { parseEmployeeListApiResponse } from "@/lib/employee/list";
import type { Employee } from "@/types/employee";

function safeFilePart(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9-_]/g, "")
    .toLowerCase();
}

function exportCsv(
  rows: AttendanceHistoryRow[],
  options?: {
    employeeName?: string;
    employeeId?: string;
    month?: number | null;
    year?: number | null;
  },
) {
  const headers = [
    "Date",
    "Work Mode",
    "Punch In",
    "Punch Out",
    "Break Time",
    "Working Hours",
    "Overtime",
    "Status",
    "Early Leave Reason",
    "Daily Update",
  ];
  const lines = [
    headers.join(","),
    ...rows.map((r) =>
      [
        r.date,
        r.workMode ?? "",
        r.punchIn,
        r.punchOut,
        r.breakTime,
        r.workingHours,
        r.overtime,
        r.status,
        r.earlyLeaveReason ?? "",
        r.dailyUpdate ?? "",
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(","),
    ),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const employeePart = options?.employeeName ? safeFilePart(options.employeeName) : "employee";
  const employeeIdPart = options?.employeeId ? safeFilePart(options.employeeId) : "";
  const monthPart =
    options?.year != null && options?.month != null
      ? `${options.year}-${String(options.month + 1).padStart(2, "0")}`
      : "all-months";
  const parts = ["attendance", employeePart, employeeIdPart, monthPart].filter(Boolean);
  a.download = `${parts.join("-")}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function AttendanceHistoryPage() {
  const { user } = useAuth();
  const { pushToast } = useNotifications();
  const isHr = user ? canManageEmployees(user.role) : false;
  const fileInputRef = useRef<HTMLInputElement>(null);

  const periods = useMemo(() => buildAttendancePeriodOptions(), []);
  const initialPeriod = useMemo(() => defaultAttendancePeriodSelection(), []);

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selectedSheetRow, setSelectedSheetRow] = useState<number | null>(user?.sheetRow ?? null);
  const [year, setYear] = useState<number | null>(initialPeriod.year);
  const [month, setMonth] = useState<number | null>(initialPeriod.month);
  const [rows, setRows] = useState<AttendanceHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [requestingOvertimeId, setRequestingOvertimeId] = useState<string | null>(null);
  const [pendingOvertimeRow, setPendingOvertimeRow] = useState<AttendanceHistoryRow | null>(null);
  const [overtimeNote, setOvertimeNote] = useState("");
  const [hrFormMode, setHrFormMode] = useState<"closed" | "add" | "edit">("closed");
  const [hrFormRow, setHrFormRow] = useState<AttendanceHistoryRow | null>(null);
  const [savingHrAttendance, setSavingHrAttendance] = useState(false);

  const targetSheetRow = isHr
    ? (selectedSheetRow ?? user?.sheetRow ?? null)
    : (user?.sheetRow ?? null);

  useEffect(() => {
    if (!isHr) return;
    void fetch("/api/employee?pageSize=200", { credentials: "include" })
      .then(async (res) =>
        readResponseJson<{
          success?: boolean;
          message?: string;
          data?: string[][];
          sheetRows?: number[];
        }>(res, "fetch"),
      )
      .then((data) => {
        const list = parseEmployeeListApiResponse(data).filter(
          (row) => row.role.trim().toLowerCase() !== ROLES.SUPER_ADMIN,
        );
        setEmployees(list);
        setSelectedSheetRow((prev) => {
          if (prev != null && list.some((row) => Number(row.sheetRow) === prev)) return prev;
          const first = list[0];
          return first ? Number(first.sheetRow) : null;
        });
      })
      .catch(() => {});
  }, [isHr]);

  const loadHistory = useCallback(async () => {
    if (year == null || month == null || targetSheetRow == null) return;
    setLoading(true);
    try {
      const data = await fetchAttendanceHistory(year, month, targetSheetRow);
      setRows(data);
    } catch (err) {
      pushToast({
        title: "Couldn’t load attendance",
        body: toUserFacingFetchError(err),
        variant: "error",
      });
    } finally {
      setLoading(false);
    }
  }, [year, month, targetSheetRow, pushToast]);

  useEffect(() => {
    if (year == null || month == null || targetSheetRow == null) return;

    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const data = await fetchAttendanceHistory(year, month, targetSheetRow);
        if (!cancelled) {
          setRows(data);
        }
      } catch (err) {
        if (!cancelled) {
          pushToast({
            title: "Couldn’t load attendance",
            body: toUserFacingFetchError(err),
            variant: "error",
          });
          setRows([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [year, month, targetSheetRow, pushToast]);

  const sortedRows = useMemo(() => [...rows].sort((a, b) => b.date.localeCompare(a.date)), [rows]);
  const selectedEmployee = useMemo(
    () => employees.find((e) => Number(e.sheetRow) === targetSheetRow) ?? null,
    [employees, targetSheetRow],
  );

  async function handleImportFile(file: File) {
    if (targetSheetRow == null) return;
    setImporting(true);
    try {
      const result = await importAttendanceCsv(file, targetSheetRow);
      const extra =
        result.holidaysSkipped > 0
          ? ` (${result.holidaysSkipped} weekend/holiday rows skipped)`
          : "";
      const employeeLabel =
        result.employee?.employeeName ??
        selectedEmployee?.name ??
        (isHr ? `sheet row ${targetSheetRow}` : "your account");
      pushToast({
        title: "Import complete",
        body: `${result.message}${extra} For: ${employeeLabel}.`,
        variant: "success",
      });
      if (year != null && month != null) {
        await loadHistory();
      }
    } catch (err) {
      pushToast({
        title: "Import failed",
        body: toUserFacingActionError(err),
        variant: "error",
      });
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function handleYearChange(y: number) {
    setYear(y);
    setMonth(clampMonthForYear(y, month, periods));
  }

  function handlePeriodChange(nextYear: number, nextMonth: number) {
    setYear(nextYear);
    setMonth(clampMonthForYear(nextYear, nextMonth, periods));
  }

  async function handleRequestOvertime(row: AttendanceHistoryRow, comment: string) {
    setRequestingOvertimeId(row.id);
    try {
      await submitOvertimeRequest({
        date: row.date,
        comment,
        ...(isHr && targetSheetRow != null ? { employeeSheetRow: targetSheetRow } : {}),
      });
      pushToast({
        title: "Overtime request submitted",
        body: `Request sent for ${row.date}.`,
        variant: "success",
      });
      setPendingOvertimeRow(null);
      setOvertimeNote("");
      await loadHistory();
    } catch (err) {
      pushToast({
        title: "Overtime request failed",
        body: toUserFacingActionError(err),
        variant: "error",
      });
    } finally {
      setRequestingOvertimeId(null);
    }
  }

  function defaultHrFormDate(): string {
    const today = localTodayIso();
    if (year != null && month != null) {
      const [y, m] = today.split("-").map((part) => Number(part));
      if (y === year && m === month + 1) return today;
      return `${year}-${String(month + 1).padStart(2, "0")}-01`;
    }
    return today;
  }

  async function handleSaveHrAttendance(values: HrAttendanceFormValues) {
    if (targetSheetRow == null) {
      pushToast({
        title: "Select an employee",
        body: "Choose an employee before saving attendance.",
        variant: "error",
      });
      return;
    }
    setSavingHrAttendance(true);
    try {
      const result = await saveHrAttendance({
        employeeSheetRow: targetSheetRow,
        date: values.date,
        workMode: values.workMode,
        punchIn: values.punchIn || undefined,
        punchOut: values.punchOut || undefined,
        breakStart: values.breakStart || undefined,
        breakEnd: values.breakEnd || undefined,
      });
      pushToast({
        title: "Attendance saved",
        body: result.message,
        variant: "success",
      });
      setHrFormMode("closed");
      setHrFormRow(null);
      if (year != null && month != null) {
        await loadHistory();
      }
    } catch (err) {
      pushToast({
        title: "Couldn’t save attendance",
        body: toUserFacingActionError(err),
        variant: "error",
      });
    } finally {
      setSavingHrAttendance(false);
    }
  }

  return (
    <div className="w-full">
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,text/csv,text/plain"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleImportFile(file);
        }}
      />

      <AttendanceHistoryView
        isHr={isHr}
        employees={employees}
        selectedSheetRow={selectedSheetRow}
        onEmployeeChange={setSelectedSheetRow}
        periods={periods}
        year={year}
        month={month}
        onYearChange={handleYearChange}
        onMonthChange={setMonth}
        onPeriodChange={handlePeriodChange}
        rows={rows}
        loading={loading}
        importing={importing}
        onImportClick={() => fileInputRef.current?.click()}
        onExport={() =>
          exportCsv(sortedRows, {
            employeeName: selectedEmployee?.name,
            employeeId: selectedEmployee?.employeeId,
            month,
            year,
          })
        }
        canExport={rows.length > 0}
        requestingOvertimeId={requestingOvertimeId}
        onRequestOvertime={(row) => {
          setOvertimeNote("");
          setPendingOvertimeRow(row);
        }}
        hrFormMode={hrFormMode}
        hrFormRow={hrFormRow}
        hrFormDate={defaultHrFormDate()}
        savingHrAttendance={savingHrAttendance}
        onOpenAddAttendance={() => {
          setHrFormRow(null);
          setHrFormMode("add");
        }}
        onOpenEditAttendance={(row) => {
          setHrFormRow(row);
          setHrFormMode("edit");
        }}
        onCloseHrForm={() => {
          setHrFormMode("closed");
          setHrFormRow(null);
        }}
        onSaveHrAttendance={handleSaveHrAttendance}
      />

      <ConfirmationDialog
        open={Boolean(pendingOvertimeRow)}
        title="Request OT approval?"
        description={
          pendingOvertimeRow
            ? `Submit overtime approval for ${pendingOvertimeRow.date}? You can add an optional note for the approver.`
            : ""
        }
        confirmText="Submit request"
        confirmVariant="primary"
        busy={Boolean(requestingOvertimeId)}
        busyText="Requesting…"
        iconContainerClassName="bg-amber-500"
        inputLabel="Optional note for approver"
        inputValue={overtimeNote}
        onInputChange={setOvertimeNote}
        inputPlaceholder="Add a note (optional)"
        onCancel={() => {
          if (requestingOvertimeId) return;
          setPendingOvertimeRow(null);
          setOvertimeNote("");
        }}
        onConfirm={() => {
          if (pendingOvertimeRow) void handleRequestOvertime(pendingOvertimeRow, overtimeNote);
        }}
      />
    </div>
  );
}
