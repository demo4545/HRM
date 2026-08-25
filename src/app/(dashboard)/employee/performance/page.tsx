"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, RefreshCw } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { ROLES } from "@/app/consts/common";
import { AccessDenied } from "@/components/ui/access-denied";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MonthYearPicker } from "@/components/ui/month-year-picker";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCard } from "@/components/ui/stat-card";
import { useAuth } from "@/contexts/auth-provider";
import { readResponseJson } from "@/lib/api/read-response-json";
import { toUserFacingFetchError } from "@/lib/api/user-facing-error";
import { buildAttendancePeriodOptions, clampMonthForYear } from "@/lib/attendance/period-options";
import { canManageEmployees } from "@/lib/auth/roles";
import { parseEmployeeListApiResponse } from "@/lib/employee";
import type {
  EmployeePerformanceSummary,
  HoursPoint,
  NamedCount,
} from "@/lib/employee/performance";

type EmployeeOption = {
  sheetRow: string;
  name: string;
};

type PerformanceResponse = {
  success: boolean;
  message?: string;
  employee?: {
    sheetRow: number;
    employeeId: string;
    name: string;
    position: string;
    joiningDate: string;
    status: string;
  };
  period?: { year: number; month: number | null };
  summary?: EmployeePerformanceSummary;
  leave?: { acceptedDays: number; pendingCount: number };
};

const CHART_COLORS = [
  "var(--ex-chart-1)",
  "var(--ex-chart-2)",
  "var(--ex-chart-3)",
  "var(--ex-chart-4)",
  "var(--ex-chart-5)",
];

const EMPTY_SUMMARY: EmployeePerformanceSummary = {
  presentDays: 0,
  leaveDays: 0,
  absentDays: 0,
  holidayDays: 0,
  shortHoursDays: 0,
  overtimeDays: 0,
  completedDays: 0,
  inProgressDays: 0,
  autoPunchOutDays: 0,
  workedMs: 0,
  overtimeMs: 0,
  approvedOvertimeMs: 0,
  avgWorkedMs: 0,
  workedLabel: "0h 0m",
  overtimeLabel: "0h 0m",
  approvedOvertimeLabel: "0h 0m",
  avgWorkedLabel: "0h 0m",
  hoursSeries: [],
  workModeMix: [],
  statusMix: [],
  leaveMix: [],
};

const EMPTY_MIX: NamedCount[] = [{ name: " ", value: 1 }];

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number | string; color?: string }>;
  label?: string | number;
}) {
  if (!active || !payload?.length) return null;

  return (
    <div className="border-ex-border bg-ex-elevated text-ex-primary rounded-xl border px-3 py-2 text-sm shadow-lg">
      {label != null && String(label).trim() ? <p className="mb-1 font-semibold">{label}</p> : null}
      <ul className="space-y-0.5">
        {payload.map((entry) => (
          <li key={String(entry.name)} style={{ color: entry.color || undefined }}>
            {entry.name}: {entry.value}
          </li>
        ))}
      </ul>
    </div>
  );
}

function emptyHoursSeries(year: number, month: number | null): HoursPoint[] {
  if (month == null) {
    return Array.from({ length: 12 }, (_, index) => ({
      label: new Date(year, index, 1).toLocaleString("en-IN", { month: "short" }),
      hours: 0,
      overtimeHours: 0,
    }));
  }
  const days = new Date(year, month + 1, 0).getDate();
  return Array.from({ length: days }, (_, index) => ({
    label: String(index + 1),
    hours: 0,
    overtimeHours: 0,
  }));
}

function MixChart({
  title,
  data,
  loading = false,
}: {
  title: string;
  data: NamedCount[];
  loading?: boolean;
}) {
  const isEmpty = data.length === 0;
  const chartData = isEmpty ? EMPTY_MIX : data;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-ex-secondary">{title}</CardTitle>
      </CardHeader>
      <CardContent className="h-72">
        {loading ? (
          <div className="flex h-full flex-col items-center justify-center gap-4">
            <Skeleton className="size-44" />
            <div className="flex gap-3">
              <Skeleton className="h-3 w-14" />
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-3 w-12" />
            </div>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={chartData}
                dataKey="value"
                nameKey="name"
                innerRadius={52}
                outerRadius={88}
              >
                {chartData.map((entry, index) => (
                  <Cell
                    key={`${entry.name}-${index}`}
                    fill={isEmpty ? "var(--ex-border)" : CHART_COLORS[index % CHART_COLORS.length]}
                  />
                ))}
              </Pie>
              {isEmpty ? null : <Tooltip content={<ChartTooltip />} />}
              {isEmpty ? null : <Legend />}
            </PieChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

export default function EmployeePerformancePage() {
  const { user, loading: authLoading } = useAuth();
  const canManage = user ? canManageEmployees(user.role) : false;

  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [employeeSheetRow, setEmployeeSheetRow] = useState("");
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [month, setMonth] = useState<number | null>(() => new Date().getMonth());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<PerformanceResponse | null>(null);

  const periods = useMemo(() => buildAttendancePeriodOptions(), []);

  const handlePeriodChange = (nextYear: number | null, nextMonth: number | null) => {
    if (nextYear == null) return;
    const nextClampedMonth =
      nextMonth == null ? null : (clampMonthForYear(nextYear, nextMonth, periods) ?? nextMonth);
    if (nextYear === year && nextClampedMonth === month) return;
    setYear(nextYear);
    setMonth(nextClampedMonth);
    if (employeeSheetRow) setLoading(true);
  };

  const handleEmployeeChange = (value: string) => {
    setEmployeeSheetRow(value);
    if (value) {
      setLoading(true);
      return;
    }
    setData(null);
    setError(null);
    setLoading(false);
  };

  useEffect(() => {
    if (!canManage) return;
    void (async () => {
      try {
        const res = await fetch("/api/employee?pageSize=200&status=Active", {
          credentials: "include",
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
            .filter((e) => e.role.trim().toLowerCase() !== ROLES.SUPER_ADMIN)
            .map((e) => ({
              sheetRow: e.sheetRow,
              name: `${e.name}${e.employeeId ? ` (${e.employeeId})` : ""}`,
            }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        );
      } catch (err) {
        setError(toUserFacingFetchError(err));
      }
    })();
  }, [canManage]);

  const loadPerformance = useCallback(
    async (signal?: AbortSignal) => {
      if (!canManage || !employeeSheetRow) {
        setData(null);
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          employeeSheetRow,
          year: String(year),
        });
        if (month != null) params.set("month", String(month));
        const res = await fetch(`/api/employee/performance?${params.toString()}`, {
          credentials: "include",
          cache: "no-store",
          signal,
        });
        const json = await readResponseJson<PerformanceResponse>(res, "fetch");
        if (!res.ok || !json.success) {
          throw new Error(json.message ?? "Failed to load performance");
        }
        setData(json);
      } catch (err) {
        if (signal?.aborted || (err instanceof Error && err.name === "AbortError")) {
          return;
        }
        setData(null);
        setError(toUserFacingFetchError(err));
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [canManage, employeeSheetRow, month, year],
  );

  useEffect(() => {
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch performance when employee/period filters change
    void loadPerformance(controller.signal);
    return () => controller.abort();
  }, [loadPerformance]);

  if (authLoading) return null;

  if (!canManage) {
    return (
      <div className="space-y-8">
        <PageHeader
          title="Employee Performance"
          description="Attendance, hours, overtime, and leave for a selected employee."
        />
        <AccessDenied
          description="Only HR and Super Admin can view employee performance."
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

  const summary = data?.summary ?? EMPTY_SUMMARY;
  const employee = data?.employee;
  const hoursSeries =
    summary.hoursSeries.length > 0 ? summary.hoursSeries : emptyHoursSeries(year, month);
  const periodLabel =
    month == null
      ? String(year)
      : new Date(year, month, 1).toLocaleString("en-IN", { month: "long", year: "numeric" });

  return (
    <div className="space-y-8">
      <PageHeader
        title="Employee Performance"
        description="Pick an employee and a month or full year to see attendance, working hours, overtime, and leave."
        actions={
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-64">
              <label className="text-ex-muted mb-1 block text-xs font-medium">Employee</label>
              <Select
                value={employeeSheetRow}
                onChange={(e) => handleEmployeeChange(e.target.value)}
              >
                <option value="">Select employee</option>
                {employees.map((item) => (
                  <option key={item.sheetRow} value={item.sheetRow}>
                    {item.name}
                  </option>
                ))}
              </Select>
            </div>
            <MonthYearPicker
              year={year}
              month={month}
              periods={periods}
              allowAllMonths
              label="Period"
              className="w-45"
              onChange={handlePeriodChange}
            />
            <Button
              variant="outline"
              size="md"
              onClick={() => void loadPerformance()}
              disabled={loading || !employeeSheetRow}
            >
              <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        }
      />

      {error ? (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
          {error}
        </div>
      ) : null}

      <div className="border-ex-border bg-ex-elevated flex flex-wrap gap-x-8 gap-y-3 rounded-xl border px-5 py-4 text-sm">
        <div>
          <p className="text-ex-muted">Employee</p>
          {loading ? (
            <Skeleton className="mt-1.5 h-5 w-40" />
          ) : (
            <p className="text-ex-primary mt-0.5 font-semibold">
              {employee ? `${employee.name} (${employee.employeeId || "—"})` : "—"}
            </p>
          )}
        </div>
        <div>
          <p className="text-ex-muted">Designation</p>
          {loading ? (
            <Skeleton className="mt-1.5 h-5 w-28" />
          ) : (
            <p className="text-ex-primary mt-0.5 font-semibold capitalize">
              {employee?.position || "—"}
            </p>
          )}
        </div>
        <div>
          <p className="text-ex-muted">Period</p>
          {loading ? (
            <Skeleton className="mt-1.5 h-5 w-24" />
          ) : (
            <p className="text-ex-primary mt-0.5 font-semibold">{periodLabel}</p>
          )}
        </div>
        <div>
          <p className="text-ex-muted">Joining date</p>
          {loading ? (
            <Skeleton className="mt-1.5 h-5 w-28" />
          ) : (
            <p className="text-ex-primary mt-0.5 font-semibold">{employee?.joiningDate || "—"}</p>
          )}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {loading ? (
          Array.from({ length: 8 }).map((_, index) => (
            <Skeleton key={index} className="h-24 rounded-xl" />
          ))
        ) : (
          <>
            <StatCard label="Present days" value={String(summary.presentDays)} hint={periodLabel} />
            <StatCard
              label="Working hours"
              value={summary.workedLabel}
              hint={`Avg ${summary.avgWorkedLabel} / present day`}
            />
            <StatCard
              label="Overtime"
              value={summary.overtimeLabel}
              hint={`${summary.overtimeDays} OT days · approved ${summary.approvedOvertimeLabel}`}
            />
            <StatCard
              label="Leave days"
              value={String(summary.leaveDays)}
              hint={`${data?.leave?.acceptedDays ?? 0} accepted · ${data?.leave?.pendingCount ?? 0} pending`}
            />
            <StatCard label="Completed days" value={String(summary.completedDays)} />
            <StatCard label="Short hours" value={String(summary.shortHoursDays)} />
            <StatCard label="Absent days" value={String(summary.absentDays)} />
            <StatCard
              label="Auto punch-out"
              value={String(summary.autoPunchOutDays)}
              hint="Closed at 11:59 PM"
            />
          </>
        )}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-ex-secondary">
            {month == null ? "Working hours by month" : "Working hours by day"}
          </CardTitle>
        </CardHeader>
        <CardContent className="h-80">
          {loading ? (
            <Skeleton className="h-full w-full rounded-xl" />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={hoursSeries} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--ex-border)" vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  width={36}
                  label={{ value: "Hours", angle: -90, position: "insideLeft" }}
                />
                <Tooltip content={<ChartTooltip />} />
                <Legend />
                <Bar
                  dataKey="hours"
                  name="Working hours"
                  fill="var(--ex-chart-1)"
                  radius={[4, 4, 0, 0]}
                />
                <Bar
                  dataKey="overtimeHours"
                  name="Overtime hours"
                  fill="var(--ex-chart-3)"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <MixChart title="Work Mix" data={summary.workModeMix} loading={loading} />
        <MixChart title="Day Status" data={summary.statusMix} loading={loading} />
        <MixChart title="Leave Mix" data={summary.leaveMix} loading={loading} />
      </div>
    </div>
  );
}
