"use client";

import { readResponseJson } from "@/lib/api/read-response-json";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Pencil, Plus, RefreshCw, Trash2, X } from "lucide-react";

import { AccessDenied } from "@/components/ui/access-denied";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { ROLES } from "@/app/consts/common";
import { useAuth } from "@/contexts/auth-provider";
import { useNotifications } from "@/contexts/notifications-provider";
import { canManageEmployees } from "@/lib/auth/roles";
import { toUserFacingActionError, toUserFacingFetchError } from "@/lib/api/user-facing-error";
import { parseEmployeeListApiResponse } from "@/lib/employee";
import type { Column } from "@/types/table";

type EmployeeOption = {
  sheetRow: number;
  employeeId: string;
  name: string;
};

type AdvanceInstallment = { year: number; month: number; amount: number };

type AdvanceRow = {
  id: string;
  employeeSheetRow: number;
  employeeId: string;
  employeeName: string;
  totalAmount: number;
  reason: string;
  startYear: number;
  startMonth: number;
  installments: AdvanceInstallment[];
  status: string;
  paidAmount: number;
  remainingAmount: number;
  installmentCount: number;
  createdAt: string;
};

type PreviewWindow = {
  employeeName: string;
  lastIncrementDate: string;
  joiningDate: string;
  nextIncrementDate: string;
  availableMonthCount: number;
  defaultStart: { year: number; month: number };
  availableMonths: Array<{ year: number; month: number }>;
  selectableStartMonths: Array<{ year: number; month: number }>;
};

type ScheduleSegment = { months: string; amountPerMonth: string };

type TableRow = {
  id: string;
  employee: string;
  total: string;
  schedule: string;
  paid: string;
  remaining: string;
  status: string;
  reason: string;
};

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

function formatInr(amount: number): string {
  return `Rs. ${amount.toLocaleString("en-IN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

function statusVariant(status: string) {
  if (status === "Active") return "success" as const;
  if (status === "Cancelled") return "danger" as const;
  return "warning" as const;
}

function currentYearMonth() {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

function compareYm(a: { year: number; month: number }, b: { year: number; month: number }): number {
  if (a.year !== b.year) return a.year - b.year;
  return a.month - b.month;
}

function splitLockedOpen(installments: AdvanceInstallment[]) {
  const current = currentYearMonth();
  const locked = installments.filter((row) => compareYm(row, current) < 0);
  const open = installments.filter((row) => compareYm(row, current) >= 0);
  const lockedTotal = locked.reduce((sum, row) => sum + row.amount, 0);
  const openTotal = open.reduce((sum, row) => sum + row.amount, 0);
  return { locked, open, lockedTotal, openTotal };
}

function installmentsToFormSegments(installments: AdvanceInstallment[]): ScheduleSegment[] {
  if (!installments.length) return [{ months: "1", amountPerMonth: "" }];
  const segments: Array<{ months: number; amountPerMonth: number }> = [];
  for (const row of installments) {
    const last = segments[segments.length - 1];
    if (last && last.amountPerMonth === row.amount) {
      last.months += 1;
    } else {
      segments.push({ months: 1, amountPerMonth: row.amount });
    }
  }
  return segments.map((segment) => ({
    months: String(segment.months),
    amountPerMonth: String(segment.amountPerMonth),
  }));
}

export default function SalaryAdvancesPage() {
  const { user, loading: authLoading } = useAuth();
  const { pushToast } = useNotifications();
  const canManage = user ? canManageEmployees(user.role) : false;

  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [advances, setAdvances] = useState<AdvanceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [employeeSheetRow, setEmployeeSheetRow] = useState("");
  const [totalAmount, setTotalAmount] = useState("");
  const [lockedTotal, setLockedTotal] = useState(0);
  const [reason, setReason] = useState("");
  const [startYear, setStartYear] = useState<number | null>(null);
  const [startMonth, setStartMonth] = useState<number | null>(null);
  const [segments, setSegments] = useState<ScheduleSegment[]>([
    { months: "5", amountPerMonth: "10000" },
  ]);
  const [preview, setPreview] = useState<PreviewWindow | null>(null);

  const isEditing = Boolean(editingId);
  const scheduleTarget = isEditing
    ? Math.round((Number(totalAmount) - lockedTotal) * 100) / 100
    : Number(totalAmount) || 0;

  const loadAdvances = useCallback(async () => {
    const res = await fetch("/api/salary-advances", { credentials: "include", cache: "no-store" });
    const json = await readResponseJson<{
      success: boolean;
      message?: string;
      advances?: AdvanceRow[];
    }>(res, "fetch");
    if (!json.success) throw new Error(json.message ?? "Failed to load advances");
    setAdvances(json.advances ?? []);
  }, []);

  const loadEmployees = useCallback(async () => {
    const res = await fetch("/api/employee?pageSize=200&status=Active", {
      credentials: "include",
      cache: "no-store",
    });
    const json = await readResponseJson<{
      success?: boolean;
      message?: string;
      data?: string[][];
      sheetRows?: number[];
    }>(res, "fetch");
    const list = parseEmployeeListApiResponse(json);
    setEmployees(
      list
        .filter((row) => row.role.trim().toLowerCase() !== ROLES.SUPER_ADMIN)
        .map((row) => ({
          sheetRow: Number(row.sheetRow),
          employeeId: row.employeeId,
          name: row.name,
        }))
        .filter((row) => Number.isInteger(row.sheetRow) && row.sheetRow >= 2 && row.name.trim())
        .sort((a, b) => a.name.localeCompare(b.name)),
    );
  }, []);

  const resetForm = useCallback(() => {
    setEditingId(null);
    setEmployeeSheetRow("");
    setTotalAmount("");
    setLockedTotal(0);
    setReason("");
    setStartYear(null);
    setStartMonth(null);
    setSegments([{ months: "5", amountPerMonth: "10000" }]);
    setPreview(null);
  }, []);

  const refresh = useCallback(async () => {
    if (!canManage) return;
    setLoading(true);
    try {
      await Promise.all([loadAdvances(), loadEmployees()]);
    } catch (err) {
      pushToast({
        title: "Couldn’t load salary advances",
        body: toUserFacingFetchError(err),
        variant: "error",
      });
    } finally {
      setLoading(false);
    }
  }, [canManage, loadAdvances, loadEmployees, pushToast]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial / refresh load
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!employeeSheetRow) return;

    let cancelled = false;
    void (async () => {
      try {
        const params = new URLSearchParams({
          previewEmployeeSheetRow: employeeSheetRow,
        });
        if (startYear && startMonth) {
          params.set("startYear", String(startYear));
          params.set("startMonth", String(startMonth));
        }
        const res = await fetch(`/api/salary-advances?${params.toString()}`, {
          credentials: "include",
          cache: "no-store",
        });
        const json = await readResponseJson<{
          success: boolean;
          message?: string;
          preview?: PreviewWindow;
        }>(res, "fetch");
        if (!cancelled) {
          if (!json.success) throw new Error(json.message ?? "Failed to load employee window");
          const nextPreview = json.preview ?? null;
          setPreview(nextPreview);
          if (nextPreview && (startYear == null || startMonth == null)) {
            setStartYear(nextPreview.defaultStart.year);
            setStartMonth(nextPreview.defaultStart.month);
          }
        }
      } catch (err) {
        if (!cancelled) {
          setPreview(null);
          pushToast({
            title: "Couldn’t load employee window",
            body: toUserFacingFetchError(err),
            variant: "error",
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [employeeSheetRow, startYear, startMonth, pushToast]);

  const scheduleTotal = useMemo(() => {
    return segments.reduce((sum, segment) => {
      const months = Number(segment.months) || 0;
      const amount = Number(segment.amountPerMonth) || 0;
      return sum + months * amount;
    }, 0);
  }, [segments]);

  const tableRows: TableRow[] = useMemo(() => {
    return advances.map((advance) => ({
      id: advance.id,
      employee: `${advance.employeeName}${advance.employeeId ? ` (${advance.employeeId})` : ""}`,
      total: formatInr(advance.totalAmount),
      schedule: `${advance.installmentCount} mo from ${MONTHS[advance.startMonth - 1]} ${advance.startYear}`,
      paid: formatInr(advance.paidAmount),
      remaining: formatInr(advance.remainingAmount),
      status: advance.status,
      reason: advance.reason || "—",
    }));
  }, [advances]);

  const beginEdit = useCallback(
    (advance: AdvanceRow) => {
      const {
        locked,
        open,
        lockedTotal: lockedSum,
        openTotal,
      } = splitLockedOpen(advance.installments);
      if (openTotal <= 0 && locked.length === advance.installments.length) {
        pushToast({
          title: "Nothing left to edit",
          body: "All installments are in past months.",
          variant: "error",
        });
        return;
      }

      setEditingId(advance.id);
      setShowForm(true);
      setEmployeeSheetRow(String(advance.employeeSheetRow));
      setTotalAmount(String(advance.totalAmount));
      setLockedTotal(lockedSum);
      setReason(advance.reason);
      setSegments(installmentsToFormSegments(open.length ? open : advance.installments));

      const firstOpen = open[0];
      if (firstOpen) {
        setStartYear(firstOpen.year);
        setStartMonth(firstOpen.month);
      } else {
        const next = currentYearMonth();
        setStartYear(next.year);
        setStartMonth(next.month);
      }
    },
    [pushToast],
  );

  const cancelAdvance = useCallback(
    async (id: string) => {
      if (
        !window.confirm("Cancel this salary advance? Future payroll months will stop deducting it.")
      ) {
        return;
      }
      setSaving(true);
      try {
        const res = await fetch("/api/salary-advances", {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, action: "cancel" }),
        });
        const json = await readResponseJson<{ success: boolean; message?: string }>(res, "action");
        if (!json.success) throw new Error(json.message ?? "Failed to cancel advance");
        if (editingId === id) {
          setShowForm(false);
          resetForm();
        }
        pushToast({
          title: "Advance cancelled",
          body: "Future payroll months will no longer deduct this advance.",
          variant: "success",
        });
        await loadAdvances();
      } catch (err) {
        pushToast({
          title: "Cancel failed",
          body: toUserFacingActionError(err),
          variant: "error",
        });
      } finally {
        setSaving(false);
      }
    },
    [editingId, loadAdvances, pushToast, resetForm],
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        reason,
        startYear: startYear ?? preview?.defaultStart.year,
        startMonth: startMonth ?? preview?.defaultStart.month,
        segments: segments.map((segment) => ({
          months: Number(segment.months),
          amountPerMonth: Number(segment.amountPerMonth),
        })),
      };

      const res = await fetch("/api/salary-advances", {
        method: isEditing ? "PATCH" : "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isEditing
            ? { id: editingId, action: "update", ...payload }
            : {
                employeeSheetRow: Number(employeeSheetRow),
                totalAmount: Number(totalAmount),
                ...payload,
              },
        ),
      });
      const json = await readResponseJson<{ success: boolean; message?: string }>(res, "action");
      if (!json.success) {
        throw new Error(
          json.message ?? (isEditing ? "Failed to update advance" : "Failed to create advance"),
        );
      }

      pushToast({
        title: isEditing ? "Advance updated" : "Advance created",
        body: isEditing
          ? "The repayment schedule was saved."
          : "The salary advance was created successfully.",
        variant: "success",
      });
      setShowForm(false);
      resetForm();
      await loadAdvances();
    } catch (err) {
      pushToast({
        title: isEditing ? "Update failed" : "Create failed",
        body: toUserFacingActionError(
          err instanceof Error
            ? err
            : isEditing
              ? "Failed to update advance"
              : "Failed to create advance",
        ),
        variant: "error",
      });
    } finally {
      setSaving(false);
    }
  }

  const columns: Column<TableRow>[] = useMemo(
    () => [
      { key: "employee", header: "Employee", sortable: true },
      { key: "total", header: "Advance" },
      { key: "schedule", header: "Schedule" },
      { key: "paid", header: "Recovered" },
      { key: "remaining", header: "Remaining" },
      {
        key: "status",
        header: "Status",
        render: (row) => <Badge variant={statusVariant(row.status)}>{row.status}</Badge>,
      },
      { key: "reason", header: "Reason" },
      {
        key: "id",
        header: "Actions",
        render: (row) => {
          const advance = advances.find((item) => item.id === row.id);
          if (!advance || advance.status !== "Active") {
            return <span className="text-ex-muted">—</span>;
          }
          return (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={saving}
                onClick={() => beginEdit(advance)}
              >
                <Pencil className="size-4" />
                Edit
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={saving}
                onClick={() => void cancelAdvance(advance.id)}
              >
                <Trash2 className="size-4" />
                Cancel
              </Button>
            </div>
          );
        },
      },
    ],
    [advances, saving, beginEdit, cancelAdvance],
  );

  if (authLoading) return null;

  if (!canManage) {
    return (
      <div className="space-y-8">
        <PageHeader
          title="Salary advances"
          description="Recover employee salary advances through monthly payroll deductions."
        />
        <AccessDenied
          description="Only HR and Super Admin can manage salary advances."
          action={
            <Link href="/dashboard">
              <Button variant="outline" size="sm">
                <ArrowLeft className="size-4" />
                Back to overview
              </Button>
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Salary Advances"
        description="Give an employee an advance and recover it automatically from upcoming monthly payrolls, within their increment window."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="md"
              onClick={() => void refresh()}
              disabled={loading || saving}
            >
              <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button
              size="md"
              onClick={() => {
                if (showForm) {
                  setShowForm(false);
                  resetForm();
                } else {
                  resetForm();
                  setShowForm(true);
                }
              }}
              disabled={saving}
            >
              {showForm ? <X className="size-4" /> : <Plus className="size-4" />}
              {showForm ? "Close Form" : "New Advance"}
            </Button>
          </div>
        }
      />

      {showForm ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {isEditing ? "Edit salary advance schedule" : "Create salary advance"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={(e) => void handleSubmit(e)} className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="advance-employee">Employee</Label>
                  <Select
                    id="advance-employee"
                    required
                    value={employeeSheetRow}
                    onChange={(e) => {
                      setEmployeeSheetRow(e.target.value);
                      setPreview(null);
                      setStartYear(null);
                      setStartMonth(null);
                    }}
                    disabled={saving || isEditing}
                  >
                    <option value="">Select</option>
                    {employees.map((employee) => (
                      <option key={employee.sheetRow} value={String(employee.sheetRow)}>
                        {employee.name}
                        {employee.employeeId ? ` (${employee.employeeId})` : ""}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="advance-amount">
                    {isEditing ? "Original advance (Rs.)" : "Advance amount (Rs.)"}
                  </Label>
                  <Input
                    id="advance-amount"
                    type="number"
                    min={1}
                    step="1"
                    required
                    value={totalAmount}
                    onChange={(e) => setTotalAmount(e.target.value)}
                    disabled={saving || isEditing}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="advance-reason">Reason</Label>
                <Input
                  id="advance-reason"
                  required
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Family emergency, medical, etc."
                  disabled={saving}
                />
              </div>

              {isEditing ? (
                <div className="border-ex-border bg-ex-surface/40 rounded-xl border px-4 py-3 text-sm">
                  <p className="text-ex-muted">
                    Already locked (past months):{" "}
                    <span className="text-ex-primary font-medium">{formatInr(lockedTotal)}</span>
                  </p>
                  <p className="text-ex-muted mt-1">
                    Remaining to reschedule:{" "}
                    <span className="text-ex-primary font-medium">{formatInr(scheduleTarget)}</span>
                  </p>
                  <p className="text-ex-muted mt-1 text-xs">
                    Past payroll months stay as-is. Change months and monthly amounts for the
                    remaining balance only (e.g. fewer months with a higher monthly deduction).
                  </p>
                </div>
              ) : null}

              {preview ? (
                <div className="border-ex-border bg-ex-surface/40 space-y-3 rounded-xl border px-4 py-3 text-sm">
                  <p className="text-ex-primary font-medium">{preview.employeeName}</p>
                  <p className="text-ex-muted">
                    Last increment: {preview.lastIncrementDate || "—"} · Joining:{" "}
                    {preview.joiningDate || "—"}
                  </p>
                  <p className="text-ex-muted">
                    Next increment: {preview.nextIncrementDate || "—"} · Available repayment months
                    from selected start:{" "}
                    <span className="text-ex-primary font-medium">
                      {preview.availableMonthCount}{" "}
                      {preview.availableMonthCount === 1 ? "month" : "months"}
                    </span>
                  </p>
                  <div className="space-y-2">
                    <Label htmlFor="advance-start">
                      {isEditing ? "Reschedule from month" : "Deduction start month"}
                    </Label>
                    <Select
                      id="advance-start"
                      required
                      value={startYear && startMonth ? `${startYear}-${startMonth}` : ""}
                      onChange={(e) => {
                        const [y, m] = e.target.value.split("-").map(Number);
                        setStartYear(y);
                        setStartMonth(m);
                      }}
                      disabled={saving}
                    >
                      <option value="">Select start month</option>
                      {(preview.selectableStartMonths ?? []).map((row) => (
                        <option key={`${row.year}-${row.month}`} value={`${row.year}-${row.month}`}>
                          {MONTHS[row.month - 1]} {row.year}
                          {row.year === preview.defaultStart.year &&
                          row.month === preview.defaultStart.month
                            ? " (next month · default)"
                            : ""}
                        </option>
                      ))}
                    </Select>
                  </div>
                </div>
              ) : null}

              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <Label>{isEditing ? "Updated repayment schedule" : "Repayment schedule"}</Label>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={saving}
                    onClick={() =>
                      setSegments((prev) => [...prev, { months: "1", amountPerMonth: "5000" }])
                    }
                  >
                    Add segment
                  </Button>
                </div>
                {segments.map((segment, index) => (
                  <div key={`segment-${index}`} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
                    <div className="space-y-1">
                      <Label htmlFor={`seg-months-${index}`}>Months</Label>
                      <Input
                        id={`seg-months-${index}`}
                        type="number"
                        min={1}
                        required
                        value={segment.months}
                        onChange={(e) =>
                          setSegments((prev) =>
                            prev.map((row, i) =>
                              i === index ? { ...row, months: e.target.value } : row,
                            ),
                          )
                        }
                        disabled={saving}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={`seg-amount-${index}`}>Amount / month (Rs.)</Label>
                      <Input
                        id={`seg-amount-${index}`}
                        type="number"
                        min={1}
                        required
                        value={segment.amountPerMonth}
                        onChange={(e) =>
                          setSegments((prev) =>
                            prev.map((row, i) =>
                              i === index ? { ...row, amountPerMonth: e.target.value } : row,
                            ),
                          )
                        }
                        disabled={saving}
                      />
                    </div>
                    <div className="flex items-end">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={saving || segments.length <= 1}
                        onClick={() => setSegments((prev) => prev.filter((_, i) => i !== index))}
                      >
                        Remove
                      </Button>
                    </div>
                  </div>
                ))}
                <p className="text-ex-muted text-xs">
                  Schedule total:{" "}
                  <span className="text-ex-primary font-medium">{formatInr(scheduleTotal)}</span>
                  {scheduleTarget > 0
                    ? ` · Must equal ${formatInr(scheduleTarget)}${isEditing ? " remaining" : ""}`
                    : null}
                  .
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button type="submit" size="sm" disabled={saving}>
                  {saving ? "Saving…" : isEditing ? "Update schedule" : "Save advance"}
                </Button>
                {isEditing ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={saving}
                    onClick={() => {
                      setShowForm(false);
                      resetForm();
                    }}
                  >
                    Discard
                  </Button>
                ) : null}
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <div className="space-y-3">
        <h2 className="text-ex-primary text-base font-semibold">Active & Past Advances</h2>
        <DataTable
          columns={columns}
          rows={tableRows}
          loading={loading}
          emptyTitle="No salary advances"
          emptyDescription="Create an advance to recover it automatically from monthly payroll."
        />
      </div>
    </div>
  );
}
