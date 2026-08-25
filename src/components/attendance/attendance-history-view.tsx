"use client";

import {
  CalendarDays,
  Download,
  Loader2,
  Pencil,
  Plus,
  TrendingDown,
  TrendingUp,
  Upload,
} from "lucide-react";
import { useMemo, useState } from "react";

import {
  HrAttendanceForm,
  type HrAttendanceFormValues,
} from "@/components/attendance/hr-attendance-form";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { MonthYearPicker } from "@/components/ui/month-year-picker";
import { DEFAULT_PAGE_SIZE, Pagination } from "@/components/ui/pagination";
import { Select } from "@/components/ui/select";
import { StatCard } from "@/components/ui/stat-card";
import { IDEAL_WORKING_HOURS } from "@/lib/attendance/constants";
import type { AttendanceHistoryRow, AttendancePeriod } from "@/lib/attendance/client";
import { formatDuration, parseDurationToMs } from "@/lib/attendance/time";
import type { Employee } from "@/types/employee";
import type { SortOrder } from "@/types/table";
import { cn } from "@/lib/utils";

type StatusFilter = "all" | string;

function statusBadgeVariant(status: string) {
  if (status === "Completed" || status === "Overtime Approved") {
    return "success" as const;
  }
  if (
    status === "Short Hours" ||
    status === "OT Approval Requested" ||
    status === "OT Approval Pending" ||
    status === "In Progress" ||
    status === "Overtime Requested"
  ) {
    return "warning" as const;
  }
  if (status === "Overtime Rejected" || status === "Absent") return "danger" as const;
  if (status === "On Leave") return "accent" as const;
  if (status === "Overtime") return "accent" as const;
  return "default" as const;
}

function formatTableDate(dateIso: string): string {
  const d = new Date(`${dateIso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return dateIso;
  return d.toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function formatOvertimeCell(row: AttendanceHistoryRow) {
  const value = (row.overtime ?? "").trim();
  if (!value || value === "—") return <span className="text-ex-muted">—</span>;
  if (value.startsWith("-")) {
    return (
      <span className="font-medium text-amber-700 dark:text-amber-400">
        Early · {value.slice(1)}
      </span>
    );
  }
  return <span className="font-medium text-emerald-700 dark:text-emerald-400">{value}</span>;
}

function canRequestOvertime(row: AttendanceHistoryRow): boolean {
  const overtime = (row.overtime ?? "").trim();
  if (!overtime || overtime === "—" || overtime.startsWith("-")) return false;
  if (!/\d/.test(overtime)) return false;
  if (!row.punchOut?.trim()) return false;
  const status = (row.status ?? "").trim();
  return ![
    "OT Approval Requested",
    "OT Approval Pending",
    "Overtime Requested",
    "Overtime Approved",
    "Overtime Rejected",
  ].includes(status);
}

function computeSummary(rows: AttendanceHistoryRow[]) {
  let completed = 0;
  let short = 0;
  let overtime = 0;
  let overtimeApproved = 0;
  let overtimePending = 0;
  let overtimeRejected = 0;
  let overtimeNotRequested = 0;
  let approvedOvertimeMs = 0;

  for (const row of rows) {
    if (row.status === "Completed") completed++;
    else if (row.status === "Short Hours") short++;
    else if (row.status === "Overtime") overtime++;

    const overtimeApproval = (row.overtimeApproval ?? "Not considered").trim();
    if (overtimeApproval === "Accepted") {
      overtimeApproved++;
      approvedOvertimeMs += Math.max(0, parseDurationToMs(row.overtime ?? ""));
    } else if (overtimeApproval === "Pending") {
      overtimePending++;
    } else if (overtimeApproval === "Rejected") {
      overtimeRejected++;
    } else {
      overtimeNotRequested++;
    }
  }

  return {
    total: rows.length,
    completed,
    short,
    overtime,
    overtimeApproved,
    overtimePending,
    overtimeRejected,
    overtimeNotRequested,
    approvedOvertime: formatDuration(approvedOvertimeMs),
  };
}

export function AttendanceHistoryView({
  isHr,
  employees,
  selectedSheetRow,
  onEmployeeChange,
  periods,
  year,
  month,
  onYearChange,
  onMonthChange,
  onPeriodChange,
  rows,
  loading,
  importing,
  error,
  importMessage,
  onImportClick,
  onExport,
  canExport,
  requestingOvertimeId,
  onRequestOvertime,
  hrFormMode = "closed",
  hrFormRow = null,
  hrFormDate,
  savingHrAttendance = false,
  onOpenAddAttendance,
  onOpenEditAttendance,
  onCloseHrForm,
  onSaveHrAttendance,
}: {
  isHr: boolean;
  employees: Employee[];
  selectedSheetRow: number | null;
  onEmployeeChange: (sheetRow: number) => void;
  periods: AttendancePeriod[];
  year: number | null;
  month: number | null;
  onYearChange: (year: number) => void;
  onMonthChange: (month: number) => void;
  onPeriodChange?: (year: number, month: number) => void;
  rows: AttendanceHistoryRow[];
  loading: boolean;
  importing: boolean;
  error: string | null;
  importMessage: string | null;
  onImportClick: () => void;
  onExport: () => void;
  canExport: boolean;
  requestingOvertimeId?: string | null;
  onRequestOvertime?: (row: AttendanceHistoryRow) => void;
  hrFormMode?: "closed" | "add" | "edit";
  hrFormRow?: AttendanceHistoryRow | null;
  hrFormDate?: string;
  savingHrAttendance?: boolean;
  onOpenAddAttendance?: () => void;
  onOpenEditAttendance?: (row: AttendanceHistoryRow) => void;
  onCloseHrForm?: () => void;
  onSaveHrAttendance?: (values: HrAttendanceFormValues) => Promise<void>;
}) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState("date");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");

  const availableMonths = useMemo(
    () => periods.find((p) => p.year === year)?.months ?? [],
    [periods, year],
  );

  const monthLabel = availableMonths.find((m) => m.month === month)?.label ?? "";

  const filteredRows = useMemo(() => {
    let list = [...rows];
    if (statusFilter !== "all") list = list.filter((r) => r.status === statusFilter);
    list.sort((a, b) => {
      const av = String((a as Record<string, string>)[sortBy] ?? "");
      const bv = String((b as Record<string, string>)[sortBy] ?? "");
      const cmp = av.localeCompare(bv);
      return sortOrder === "asc" ? cmp : -cmp;
    });
    return list;
  }, [rows, statusFilter, sortBy, sortOrder]);

  const summary = useMemo(() => computeSummary(rows), [rows]);

  const paginatedRows = filteredRows.slice(
    (page - 1) * DEFAULT_PAGE_SIZE,
    page * DEFAULT_PAGE_SIZE,
  );
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / DEFAULT_PAGE_SIZE));

  const selectedEmployee = employees.find((e) => Number(e.sheetRow) === selectedSheetRow);

  const statusFilters = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of rows) {
      const key = row.status?.trim() || "Unknown";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    const preferredOrder = [
      "Completed",
      "Short Hours",
      "Overtime",
      "OT Approval Requested",
      "Overtime Approved",
      "Overtime Rejected",
      "Overtime Requested",
      "OT Approval Pending",
      "In Progress",
      "On Leave",
      "Absent",
      "Unknown",
    ];

    const ordered = [...counts.entries()].sort((a, b) => {
      const ai = preferredOrder.indexOf(a[0]);
      const bi = preferredOrder.indexOf(b[0]);
      if (ai !== -1 || bi !== -1) {
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return ai - bi;
      }
      return a[0].localeCompare(b[0]);
    });

    return [
      { id: "all" as StatusFilter, label: "All", count: rows.length },
      ...ordered.map(([id, count]) => ({ id, label: id, count })),
    ];
  }, [rows]);

  function handleSort(key: string) {
    if (sortBy === key) {
      setSortOrder((o) => (o === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(key);
      setSortOrder("asc");
    }
  }

  const tableEmpty =
    !loading && filteredRows.length === 0 && (rows.length === 0 || statusFilter !== "all");

  return (
    <div className="space-y-6">
      <div className="border-ex-border via-ex-elevated to-ex-elevated relative z-10 overflow-visible rounded-2xl border bg-gradient-to-br from-teal-500/10 p-5 sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="text-ex-muted flex items-center gap-2">
              <CalendarDays className="size-4" aria-hidden />
              <span className="text-sm font-medium">Attendance history</span>
            </div>
            <h1 className="text-ex-primary mt-1 text-2xl font-bold tracking-tight sm:text-3xl">
              {monthLabel && year != null ? `${monthLabel} ${year}` : "Your attendance"}
            </h1>
            <p className="text-ex-muted mt-1 max-w-xl text-sm">
              {isHr
                ? "Review punch times, work hours, and daily updates. Import legacy CSV when needed."
                : `Monthly log of punch in/out, break, daily updates, and ${IDEAL_WORKING_HOURS}h work target.`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {isHr ? (
              <Badge
                variant="default"
                className="max-w-[240px] overflow-hidden text-ellipsis whitespace-nowrap"
                title={
                  selectedEmployee
                    ? `Target: ${selectedEmployee.name}${selectedEmployee.employeeId ? ` (${selectedEmployee.employeeId})` : ""}`
                    : "Target: Select employee"
                }
              >
                {selectedEmployee
                  ? `Target: ${selectedEmployee.name}${selectedEmployee.employeeId ? ` (${selectedEmployee.employeeId})` : ""}`
                  : "Target: Select employee"}
              </Badge>
            ) : null}
            {isHr ? (
              <Button
                variant="outline"
                size="sm"
                className="bg-ex-elevated/80 gap-2"
                disabled={selectedSheetRow == null || savingHrAttendance}
                onClick={onOpenAddAttendance}
                title={
                  selectedEmployee
                    ? `Add attendance for ${selectedEmployee.name}`
                    : "Select an employee to add attendance"
                }
              >
                <Plus className="size-4" />
                Add attendance
              </Button>
            ) : null}
            {isHr ? (
              <Button
                variant="outline"
                size="sm"
                className="bg-ex-elevated/80 gap-2"
                disabled={importing || selectedSheetRow == null}
                onClick={onImportClick}
                title={
                  selectedEmployee
                    ? `Import attendance CSV for ${selectedEmployee.name}`
                    : "Select an employee to import attendance CSV"
                }
              >
                {importing ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Upload className="size-4" />
                )}
                Import CSV
              </Button>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              className="bg-ex-elevated/80 gap-2"
              disabled={!canExport}
              onClick={onExport}
              title={
                isHr && selectedEmployee
                  ? `Export attendance CSV for ${selectedEmployee.name}`
                  : "Export attendance CSV"
              }
            >
              <Download className="size-4" />
              Export CSV
            </Button>
          </div>
        </div>

        <div className="border-ex-border/60 mt-5 flex flex-col gap-3 border-t pt-5 sm:flex-row sm:flex-wrap sm:items-end">
          {isHr ? (
            <div className="min-w-[200px] flex-1 sm:max-w-xs">
              <label className="text-ex-muted mb-1 block text-xs font-medium">Employee</label>
              <Select
                value={selectedSheetRow ?? ""}
                onChange={(e) => {
                  onEmployeeChange(parseInt(e.target.value, 10));
                  setPage(1);
                }}
              >
                {employees.map((emp) => (
                  <option key={emp.sheetRow} value={emp.sheetRow}>
                    {emp.name}
                    {emp.employeeId ? ` · ${emp.employeeId}` : ""}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}
          <MonthYearPicker
            year={year}
            month={month}
            periods={periods}
            disabled={periods.length === 0}
            onChange={(nextYear, nextMonth) => {
              if (nextYear == null || nextMonth == null) return;
              if (onPeriodChange) {
                onPeriodChange(nextYear, nextMonth);
              } else {
                onYearChange(nextYear);
                onMonthChange(nextMonth);
              }
              setPage(1);
            }}
          />
        </div>
      </div>

      {importMessage ? (
        <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
          {importMessage}
        </p>
      ) : null}

      {isHr && hrFormMode !== "closed" && onSaveHrAttendance ? (
        <HrAttendanceForm
          key={`${hrFormMode}-${hrFormRow?.id ?? hrFormDate ?? "new"}`}
          employeeLabel={
            selectedEmployee
              ? `${selectedEmployee.name}${selectedEmployee.employeeId ? ` (${selectedEmployee.employeeId})` : ""}`
              : undefined
          }
          initialDate={hrFormDate}
          initialRow={hrFormMode === "edit" ? hrFormRow : null}
          submitting={savingHrAttendance}
          onSubmit={onSaveHrAttendance}
          onCancel={onCloseHrForm}
        />
      ) : null}

      {error ? (
        <p className="border-ex-banner-danger-border bg-ex-banner-danger-bg text-ex-banner-danger-fg rounded-xl border px-4 py-3 text-sm">
          {error}
        </p>
      ) : null}

      {!loading && rows.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Days logged" value={String(summary.total)} hint="This month" />
          <StatCard
            label="Completed"
            value={String(summary.completed)}
            hint={`${IDEAL_WORKING_HOURS}h target met`}
          />
          <StatCard
            label="Approved overtime"
            value={summary.approvedOvertime}
            hint="Accepted this month"
          />
          <StatCard
            label="OT approved days"
            value={String(summary.overtimeApproved)}
            hint="Rows approved"
          />
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {statusFilters.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => {
              setStatusFilter(f.id);
              setPage(1);
            }}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition",
              statusFilter === f.id
                ? "border-ex-secondary bg-ex-secondary/15 text-ex-primary"
                : "border-ex-border bg-ex-elevated text-ex-muted hover:border-ex-secondary/30 hover:text-ex-primary",
            )}
          >
            {f.id === "Overtime" || f.id === "Overtime Approved" ? (
              <TrendingUp className="size-3.5" aria-hidden />
            ) : f.id === "Short Hours" || f.id === "Overtime Rejected" ? (
              <TrendingDown className="size-3.5" aria-hidden />
            ) : null}
            {f.label}
            <span
              className={cn(
                "rounded-full px-1.5 py-0.5 text-xs tabular-nums",
                statusFilter === f.id ? "bg-ex-secondary/20" : "bg-ex-surface",
              )}
            >
              {f.count}
            </span>
          </button>
        ))}
      </div>

      <div className="space-y-4">
        <DataTable
          loading={loading}
          rows={tableEmpty ? [] : paginatedRows}
          sortBy={sortBy}
          sortOrder={sortOrder}
          onSort={handleSort}
          className="rounded-2xl"
          emptyTitle="No attendance records"
          emptyDescription={
            rows.length === 0
              ? isHr
                ? "Import a legacy CSV (Date, Work Mode, In Time, Out Time) or choose another month."
                : "Punch in to build your history, or select a month with data."
              : "No rows match this filter."
          }
          emptyAction={
            isHr && rows.length === 0 ? (
              <Button variant="outline" className="gap-2" onClick={onImportClick}>
                <Upload className="size-4" />
                Import CSV
              </Button>
            ) : undefined
          }
          columns={[
            {
              key: "date",
              header: "Date",
              sortable: true,
              render: (r) => <span className="font-medium">{formatTableDate(r.date)}</span>,
            },
            {
              key: "workMode",
              header: "Work mode",
              sortable: true,
              className: "min-w-[150px] whitespace-normal",
              render: (r) => r.workMode?.trim() || <span className="text-ex-muted">—</span>,
            },
            {
              key: "punchIn",
              header: "In",
              sortable: true,
              className: "tabular-nums",
            },
            {
              key: "punchOut",
              header: "Out",
              sortable: true,
              className: "tabular-nums",
            },
            {
              key: "breakTime",
              header: "Break",
              sortable: true,
              className: "tabular-nums",
            },
            {
              key: "workingHours",
              header: "Work",
              sortable: true,
              className: "tabular-nums font-medium",
            },
            {
              key: "overtime",
              header: "Extra / short",
              sortable: true,
              render: (r) => formatOvertimeCell(r),
            },
            {
              key: "status",
              header: "Status",
              sortable: true,
              render: (r) => (
                <Badge variant={statusBadgeVariant(r.status)}>{r.status || "—"}</Badge>
              ),
            },
            {
              key: "earlyLeaveReason",
              header: "Early leave reason",
              sortable: false,
              className: "min-w-[150px] max-w-[220px] whitespace-normal",
              render: (r) =>
                r.earlyLeaveReason?.trim() ? (
                  <span className="text-ex-muted line-clamp-2 text-sm" title={r.earlyLeaveReason}>
                    {r.earlyLeaveReason}
                  </span>
                ) : (
                  <span className="text-ex-muted">—</span>
                ),
            },
            {
              key: "dailyUpdate",
              header: "Daily update",
              sortable: false,
              className: "min-w-[150px] max-w-[280px] whitespace-normal",
              render: (r) =>
                r.dailyUpdate?.trim() ? (
                  <span className="text-ex-muted line-clamp-2 text-sm" title={r.dailyUpdate}>
                    {r.dailyUpdate}
                  </span>
                ) : (
                  <span className="text-ex-muted">—</span>
                ),
            },
            {
              key: "actions",
              header: "Actions",
              sortable: false,
              sticky: "right",
              render: (r) => (
                <div className="flex flex-wrap gap-2">
                  {isHr && onOpenEditAttendance ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={savingHrAttendance}
                      onClick={() => onOpenEditAttendance(r)}
                    >
                      <Pencil className="size-3.5" />
                      Edit
                    </Button>
                  ) : null}
                  {onRequestOvertime && canRequestOvertime(r) ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={requestingOvertimeId === r.id}
                      onClick={() => onRequestOvertime(r)}
                    >
                      {requestingOvertimeId === r.id ? "Requesting..." : "Request OT Approval"}
                    </Button>
                  ) : null}
                  {!isHr && !(onRequestOvertime && canRequestOvertime(r)) ? (
                    <span className="text-ex-muted">—</span>
                  ) : null}
                </div>
              ),
            },
          ]}
        />

        {!loading && filteredRows.length > DEFAULT_PAGE_SIZE ? (
          <Pagination
            pagination={{
              page,
              totalPages,
              total: filteredRows.length,
              pageSize: DEFAULT_PAGE_SIZE,
            }}
            onPageChange={setPage}
          />
        ) : null}
      </div>
    </div>
  );
}
