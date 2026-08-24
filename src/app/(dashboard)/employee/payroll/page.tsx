"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, RefreshCw } from "lucide-react";

import { PageHeader } from "@/components/ui/page-header";
import { AccessDenied } from "@/components/ui/access-denied";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { MonthYearPicker } from "@/components/ui/month-year-picker";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/auth-provider";
import { readResponseJson } from "@/lib/api/read-response-json";
import { toUserFacingFetchError } from "@/lib/api/user-facing-error";
import { canManageEmployees } from "@/lib/auth/roles";
import {
  ATTENDANCE_HISTORY_START_YEAR,
  buildFullMonthYearPeriodOptions,
  clampMonthForYear,
  PAYROLL_FUTURE_YEARS,
} from "@/lib/attendance/period-options";
import { PAYROLL_DAY_CODE_LEGEND } from "@/lib/payroll/constants";
import type { Column } from "@/types/table";

type DeductionBucket = { payable: number; employeeCount: number };

type PayrollEmployeeRow = {
  id: string;
  employeeSheetRow: number;
  employeeId: string;
  name: string;
  designation: string;
  skippedReason?: string;
  payroll: {
    basic: number;
    hra: number;
    organizationAllowance: number;
    monthlySalary: number;
    workingDays: number;
    perDay: number;
    perHour: number;
    halfPaidLeave: number;
    fullPaidLeave: number;
    halfUnpaidLeave: number;
    fullUnpaidLeave: number;
    totalPaidLeave: number;
    totalUnpaidLeave: number;
    attendDays: number;
    netPayableDays: number;
    paidLeaveAmount: number;
    unpaidLeaveAmount: number;
    overtimeHours: number;
    overtimeAmount: number;
    amountAfterAttendance: number;
    loyaltyPercent: number;
    loyaltyBonus: number;
    professionalTax: number;
    lwf: number;
    salaryAdvance: number;
    finalPayment: number;
  } | null;
};

type PayrollApiResponse = {
  success: boolean;
  message?: string;
  period?: {
    year: number;
    month: number;
    workingDays: number;
    scheduledDates: string[];
  };
  summary?: {
    employeeCount: number;
    totalNetPayable: number;
  };
  deductions?: {
    pt: DeductionBucket;
    lwf: DeductionBucket;
    loyalty: DeductionBucket;
    unpaidLeave: DeductionBucket;
    salaryAdvance: DeductionBucket;
    overtime: DeductionBucket;
  };
  employees?: PayrollEmployeeRow[];
};

type TableRow = {
  id: string;
  employeeId: string;
  name: string;
  designation: string;
  totalSalary: string;
  perDay: string;
  workingDays: string;
  attendDays: string;
  netPayableDays: string;
  halfUnpaidLeave: string;
  fullUnpaidLeave: string;
  unpaidLeave: string;
  unpaidAmount: string;
  overtimeHours: string;
  overtimeAmount: string;
  advance: string;
  loyalty: string;
  pt: string;
  lwf: string;
  finalPayment: string;
  note: string;
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

function formatDayCount(value: number): string {
  const rounded = Math.round((Number(value) || 0) * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

function formatInr(amount: number): string {
  return `Rs. ${amount.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDesignation(value: string): string {
  if (!value.trim()) return "—";
  return value.split("_").join(" ");
}

function Metric({
  label,
  value,
  loading = false,
}: {
  label: string;
  value: string;
  loading?: boolean;
}) {
  return (
    <div className="min-w-0">
      <p className="text-ex-muted text-sm">{label}</p>
      {loading ? (
        <Skeleton className="mt-2 h-6 w-28" />
      ) : (
        <p className="text-ex-primary mt-1 text-lg font-semibold tracking-tight">{value}</p>
      )}
    </div>
  );
}

function BannerField({
  label,
  value,
  loading = false,
}: {
  label: string;
  value: string;
  loading?: boolean;
}) {
  return (
    <div>
      <p className="text-ex-muted">{label}</p>
      {loading ? (
        <Skeleton className="mt-1.5 h-5 w-24" />
      ) : (
        <p className="text-ex-primary mt-0.5 font-semibold">{value}</p>
      )}
    </div>
  );
}

export default function PayrollPage() {
  const { user, loading: authLoading } = useAuth();
  const canManage = user ? canManageEmployees(user.role) : false;

  const [month, setMonth] = useState(() => new Date().getMonth());
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<PayrollApiResponse | null>(null);

  const periods = useMemo(() => {
    const now = new Date();
    const currentYear = now.getFullYear();
    return buildFullMonthYearPeriodOptions(
      now,
      ATTENDANCE_HISTORY_START_YEAR,
      currentYear + PAYROLL_FUTURE_YEARS,
    );
  }, []);

  const handlePeriodChange = (nextYear: number | null, nextMonth: number | null) => {
    if (nextYear == null || nextMonth == null) return;
    setYear(nextYear);
    setMonth(clampMonthForYear(nextYear, nextMonth, periods) ?? nextMonth);
  };

  const loadPayroll = useCallback(async () => {
    if (!canManage) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        year: String(year),
        month: String(month + 1),
      });
      const res = await fetch(`/api/payroll?${params.toString()}`, {
        credentials: "include",
        cache: "no-store",
      });
      const json = await readResponseJson<PayrollApiResponse>(res, "fetch");
      if (!res.ok || !json.success) {
        throw new Error(json.message ?? "Failed to load payroll");
      }
      setData(json);
    } catch (err) {
      console.error(err);
      setData(null);
      setError(toUserFacingFetchError(err));
    } finally {
      setLoading(false);
    }
  }, [canManage, month, year]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch payroll when period filters change
    void loadPayroll();
  }, [loadPayroll]);

  const tableRows: TableRow[] = useMemo(() => {
    return (data?.employees ?? []).map((employee) => {
      const payroll = employee.payroll;
      if (!payroll) {
        return {
          id: employee.id,
          employeeId: employee.employeeId || "—",
          name: employee.name || "—",
          designation: formatDesignation(employee.designation ?? ""),
          totalSalary: "—",
          perDay: "—",
          workingDays: "—",
          attendDays: "—",
          netPayableDays: "—",
          halfUnpaidLeave: "—",
          fullUnpaidLeave: "—",
          unpaidLeave: "—",
          unpaidAmount: "—",
          overtimeHours: "—",
          overtimeAmount: "—",
          advance: "—",
          loyalty: "—",
          pt: "—",
          lwf: "—",
          finalPayment: "—",
          note: employee.skippedReason ?? "Skipped",
        };
      }

      return {
        id: employee.id,
        employeeId: employee.employeeId || "—",
        name: employee.name || "—",
        designation: formatDesignation(employee.designation ?? ""),
        totalSalary: formatInr(payroll.monthlySalary),
        perDay: formatInr(payroll.perDay),
        workingDays: formatDayCount(payroll.workingDays),
        attendDays: formatDayCount(payroll.attendDays),
        netPayableDays: formatDayCount(payroll.netPayableDays),
        halfUnpaidLeave: String(payroll.halfUnpaidLeave),
        fullUnpaidLeave: String(payroll.fullUnpaidLeave),
        unpaidLeave: formatDayCount(payroll.totalUnpaidLeave),
        unpaidAmount: formatInr(payroll.unpaidLeaveAmount),
        overtimeHours: `${payroll.overtimeHours.toLocaleString("en-IN", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })} h`,
        overtimeAmount: formatInr(payroll.overtimeAmount),
        advance: formatInr(payroll.salaryAdvance),
        loyalty: formatInr(payroll.loyaltyBonus),
        pt: formatInr(payroll.professionalTax),
        lwf: formatInr(payroll.lwf),
        finalPayment: formatInr(payroll.finalPayment),
        note: "",
      };
    });
  }, [data?.employees]);

  const columns: Column<TableRow>[] = useMemo(
    () => [
      { key: "employeeId", header: "Employee ID", sortable: true },
      { key: "name", header: "Name", sortable: true },
      {
        key: "designation",
        header: "Designation",
        render: (row) => <span className="capitalize">{row.designation}</span>,
      },
      { key: "totalSalary", header: "Total salary" },
      { key: "perDay", header: "Per Day" },
      { key: "workingDays", header: "Working Days" },
      { key: "attendDays", header: "Attend Days" },
      { key: "netPayableDays", header: "Net Payable Days" },
      { key: "halfUnpaidLeave", header: "Half Unpaid Leave" },
      { key: "fullUnpaidLeave", header: "Full Unpaid Leave" },
      { key: "unpaidLeave", header: "Total Unpaid Leave" },
      { key: "unpaidAmount", header: "Unpaid Amount" },
      { key: "overtimeHours", header: "OT Hours" },
      { key: "overtimeAmount", header: "OT Amount" },
      { key: "advance", header: "Salary Advance" },
      { key: "loyalty", header: "Loyalty" },
      { key: "pt", header: "PT" },
      { key: "lwf", header: "LWF" },
      { key: "finalPayment", header: "Final Payment" },
      { key: "note", header: "Note" },
    ],
    [],
  );

  if (authLoading) {
    return null;
  }

  if (!canManage) {
    return (
      <div className="space-y-8">
        <PageHeader
          title="Payroll"
          description="Auto-calculated salary payable from attendance, working days, and fixed deductions."
        />
        <AccessDenied
          description="Only HR and Super Admin roles can view payroll summary."
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

  const periodLabel = `${MONTHS[month]} - ${year}`;
  const workingDays = data?.period?.workingDays ?? 0;
  const totalNetPayable = data?.summary?.totalNetPayable ?? 0;
  const employeeCount = data?.summary?.employeeCount ?? 0;
  const deductions = data?.deductions;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Payroll"
        description="Final pay = pro-rated basic + HRA + organization allowance + approved OT − unpaid leave − salary advance − loyalty − PT − LWF. Loyalty is salary-history % of full basic (not reduced by working days). PT and LWF come from salary history. Paid / Sick / Casual leave do not deduct."
        actions={
          <div className="flex flex-wrap items-end gap-2">
            <MonthYearPicker
              year={year}
              month={month}
              periods={periods}
              label="Period"
              className="w-45"
              onChange={handlePeriodChange}
            />
            <Button
              variant="outline"
              size="md"
              onClick={() => void loadPayroll()}
              disabled={loading}
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

      <div className="border-ex-border bg-ex-elevated flex flex-col gap-4 rounded-xl border px-5 py-4 shadow-sm sm:flex-row sm:flex-wrap sm:items-center sm:justify-between dark:shadow-none">
        <div className="flex flex-wrap gap-x-8 gap-y-3 text-sm">
          <BannerField label="Month Year" value={periodLabel} />
          <BannerField label="Payroll Type" value="Regular" />
          <BannerField label="Working Days" value={String(workingDays)} loading={loading} />
          <BannerField label="Employees" value={String(employeeCount)} loading={loading} />
          <BannerField
            label="Total Net Payable Amount"
            value={formatInr(totalNetPayable)}
            loading={loading}
          />
        </div>
      </div>

      <div className="space-y-4">
        <Card>
          <CardHeader className="border-0 pb-0">
            <CardTitle className="text-ex-secondary">Loyalty Bonus</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-6 sm:grid-cols-2">
            <Metric
              label="Loyalty Deducted"
              value={formatInr(deductions?.loyalty.payable ?? 0)}
              loading={loading}
            />
            <Metric
              label="Total Employees"
              value={String(deductions?.loyalty.employeeCount ?? 0)}
              loading={loading}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-0 pb-0">
            <CardTitle className="text-ex-secondary">PT</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-6 sm:grid-cols-2">
            <Metric
              label="PT Payable"
              value={formatInr(deductions?.pt.payable ?? 0)}
              loading={loading}
            />
            <Metric
              label="Total Employees"
              value={String(deductions?.pt.employeeCount ?? 0)}
              loading={loading}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-0 pb-0">
            <CardTitle className="text-ex-secondary">LWF</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-6 sm:grid-cols-2">
            <Metric
              label="LWF Payable"
              value={formatInr(deductions?.lwf.payable ?? 0)}
              loading={loading}
            />
            <Metric
              label="Total Employees"
              value={String(deductions?.lwf.employeeCount ?? 0)}
              loading={loading}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-0 pb-0">
            <CardTitle className="text-ex-secondary">Unpaid Leave Deduction</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-6 sm:grid-cols-2">
            <Metric
              label="Unpaid Amount"
              value={formatInr(deductions?.unpaidLeave.payable ?? 0)}
              loading={loading}
            />
            <Metric
              label="Employees Affected"
              value={String(deductions?.unpaidLeave.employeeCount ?? 0)}
              loading={loading}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-0 pb-0">
            <CardTitle className="text-ex-secondary">Salary Advance Recovery</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-6 sm:grid-cols-2">
            <Metric
              label="Advance Deducted"
              value={formatInr(deductions?.salaryAdvance.payable ?? 0)}
              loading={loading}
            />
            <Metric
              label="Employees Affected"
              value={String(deductions?.salaryAdvance.employeeCount ?? 0)}
              loading={loading}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-0 pb-0">
            <CardTitle className="text-ex-secondary">Overtime</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-6 sm:grid-cols-2">
            <Metric
              label="OT Payable"
              value={formatInr(deductions?.overtime.payable ?? 0)}
              loading={loading}
            />
            <Metric
              label="Employees Affected"
              value={String(deductions?.overtime.employeeCount ?? 0)}
              loading={loading}
            />
          </CardContent>
        </Card>
      </div>

      <div className="space-y-3">
        <h2 className="text-ex-primary text-base font-semibold">Employee payroll breakdown</h2>
        <p className="text-ex-muted text-sm">
          Day codes:{" "}
          {PAYROLL_DAY_CODE_LEGEND.map((item, index) => (
            <span key={item.code}>
              {index > 0 ? " · " : null}
              <span className="text-ex-primary font-medium">{item.code}</span> = {item.label}
            </span>
          ))}
        </p>
        <DataTable
          columns={columns}
          rows={tableRows}
          loading={loading}
          emptyTitle="No payroll rows"
          emptyDescription="Active employees with a configured salary for this period will appear here."
        />
      </div>

      <p className="text-ex-muted text-sm">
        Flow: take basic, HRA, organization allowance, loyalty %, PT, and LWF from salary history
        (same values as salary slips) → working days (Mon–Fri, exclude leave-type holidays) → per
        day / per hour on gross pay → pro-rate earnings for unpaid leave (U/F; missing/absent
        scheduled days count as F) → add approved overtime (Accepted on Overtime & Approvals) at the
        gross hourly rate → deduct loyalty (% of full basic, not working days), PT, LWF, and salary
        advance recovery. Paid leave (A/H) is not deducted. Attend Days counts P (and half of H/U
        present portion). Manage advances under Employee → Salary advances.
      </p>
    </div>
  );
}
