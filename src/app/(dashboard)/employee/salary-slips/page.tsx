"use client";

import { readResponseJson } from "@/lib/api/read-response-json";
import { useCallback, useEffect, useMemo, useState } from "react";

import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { AlertTriangle, RefreshCw, Trash2 } from "lucide-react";
import { DataTable } from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";
import { MonthYearPicker } from "@/components/ui/month-year-picker";
import { Select } from "@/components/ui/select";
import { ROLES } from "@/app/consts/common";
import { useAuth } from "@/contexts/auth-provider";
import { useNotifications } from "@/contexts/notifications-provider";
import { toUserFacingActionError, toUserFacingFetchError } from "@/lib/api/user-facing-error";
import { canManageEmployees } from "@/lib/auth/roles";
import { buildFullMonthYearPeriodOptions } from "@/lib/attendance/period-options";
import { parseEmployeeListApiResponse, pickSheetRowFields } from "@/lib/employee";
import { getDaysInMonth } from "@/lib/payroll/working-days";
import type { Column } from "@/types/table";

type SalarySlipRow = {
  id: string;
  slipId: string;
  title: string;
  status: string;
  netPay: string;
  overtime: string;
  totalPay: string;
  employeeSheetRow: number;
  employeeName?: string;
};

type EmployeeOption = {
  sheetRow: string;
  name: string;
  salary: string;
};

type SalaryHistoryRecord = {
  sheetRow: number;
  employeeSheetRow: number;
  employeeName: string;
  effectiveFrom: string;
  effectiveTo: string;
  basic: number;
  hra: number;
  organizationAllowance: number;
  loyaltyBonus: number;
  professionalTax: number;
  lwf: number;
  status: string;
};

type PendingSalaryRevision = {
  employeeLabel: string;
  currentBasic: number;
  currentPeriod: string;
  newBasic: number;
  newFrom: string;
};

type HistoryTableRow = {
  id: string;
  employee: string;
  totalSalary: string;
  effectiveFrom: string;
  effectiveTo: string;
  period: string;
  loyalty: string;
  professionalTax: string;
  lwf: string;
  status: string;
};

function formatInr(amount: number): string {
  return `Rs. ${Number(amount || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

function parseOnboardingSalary(value: string): string {
  const cleaned = String(value ?? "")
    .replace(/,/g, "")
    .replace(/[^\d.]/g, "")
    .trim();
  if (!cleaned) return "";
  const amount = Number(cleaned);
  if (!Number.isFinite(amount) || amount <= 0) return "";
  return String(amount);
}

function historyTotalSalary(record: {
  basic: number;
  hra: number;
  organizationAllowance: number;
}): number {
  return (
    Number(record.basic || 0) + Number(record.hra || 0) + Number(record.organizationAllowance || 0)
  );
}

function formatDate(value: string): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "—";
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    const [y, m, d] = raw.slice(0, 10).split("-");
    return `${d}/${m}/${y}`;
  }
  return raw;
}

function statusVariant(status: string) {
  if (status === "Active") return "success" as const;
  if (status === "Expired") return "warning" as const;
  return "default" as const;
}

function todayIsoDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function salaryHistoryDisplayStatus(record: SalaryHistoryRecord): string {
  if (String(record.status ?? "").toLowerCase() === "inactive") return "Inactive";
  const from = String(record.effectiveFrom ?? "").slice(0, 10);
  const to = String(record.effectiveTo ?? "").slice(0, 10);
  const today = todayIsoDate();
  if (to && today > to) return "Expired";
  if (from && today < from) return "Upcoming";
  return "Active";
}

/** Active history rows with a usable salary amount. */
function isUsableSalaryHistory(record: SalaryHistoryRecord): boolean {
  return (
    String(record.status ?? "").toLowerCase() === "active" &&
    Boolean(String(record.effectiveFrom ?? "").trim()) &&
    Number(record.basic) > 0
  );
}

function periodBounds(year: number, monthIndex: number): { start: string; end: string } {
  const month = monthIndex + 1;
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const end = `${year}-${String(month).padStart(2, "0")}-${String(getDaysInMonth(year, month)).padStart(2, "0")}`;
  return { start, end };
}

function coversPeriod(record: SalaryHistoryRecord, periodStart: string, periodEnd: string): boolean {
  const from = String(record.effectiveFrom ?? "").slice(0, 10);
  const to = String(record.effectiveTo ?? "").slice(0, 10);
  if (!from) return false;
  if (from > periodEnd) return false;
  if (to && to < periodStart) return false;
  return true;
}

export default function SalarySlipsPage() {
  const { user } = useAuth();
  const { pushToast } = useNotifications();
  const canManage = user ? canManageEmployees(user.role) : false;

  const [slips, setSlips] = useState<SalarySlipRow[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [historyRecords, setHistoryRecords] = useState<SalaryHistoryRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState<number | null>(currentYear);
  const [month, setMonth] = useState<number | null>(null);
  const [targetEmployee, setTargetEmployee] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<SalarySlipRow | null>(null);
  const [deletingSlip, setDeletingSlip] = useState(false);
  const [pendingRevision, setPendingRevision] = useState<PendingSalaryRevision | null>(null);

  const periods = useMemo(() => buildFullMonthYearPeriodOptions(), []);

  const [historyEmployeeSheetRow, setHistoryEmployeeSheetRow] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [basic, setBasic] = useState("");
  const [loyaltyBonus, setLoyaltyBonus] = useState("10");
  const [professionalTax, setProfessionalTax] = useState("200");
  const [lwf, setLwf] = useState("6");

  /** Employees eligible for Generate & Release (must have effective salary for the selected month). */
  const generateEligibleEmployees = useMemo(() => {
    const usable = historyRecords.filter(isUsableSalaryHistory);
    if (year == null || month == null) {
      const sheetRows = new Set(usable.map((r) => r.employeeSheetRow));
      return employees.filter((e) => sheetRows.has(Number(e.sheetRow)));
    }

    const { start, end } = periodBounds(year, month);
    const sheetRows = new Set(
      usable.filter((r) => coversPeriod(r, start, end)).map((r) => r.employeeSheetRow),
    );
    return employees.filter((e) => sheetRows.has(Number(e.sheetRow)));
  }, [employees, historyRecords, year, month]);

  /** Keep selection only while that employee is still eligible for the current filters. */
  const selectedGenerateEmployee = useMemo(() => {
    if (!targetEmployee) return "";
    return generateEligibleEmployees.some((e) => e.sheetRow === targetEmployee)
      ? targetEmployee
      : "";
  }, [generateEligibleEmployees, targetEmployee]);

  const loadSlips = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ mode: "list" });
      if (canManage) {
        if (selectedGenerateEmployee) params.set("employeeSheetRow", selectedGenerateEmployee);
        if (year != null) params.set("year", String(year));
        if (month != null) params.set("month", String(month + 1));
      }

      const res = await fetch(`/api/salary-slips?${params.toString()}`, { credentials: "include" });
      const data = await readResponseJson<{
        success?: boolean;
        message?: string;
        [key: string]: unknown;
      }>(res, "fetch");
      if (!data.success) throw new Error(toUserFacingFetchError(data.message));
      const rows = (data.slips ?? []) as Array<{
        slipId: string;
        title: string;
        status: string;
        netPay: number;
        overtimeAmount?: number;
        totalPay?: number;
        employeeSheetRow: number;
        employeeName: string;
      }>;
      setSlips(
        rows.map((r) => {
          const overtimeAmount = Number(r.overtimeAmount ?? 0);
          const totalPay = Number(r.totalPay ?? 0) || Number(r.netPay ?? 0) + overtimeAmount;
          return {
            id: r.slipId,
            slipId: r.slipId,
            title: r.title,
            status: r.status,
            netPay: `Rs. ${Number(r.netPay ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`,
            overtime: `Rs. ${overtimeAmount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`,
            totalPay: `Rs. ${totalPay.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`,
            employeeSheetRow: r.employeeSheetRow,
            employeeName: r.employeeName,
          };
        }),
      );
    } catch (error) {
      console.error(error);
      pushToast({
        title: "Couldn’t load salary slips",
        body: toUserFacingFetchError(error),
        variant: "error",
      });
    } finally {
      setLoading(false);
    }
  }, [month, selectedGenerateEmployee, year, canManage, pushToast]);

  const loadEmployees = useCallback(async () => {
    if (!canManage) return;
    try {
      const res = await fetch("/api/employee?pageSize=200&status=Active", {
        credentials: "include",
      });
      const data = await readResponseJson<{
        success?: boolean;
        message?: string;
        data?: string[][];
        sheetRows?: number[];
      }>(res, "fetch");
      const list = parseEmployeeListApiResponse(data);
      const headers = (data.data?.[0] as string[] | undefined) ?? [];
      const dataRows = (data.data ?? []).slice(1);
      const sheetRows = data.sheetRows ?? [];
      const salaryBySheetRow = new Map<string, string>();
      dataRows.forEach((row, index) => {
        const sheetRow = String(sheetRows[index] ?? index + 1);
        const fields = pickSheetRowFields(headers, row, ["salary"]);
        salaryBySheetRow.set(sheetRow, parseOnboardingSalary(fields.salary ?? ""));
      });
      setEmployees(
        list
          .filter((e) => e.role.trim().toLowerCase() !== ROLES.SUPER_ADMIN)
          .map((e) => ({
            sheetRow: e.sheetRow,
            name: `${e.name} (${e.employeeId})`,
            salary: salaryBySheetRow.get(e.sheetRow) ?? "",
          }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
    } catch (error) {
      console.error(error);
      pushToast({
        title: "Couldn’t load employees",
        body: toUserFacingFetchError(error),
        variant: "error",
      });
    }
  }, [canManage, pushToast]);

  const loadHistory = useCallback(async () => {
    if (!canManage) return;
    setHistoryLoading(true);
    try {
      const res = await fetch("/api/salary-history", {
        credentials: "include",
        cache: "no-store",
      });
      const data = await readResponseJson<{
        success: boolean;
        message?: string;
        records?: SalaryHistoryRecord[];
      }>(res, "fetch");
      if (!data.success) throw new Error(toUserFacingFetchError(data.message));
      setHistoryRecords(data.records ?? []);
    } catch (error) {
      console.error(error);
      setHistoryRecords([]);
      pushToast({
        title: "Couldn’t load salary history",
        body: toUserFacingFetchError(error),
        variant: "error",
      });
    } finally {
      setHistoryLoading(false);
    }
  }, [canManage, pushToast]);

  // Roster + salary history are relatively stable — load once (not on every period filter change).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadEmployees();
    void loadHistory();
  }, [loadEmployees, loadHistory]);

  // Slip list depends on period / employee filters.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadSlips();
  }, [loadSlips]);

  const handlePeriodChange = (nextYear: number | null, nextMonth: number | null) => {
    setYear(nextYear);
    setMonth(nextMonth);
  };

  const filteredHistoryRecords = useMemo(() => {
    const selected = Number(historyEmployeeSheetRow);
    const rows =
      Number.isInteger(selected) && selected >= 2
        ? historyRecords.filter((r) => r.employeeSheetRow === selected)
        : historyRecords;

    return [...rows]
      .filter((r) => Boolean(r.effectiveFrom) && Number(r.basic) > 0)
      .sort((a, b) => {
        const nameCmp = String(a.employeeName ?? "").localeCompare(String(b.employeeName ?? ""));
        if (nameCmp !== 0) return nameCmp;
        return String(b.effectiveFrom ?? "").localeCompare(String(a.effectiveFrom ?? ""));
      });
  }, [historyEmployeeSheetRow, historyRecords]);

  const historyTableRows: HistoryTableRow[] = useMemo(() => {
    const nameBySheetRow = new Map(employees.map((e) => [Number(e.sheetRow), e.name]));
    return filteredHistoryRecords.map((record, index) => {
      const rosterName = nameBySheetRow.get(record.employeeSheetRow);
      const rawName = String(record.employeeName ?? "").trim();
      const employee =
        rosterName ||
        (rawName && !/^\d{4}-\d{2}-\d{2}/.test(rawName) ? rawName : "") ||
        `Employee #${record.employeeSheetRow}`;

      return {
        id: `${record.sheetRow}-${record.employeeSheetRow}-${record.effectiveFrom}-${index}`,
        employee,
        totalSalary: formatInr(historyTotalSalary(record)),
        effectiveFrom: formatDate(record.effectiveFrom),
        effectiveTo: formatDate(record.effectiveTo),
        period: `${formatDate(record.effectiveFrom)} → ${formatDate(record.effectiveTo)}`,
        loyalty: `${Number(record.loyaltyBonus || 0)}%`,
        professionalTax: formatInr(record.professionalTax),
        lwf: formatInr(record.lwf),
        status: salaryHistoryDisplayStatus(record),
      };
    });
  }, [filteredHistoryRecords, employees]);

  const historyColumns: Column<HistoryTableRow>[] = useMemo(
    () => [
      { key: "employee", header: "Employee", sortable: true },
      { key: "totalSalary", header: "Total Salary" },
      { key: "period", header: "Effective period" },
      { key: "effectiveFrom", header: "Start date" },
      { key: "effectiveTo", header: "End date" },
      { key: "loyalty", header: "Loyalty" },
      { key: "professionalTax", header: "PT" },
      { key: "lwf", header: "LWF" },
      {
        key: "status",
        header: "Status",
        render: (row) => <Badge variant={statusVariant(row.status)}>{row.status}</Badge>,
      },
    ],
    [],
  );

  const generateSlips = async () => {
    if (year == null || month == null) {
      pushToast({
        title: "Select a period",
        body: "Select year and month before generating slips.",
        variant: "error",
      });
      return;
    }

    if (generateEligibleEmployees.length === 0) {
      pushToast({
        title: "No eligible employees",
        body: "No employees have an effective salary covering this period. Add a salary revision first.",
        variant: "error",
      });
      return;
    }

    if (selectedGenerateEmployee) {
      const eligible = generateEligibleEmployees.some(
        (e) => e.sheetRow === selectedGenerateEmployee,
      );
      if (!eligible) {
        pushToast({
          title: "Employee not eligible",
          body: "Selected employee has no effective salary for this period. Choose another employee or add a salary revision.",
          variant: "error",
        });
        return;
      }
    }

    setBusy(true);
    try {
      const payload: Record<string, unknown> = {
        year,
        month: month + 1,
      };
      if (selectedGenerateEmployee) payload.employeeSheetRow = Number(selectedGenerateEmployee);
      const res = await fetch("/api/salary-slips?mode=generate", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await readResponseJson<{
        success?: boolean;
        message?: string;
        generated?: unknown[];
        [key: string]: unknown;
      }>(res, "action");
      if (!data.success) {
        throw new Error(toUserFacingActionError(data.message ?? "Failed to generate salary slips"));
      }
      const count = Array.isArray(data.generated) ? data.generated.length : 0;
      if (count === 0) {
        pushToast({
          title: "No slips generated",
          body: "Employees may already have a slip for this month, or lack effective salary for the period.",
          variant: "error",
        });
      } else {
        pushToast({
          title: "Salary slips released",
          body:
            count === 1
              ? "Generated and released 1 salary slip."
              : `Generated and released ${count} salary slips.`,
          variant: "success",
        });
      }
      await loadSlips();
    } catch (error) {
      pushToast({
        title: "Generate failed",
        body: toUserFacingActionError(error),
        variant: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  const addSalaryHistory = async () => {
    const selectedRow = Number(historyEmployeeSheetRow);
    if (!Number.isInteger(selectedRow) || selectedRow < 2) {
      pushToast({
        title: "Select an employee",
        body: "Choose an employee before saving a salary revision.",
        variant: "error",
      });
      return;
    }
    if (!effectiveFrom.trim()) {
      pushToast({
        title: "Effective date required",
        body: "Select an effective date.",
        variant: "error",
      });
      return;
    }
    const basicAmount = Number(basic || 0);
    if (!(basicAmount > 0)) {
      pushToast({
        title: "Invalid salary",
        body: "Enter a salary greater than 0.",
        variant: "error",
      });
      return;
    }
    const lwfAmount = Number(lwf || 0);
    if (!(lwfAmount > 0)) {
      pushToast({
        title: "Invalid LWF",
        body: "Enter LWF greater than 0.",
        variant: "error",
      });
      return;
    }

    const employeeLabel =
      employees.find((e) => e.sheetRow === historyEmployeeSheetRow)?.name ?? "This employee";

    const existingActive = historyRecords.filter(
      (record) =>
        record.employeeSheetRow === selectedRow &&
        salaryHistoryDisplayStatus(record) === "Active" &&
        Boolean(String(record.effectiveFrom ?? "").trim()),
    );

    if (existingActive.length > 0) {
      const latest = [...existingActive].sort((a, b) =>
        String(b.effectiveFrom).localeCompare(String(a.effectiveFrom)),
      )[0];
      const currentPeriod = `${formatDate(latest.effectiveFrom)} → ${formatDate(latest.effectiveTo)}`;
      setPendingRevision({
        employeeLabel,
        currentBasic: historyTotalSalary(latest),
        currentPeriod,
        newBasic: basicAmount,
        newFrom: formatDate(effectiveFrom),
      });
      return;
    }

    await submitSalaryHistory({
      selectedRow,
      employeeName: employees.find((e) => e.sheetRow === historyEmployeeSheetRow)?.name,
      effectiveFrom,
      basicAmount,
      lwfAmount,
    });
  };

  const submitSalaryHistory = async (payload: {
    selectedRow: number;
    employeeName?: string;
    effectiveFrom: string;
    basicAmount: number;
    lwfAmount: number;
  }) => {
    setBusy(true);
    try {
      const res = await fetch("/api/salary-history", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeSheetRow: payload.selectedRow,
          employeeName: payload.employeeName,
          effectiveFrom: payload.effectiveFrom,
          basic: payload.basicAmount,
          hra: 0,
          organizationAllowance: 0,
          loyaltyBonus: Number(loyaltyBonus || 0),
          professionalTax: Number(professionalTax || 0),
          lwf: payload.lwfAmount,
        }),
      });
      const data = await readResponseJson<{
        success?: boolean;
        message?: string;
        [key: string]: unknown;
      }>(res, "action");
      if (!data.success) {
        throw new Error(toUserFacingActionError(data.message ?? "Failed to save salary history"));
      }
      setPendingRevision(null);
      pushToast({
        title: "Salary revision saved",
        body: "Salary history was updated successfully.",
        variant: "success",
      });
      setEmployees((prev) =>
        prev.map((employee) =>
          employee.sheetRow === String(payload.selectedRow)
            ? { ...employee, salary: String(payload.basicAmount) }
            : employee,
        ),
      );
      setBasic(String(payload.basicAmount));
      setEffectiveFrom("");
      await loadHistory();
    } catch (error) {
      pushToast({
        title: "Save failed",
        body: toUserFacingActionError(error),
        variant: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  const confirmSalaryRevision = async () => {
    const selectedRow = Number(historyEmployeeSheetRow);
    await submitSalaryHistory({
      selectedRow,
      employeeName: employees.find((e) => e.sheetRow === historyEmployeeSheetRow)?.name,
      effectiveFrom,
      basicAmount: Number(basic || 0),
      lwfAmount: Number(lwf || 0),
    });
  };

  const deleteSlip = async (slip: SalarySlipRow) => {
    setDeletingSlip(true);
    try {
      const res = await fetch(`/api/salary-slips?slipId=${encodeURIComponent(slip.slipId)}`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = await readResponseJson<{
        success?: boolean;
        message?: string;
        [key: string]: unknown;
      }>(res, "action");
      if (!data.success) {
        throw new Error(toUserFacingActionError(data.message ?? "Failed to delete slip"));
      }
      setPendingDelete(null);
      pushToast({
        title: "Slip deleted",
        body: "The salary slip was removed.",
        variant: "success",
      });
      await loadSlips();
    } catch (error) {
      pushToast({
        title: "Delete failed",
        body: toUserFacingActionError(error),
        variant: "error",
      });
    } finally {
      setDeletingSlip(false);
    }
  };

  const downloadSlip = (slipId: string) => {
    window.open(`/api/salary-slips/download?slipId=${encodeURIComponent(slipId)}`, "_blank");
  };

  return (
    <div className="space-y-8">
      <PageHeader
        title="Salary Slips"
        description="Pay slips with secure download, month-wise release, and percentage-based deductions."
      />
      {canManage ? (
        <div className="flex flex-wrap items-end gap-4">
          <MonthYearPicker
            year={year}
            month={month}
            periods={periods}
            allowAll
            label="Period"
            onChange={handlePeriodChange}
          />
          <div className="w-auto min-w-48 flex-1 sm:flex-none">
            <label className="text-ex-muted mb-1 block text-xs font-medium">Employee</label>
            <Select
              value={selectedGenerateEmployee}
              onChange={(e) => setTargetEmployee(e.target.value)}
            >
              <option value="">All with effective salary</option>
              {generateEligibleEmployees.map((e) => (
                <option key={e.sheetRow} value={e.sheetRow}>
                  {e.name}
                </option>
              ))}
            </Select>
          </div>
          <Button
            variant="outline"
            onClick={generateSlips}
            disabled={
              busy ||
              year == null ||
              month == null ||
              (year != null && month != null && generateEligibleEmployees.length === 0)
            }
            className="ml-auto"
            style={{ maxWidth: "180px", justifySelf: "end" }}
          >
            {busy ? "Working..." : "Generate & Release"}
          </Button>
        </div>
      ) : null}

      <Card>
        <CardContent className="p-0">
          <DataTable
            loading={loading}
            rows={slips}
            columns={[
              { key: "title", header: "Pay period" },
              ...(canManage ? [{ key: "employeeName" as const, header: "Employee name" }] : []),
              { key: "netPay", header: "Net pay" },
              { key: "overtime", header: "OT" },
              { key: "totalPay", header: "Total pay" },
              { key: "status", header: "Status" },
              {
                key: "slipId",
                header: "Actions",
                render: (row) => (
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => downloadSlip(row.slipId)}>
                      Download
                    </Button>
                    {canManage ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-red-600"
                        disabled={busy || deletingSlip}
                        onClick={() => {
                          setPendingDelete(row);
                        }}
                      >
                        Delete
                      </Button>
                    ) : null}
                  </div>
                ),
              },
            ]}
          />
        </CardContent>
      </Card>

      {canManage ? (
        <Card>
          <CardContent className="space-y-4 p-4">
            <div className="space-y-1">
              <h3 className="text-sm font-semibold">Salary History (Effective Dated)</h3>
              <p className="text-ex-muted text-xs">
                All employees&apos; effective salary periods are listed below. Select an employee to
                filter that list and to add a new revision (replaces their current effective
                salary).
              </p>
            </div>

            <div className="grid gap-3 md:grid-cols-4">
              <div>
                <p className="text-ex-muted mt-1.5 max-w-sm text-sm leading-relaxed">
                  Select Employee
                </p>
                <Select
                  value={historyEmployeeSheetRow}
                  onChange={(e) => {
                    const sheetRow = e.target.value;
                    setHistoryEmployeeSheetRow(sheetRow);
                    const employee = employees.find((item) => item.sheetRow === sheetRow);
                    setBasic(employee?.salary ?? "");
                  }}
                >
                  <option value="">All</option>
                  {employees.map((e) => (
                    <option key={e.sheetRow} value={e.sheetRow}>
                      {e.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <p className="text-ex-muted mt-1.5 max-w-sm text-sm leading-relaxed">
                  Salary effective date for the next 12 months.
                </p>
                <Input
                  type="date"
                  value={effectiveFrom}
                  onChange={(e) => setEffectiveFrom(e.target.value)}
                  disabled={!historyEmployeeSheetRow}
                />
              </div>
              <div>
                <p className="text-ex-muted mt-1.5 max-w-sm text-sm leading-relaxed">
                  Total Salary (Rs.)
                </p>
                <Input
                  value={basic}
                  onChange={(e) => setBasic(e.target.value)}
                  placeholder="Total Salary"
                  disabled={!historyEmployeeSheetRow}
                />
              </div>
              <div>
                <p className="text-ex-muted mt-1.5 max-w-sm text-sm leading-relaxed">
                  Loyalty bonus as a percentage of total salary.
                </p>
                <Select
                  value={loyaltyBonus}
                  onChange={(e) => setLoyaltyBonus(e.target.value)}
                  disabled={!historyEmployeeSheetRow}
                >
                  <option value="5">Loyalty bonus 5%</option>
                  <option value="10">Loyalty bonus 10%</option>
                  <option value="15">Loyalty bonus 15%</option>
                  <option value="20">Loyalty bonus 20%</option>
                </Select>
              </div>

              <div>
                <p className="text-ex-muted mt-1.5 max-w-sm text-sm leading-relaxed">
                  Professional Tax
                </p>

                <Input
                  value={professionalTax}
                  onChange={(e) => setProfessionalTax(e.target.value)}
                  placeholder="Professional Tax"
                  disabled={!historyEmployeeSheetRow}
                />
              </div>
              <div>
                <p className="text-ex-muted mt-1.5 max-w-sm text-sm leading-relaxed">LWF (Rs.)</p>
                <Input
                  value={lwf}
                  onChange={(e) => setLwf(e.target.value)}
                  placeholder="LWF"
                  disabled={!historyEmployeeSheetRow}
                />
              </div>
            </div>
            <Button
              onClick={() => void addSalaryHistory()}
              disabled={busy || !historyEmployeeSheetRow || !effectiveFrom || !basic || !lwf}
            >
              Save salary revision
            </Button>

            <div className="space-y-2 pt-2">
              <div className="flex items-center justify-between gap-3">
                <h4 className="text-ex-primary text-sm font-medium">
                  {historyEmployeeSheetRow
                    ? "Effective Salary For Selected Employee"
                    : "Effective Salary For All Employees"}
                </h4>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={historyLoading || busy}
                  onClick={() => void loadHistory()}
                >
                  <RefreshCw className={`size-4 ${historyLoading ? "animate-spin" : ""}`} />
                  Refresh
                </Button>
              </div>
              <DataTable
                loading={historyLoading}
                columns={historyColumns}
                rows={historyTableRows}
                emptyTitle="No salary history"
                emptyDescription={
                  historyEmployeeSheetRow
                    ? "No effective salary records for this employee yet."
                    : "Save a salary revision to see effective periods here."
                }
              />
            </div>
          </CardContent>
        </Card>
      ) : null}

      <ConfirmationDialog
        open={Boolean(pendingRevision)}
        title="Replace current salary?"
        description={
          pendingRevision ? (
            <>
              <span className="text-ex-primary font-medium">{pendingRevision.employeeLabel}</span>{" "}
              already has an effective salary of {formatInr(pendingRevision.currentBasic)} (
              {pendingRevision.currentPeriod}). If you save, that current effective salary will be
              replaced with {formatInr(pendingRevision.newBasic)} starting {pendingRevision.newFrom}
              .
            </>
          ) : (
            ""
          )
        }
        confirmText="Continue"
        confirmVariant="primary"
        busy={busy}
        busyText="Saving…"
        icon={<AlertTriangle className="size-5 text-white" aria-hidden />}
        iconContainerClassName="bg-amber-500"
        onCancel={() => {
          if (!busy) setPendingRevision(null);
        }}
        onConfirm={() => {
          if (pendingRevision) void confirmSalaryRevision();
        }}
      />

      <ConfirmationDialog
        open={Boolean(pendingDelete)}
        title="Delete salary slip?"
        description={
          pendingDelete ? (
            <>
              Delete the{" "}
              <span className="text-ex-primary font-medium">“{pendingDelete.title}”</span> salary
              slip
              {pendingDelete.employeeName ? (
                <>
                  {" "}
                  for{" "}
                  <span className="text-ex-primary font-medium">{pendingDelete.employeeName}</span>
                </>
              ) : null}
              ? This cannot be undone.
            </>
          ) : (
            ""
          )
        }
        busy={deletingSlip}
        busyText="Deleting…"
        confirmText="Delete"
        onCancel={() => {
          if (!deletingSlip) setPendingDelete(null);
        }}
        onConfirm={() => {
          if (pendingDelete) void deleteSlip(pendingDelete);
        }}
        icon={<Trash2 className="size-5 text-white" aria-hidden />}
      />
    </div>
  );
}
