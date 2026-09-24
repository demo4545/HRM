"use client";

import { readResponseJson } from "@/lib/api/read-response-json";
import Image from "next/image";
import Link from "next/link";
import { AlertTriangle, CalendarDays, Sparkles, Users } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
// import {
//   Area,
//   AreaChart,
//   CartesianGrid,
//   ResponsiveContainer,
//   Tooltip,
//   XAxis,
//   YAxis,
// } from "recharts";
import { AttendanceWidget } from "@/components/attendance/attendance-widget";
import { DashboardAnnouncements } from "@/components/dashboard/dashboard-announcements";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
// import { DataTable } from "@/components/ui/data-table";
import { Badge } from "@/components/ui/badge";
// import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ROLES } from "@/app/consts/common";
import { useAuth } from "@/contexts/auth-provider";
import { canManageEmployees } from "@/lib/auth/roles";
import { parseLeaveDisplayDate } from "@/lib/attendance/leave-range-display";
import { formatIsoDate } from "@/lib/attendance/time";
import { COMPANY_HOLIDAYS_2026, type CompanyHoliday } from "@/lib/company-holidays";
import { resolveProfileImageSrc } from "@/lib/employee";
import { toUserFacingFetchError } from "@/lib/api/user-facing-error";
import { cn } from "@/lib/utils";

/** Shared body height so holiday / on-leave / absence cards don’t jump while loading. */
const DASHBOARD_PANEL_BODY = "h-80";

// const headcountTrend = [
//   { month: "Jan", onboarded: 4, attrition: 1 },
//   { month: "Feb", onboarded: 2, attrition: 0 },
//   { month: "Mar", onboarded: 5, attrition: 2 },
//   { month: "Apr", onboarded: 3, attrition: 1 },
//   { month: "May", onboarded: 6, attrition: 1 },
//   { month: "Jun", onboarded: 4, attrition: 0 },
// ];

// const leaveMix = [
//   { type: "Paid", value: 42 },
//   { type: "Sick", value: 18 },
//   { type: "Casual", value: 28 },
//   { type: "Unpaid", value: 6 },
// ];
// const leaveMax = Math.max(...leaveMix.map((r) => r.value), 1);

// const approvals = [
//   { id: "1", item: "Overtime — Neha Kapoor", owner: "HR queue", status: "Pending" },
//   { id: "2", item: "Leave — Rahul Mehta", owner: "Manager", status: "Pending" },
//   { id: "3", item: "Complaint — Floor 3 AC", owner: "Facilities", status: "In review" },
// ];

function DashboardStatCard({
  label,
  value,
  hint,
  loading,
}: {
  label: string;
  value: string;
  hint?: string;
  loading?: boolean;
}) {
  if (loading) {
    return (
      <div className="border-ex-border bg-ex-elevated flex h-full min-h-[9.5rem] flex-col justify-center rounded-xl border p-4 shadow-sm dark:shadow-none">
        <p className="text-ex-muted text-xs font-medium tracking-wide uppercase">{label}</p>
        <div className="bg-ex-surface mt-2 h-8 w-20 animate-pulse rounded-md" aria-hidden />
        {hint ? <p className="text-ex-muted mt-1 text-xs">{hint}</p> : null}
      </div>
    );
  }
  return <StatCard label={label} value={value} hint={hint} className="flex h-full min-h-[9.5rem] flex-col" />;
}

type OnLeaveEmployee = {
  id: string;
  employeeSheetRow: number;
  employeeId: string;
  employeeName: string;
  leaveType: string;
  duration: string;
  reason: string;
  date: string;
};

type UnapprovedAbsenceEmployee = {
  id: string;
  employeeSheetRow: number;
  employeeId: string;
  employeeName: string;
  profileImage?: string;
  reason: "no_punch";
  reasonLabel: string;
  leaveType: string;
  duration: string;
  date: string;
};

function displayDate(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

function employeeInitials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function leaveDateLabel(value: string): string {
  const parts = value
    .split(" - ")
    .map((part) => parseLeaveDisplayDate(part))
    .filter((date): date is Date => Boolean(date));
  if (parts.length === 0) return value;

  const formatter = new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  if (parts.length === 1) return formatter.format(parts[0]);
  return `${formatter.format(parts[0])} – ${formatter.format(parts.at(-1)!)}`;
}

function UnapprovedAbsenceEmployeeCard({ employee }: { employee: UnapprovedAbsenceEmployee }) {
  const [imageFailed, setImageFailed] = useState(false);
  const profileSrc = resolveProfileImageSrc(employee.profileImage ?? "");
  const showPhoto = Boolean(profileSrc) && !imageFailed;

  return (
    <div className="flex items-center gap-3 px-4 py-3.5">
      {showPhoto ? (
        <Image
          src={profileSrc!}
          alt={`${employee.employeeName} profile`}
          width={40}
          height={40}
          unoptimized
          className="border-ex-border size-10 shrink-0 rounded-full border object-cover"
          onError={() => setImageFailed(true)}
        />
      ) : (
        <div className="bg-ex-chip-danger-bg text-ex-chip-danger-fg flex size-10 shrink-0 items-center justify-center rounded-full text-xs font-bold">
          {employeeInitials(employee.employeeName)}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-ex-primary truncate text-sm font-semibold">{employee.employeeName}</p>
        <div className="mt-1">
          <Badge variant="danger">No punch-in</Badge>
        </div>
      </div>
    </div>
  );
}

function LeaveEmployeeCard({
  employee,
  birthday = false,
  showDetails = true,
}: {
  employee: OnLeaveEmployee;
  birthday?: boolean;
  showDetails?: boolean;
}) {
  const className = cn(
    "group flex items-center gap-3 px-4 py-3.5 transition",
    showDetails && "hover:bg-ex-surface",
  );
  const content = (
    <>
      <div
        className={
          birthday
            ? "flex size-10 shrink-0 items-center justify-center rounded-full bg-pink-500/15 text-xs font-bold text-pink-700 dark:text-pink-300"
            : "bg-ex-secondary/15 text-ex-secondary flex size-10 shrink-0 items-center justify-center rounded-full text-xs font-bold"
        }
      >
        {employeeInitials(employee.employeeName)}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-ex-primary group-hover:text-ex-secondary truncate text-sm font-semibold transition">
          {employee.employeeName}
        </p>
        <p className="text-ex-muted mt-0.5 text-xs">{leaveDateLabel(employee.date)}</p>
      </div>
      {showDetails ? (
        <span className="text-ex-muted group-hover:text-ex-secondary text-base transition">→</span>
      ) : null}
    </>
  );

  return showDetails ? (
    <Link href="/leave/approvals" className={className}>
      {content}
    </Link>
  ) : (
    <div className={className}>{content}</div>
  );
}

function holidayDateParts(holiday: CompanyHoliday): {
  day: string;
  weekday: string;
  month: string;
  monthIndex: number;
} {
  const date = new Date(`${holiday.date}T00:00:00`);
  return {
    day: String(date.getDate()).padStart(2, "0"),
    weekday: new Intl.DateTimeFormat("en-IN", { weekday: "short" }).format(date),
    month: new Intl.DateTimeFormat("en-IN", { month: "short" }).format(date),
    monthIndex: date.getMonth(),
  };
}

function holidayTypeIcon(name: string, isLeave: boolean): ReactNode {
  const normalized = name.trim().toLowerCase();

  if (normalized.includes("makar sankranti")) {
    return <span aria-hidden="true">🪁</span>;
  }
  if (normalized.includes("republic day")) {
    return <span aria-hidden="true">🇮🇳</span>;
  }
  if (normalized.includes("holi")) {
    return <span aria-hidden="true">🎨</span>;
  }
  if (normalized.includes("dhuleti")) {
    return <span aria-hidden="true">🌈</span>;
  }
  if (normalized.includes("independence day")) {
    return <span aria-hidden="true">🇮🇳</span>;
  }
  if (normalized.includes("raksha bandhan")) {
    return <span aria-hidden="true">🪢</span>;
  }
  if (normalized.includes("janmashtami")) {
    return <span aria-hidden="true">🏺</span>;
  }
  if (normalized.includes("ganesh chaturthi")) {
    return <span aria-hidden="true">🐘</span>;
  }
  if (normalized.includes("dussehra") || normalized.includes("vijaya dashami")) {
    return <span aria-hidden="true">🏹</span>;
  }
  if (normalized.includes("diwali")) {
    return <span aria-hidden="true">🪔</span>;
  }
  if (normalized.includes("new year")) {
    return <span aria-hidden="true">🎉</span>;
  }
  if (normalized.includes("bhai dooj")) {
    return <span aria-hidden="true">🧿</span>;
  }
  if (normalized.includes("christmas")) {
    return <span aria-hidden="true">🎄</span>;
  }

  return isLeave ? <CalendarDays className="size-3" /> : <Sparkles className="size-3" />;
}

function UpcomingHolidayItem({
  holiday,
  // className,
}: {
  holiday: CompanyHoliday;
  className?: string;
}) {
  const date = holidayDateParts(holiday);
  const isLeave = holiday.type === "leave";

  return (
    <div className="border-ex-border bg-ex-surface/35 group flex min-w-0 items-center gap-3 rounded-xl border px-4 py-4">
      <div
        className={cn(
          "flex size-12 shrink-0 flex-col items-center justify-center rounded-xl",
          isLeave
            ? "border-ex-chip-info-border bg-ex-chip-info-bg text-ex-chip-info-fg"
            : "border-ex-chip-accent-border bg-ex-chip-accent-bg text-ex-chip-accent-fg",
        )}
      >
        <span className="text-base leading-none font-bold">{date.day}</span>
        <span className="mt-1 text-[10px] leading-none font-semibold uppercase">{date.month}</span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-ex-primary truncate text-sm font-semibold">{holiday.name}</p>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-ex-muted text-xs">{date.weekday}</span>
          <span className="text-ex-muted/50 text-xs">•</span>
          <span
            className={cn(
              "inline-flex items-center gap-1 text-xs font-medium",
              isLeave ? "text-ex-chip-info-fg" : "text-ex-chip-accent-fg",
            )}
          >
            {holidayTypeIcon(holiday.name, isLeave)}
            {isLeave ? "Leave" : "Celebration"}
          </span>
        </div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const canManageLeave = user ? canManageEmployees(user.role) : false;
  const isEmployeeDashboard = user?.role === ROLES.EMPLOYEE;
  const [leaveDate, setLeaveDate] = useState(formatIsoDate());
  const [onLeave, setOnLeave] = useState<OnLeaveEmployee[]>([]);
  const [totalEmployees, setTotalEmployees] = useState(0);
  const [onLeaveLoading, setOnLeaveLoading] = useState(true);
  const [onLeaveError, setOnLeaveError] = useState<string | null>(null);
  const [unapprovedAbsence, setUnapprovedAbsence] = useState<UnapprovedAbsenceEmployee[]>([]);
  const [unapprovedAbsenceFetchedDate, setUnapprovedAbsenceFetchedDate] = useState<string | null>(
    null,
  );
  const [unapprovedAbsenceError, setUnapprovedAbsenceError] = useState<string | null>(null);
  const [companyHolidays, setCompanyHolidays] = useState<CompanyHoliday[]>(COMPANY_HOLIDAYS_2026);
  const [holidaysUsingFallback, setHolidaysUsingFallback] = useState(false);
  const holidayYear = 2026;
  const birthdayLeaveEmployees = onLeave.filter(
    (employee) => employee.leaveType.toLowerCase() === "birthday",
  );
  const otherLeaveEmployees = onLeave.filter(
    (employee) => employee.leaveType.toLowerCase() !== "birthday",
  );
  const unapprovedNoPunch = unapprovedAbsence;
  const canFetchUnapprovedAbsence = canManageLeave && Boolean(user?.sheetRow);
  const unapprovedAbsenceLoading =
    canFetchUnapprovedAbsence && unapprovedAbsenceFetchedDate !== leaveDate;
  const upcomingHolidays = [...companyHolidays]
    .filter((holiday) => holiday.date >= formatIsoDate())
    .sort((left, right) => left.date.localeCompare(right.date));

  useEffect(() => {
    if (!user?.sheetRow) return;

    let cancelled = false;
    const onLeaveUrl = canManageLeave
      ? `/api/dashboard/on-leave?date=${encodeURIComponent(leaveDate)}`
      : "/api/dashboard/on-leave";
    void fetch(onLeaveUrl, {
      cache: "no-store",
    })
      .then(async (response) => {
        const data = await readResponseJson<{
          success?: boolean;
          message?: string;
          employees?: OnLeaveEmployee[];
          totalEmployees?: number;
        }>(response, "fetch");
        if (!response.ok || !data.success) {
          throw new Error(data.message ?? "Failed to load employees on leave");
        }
        return {
          employees: data.employees ?? [],
          totalEmployees: data.totalEmployees ?? 0,
        };
      })
      .then(({ employees, totalEmployees: total }) => {
        if (cancelled) return;
        setOnLeave(employees);
        setTotalEmployees(total);
        setOnLeaveError(null);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setOnLeave([]);
        setTotalEmployees(0);
        setOnLeaveError(toUserFacingFetchError(error));
      })
      .finally(() => {
        if (!cancelled) setOnLeaveLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [canManageLeave, leaveDate, user?.sheetRow]);

  useEffect(() => {
    if (!canFetchUnapprovedAbsence) return;

    let cancelled = false;

    const load = () => {
      void fetch(`/api/dashboard/unapproved-absence?date=${encodeURIComponent(leaveDate)}`, {
        cache: "no-store",
      })
        .then(async (response) => {
          const data = await readResponseJson<{
            success?: boolean;
            message?: string;
            employees?: UnapprovedAbsenceEmployee[];
          }>(response, "fetch");
          if (!response.ok || !data.success) {
            throw new Error(data.message ?? "Failed to load unapproved absences");
          }
          return data.employees ?? [];
        })
        .then((employees) => {
          if (cancelled) return;
          setUnapprovedAbsence(employees);
          setUnapprovedAbsenceError(null);
          setUnapprovedAbsenceFetchedDate(leaveDate);
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          setUnapprovedAbsence([]);
          setUnapprovedAbsenceError(toUserFacingFetchError(error));
          setUnapprovedAbsenceFetchedDate(leaveDate);
        });
    };

    load();

    // Refresh when the tab becomes visible again (no continuous polling —
    // a 20s interval was repeatedly hitting this API and burning quotas).
    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [canFetchUnapprovedAbsence, leaveDate]);

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/company-holidays?year=${holidayYear}`, { cache: "no-store" })
      .then(async (response) => {
        const data = await readResponseJson<{
          success?: boolean;
          holidays?: CompanyHoliday[];
        }>(response, "fetch");
        if (!response.ok || !data.success) {
          throw new Error("Failed to load company holidays");
        }
        return data.holidays ?? [];
      })
      .then((holidays) => {
        if (!cancelled) {
          setCompanyHolidays(holidays);
          setHolidaysUsingFallback(false);
        }
      })
      .catch(() => {
        // Keep the seeded holiday list when the remote sheet is temporarily unavailable.
        if (!cancelled) setHolidaysUsingFallback(true);
      });

    return () => {
      cancelled = true;
    };
  }, [holidayYear]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Executive Overview"
        description="Live attendance, leave, and holiday signals for your team."
        // actions={
        //   <>
        //     <Button variant="outline" size="sm">
        //       Export PDF
        //     </Button>
        //     <Button size="sm" variant="secondary">
        //       New report
        //     </Button>
        //   </>
        // }
      />

      <section className="flex flex-col gap-4 lg:flex-row lg:items-stretch">
        <div
          className={cn(
            "grid shrink-0 gap-4",
            canManageLeave ? "grid-cols-2 lg:w-[30rem]" : "grid-cols-1 lg:w-56",
          )}
        >
          <DashboardStatCard
            label={canManageLeave && leaveDate !== formatIsoDate() ? "On leave" : "On leave today"}
            value={`${onLeave.length}/${totalEmployees}`}
            loading={onLeaveLoading}
            hint={displayDate(canManageLeave ? leaveDate : formatIsoDate())}
          />
          {canManageLeave ? (
            <DashboardStatCard
              label={leaveDate !== formatIsoDate() ? "No punch-in" : "No punch-in today"}
              value={String(unapprovedAbsence.length)}
              loading={unapprovedAbsenceLoading}
              hint={displayDate(leaveDate)}
            />
          ) : null}
        </div>
        <DashboardAnnouncements className="min-w-0 flex-1" />
      </section>

      <section className="grid gap-4 lg:grid-cols-3 lg:items-stretch">
        <Card className="flex h-full w-full flex-col overflow-hidden">
          <CardHeader className="bg-ex-surface/40 flex flex-row items-center justify-between gap-3 sm:gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <div className="bg-ex-accent/15 text-ex-accent flex size-10 shrink-0 items-center justify-center rounded-xl">
                <CalendarDays className="size-5" />
              </div>
              <div className="min-w-0">
                <CardTitle className="text-balance">Upcoming Holidays</CardTitle>
                <p className="text-ex-muted mt-0.5 text-sm">
                  {holidaysUsingFallback
                    ? "Showing default holiday list — live holidays could not be loaded"
                    : "Company leave days and celebrations"}
                </p>
              </div>
            </div>
            {upcomingHolidays.length > 0 ? (
              <Badge variant="accent" className="shrink-0 whitespace-nowrap">
                {upcomingHolidays.length} upcoming
              </Badge>
            ) : null}
          </CardHeader>
          <CardContent className="flex flex-1 flex-col p-5">
            {upcomingHolidays.length === 0 ? (
              <div
                className={cn(
                  "border-ex-border flex flex-col items-center justify-center rounded-xl border border-dashed px-5 text-center",
                  DASHBOARD_PANEL_BODY,
                )}
              >
                <p className="text-ex-primary text-sm font-medium">No upcoming holidays</p>
                <p className="text-ex-muted mt-1 text-xs">
                  New company leave days and celebrations will appear here.
                </p>
              </div>
            ) : (
              <div className={cn(DASHBOARD_PANEL_BODY, "space-y-3 overflow-y-auto pr-1")}>
                {upcomingHolidays.map((holiday) => (
                  <UpcomingHolidayItem key={holiday.id} holiday={holiday} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card
          className={cn(
            "flex h-full flex-col overflow-hidden",
            // Employees share the third column with Today's attendance; HR keeps absence there.
            !canManageLeave && !isEmployeeDashboard && "lg:col-span-2",
          )}
        >
          <CardHeader
            className={cn(
              "bg-ex-surface/40",
              isEmployeeDashboard
                ? "flex flex-row items-center justify-between gap-4"
                : "flex flex-col gap-4",
            )}
          >
            <div
              className={cn(
                isEmployeeDashboard
                  ? "flex min-w-0 items-center gap-3"
                  : "flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between",
              )}
            >
              <div
                className={cn(
                  "flex min-w-0 gap-3",
                  isEmployeeDashboard ? "items-center" : "items-start",
                )}
              >
                <div
                  className={cn(
                    "bg-ex-chip-warning-bg text-ex-chip-warning-fg flex shrink-0 items-center justify-center rounded-xl",
                    isEmployeeDashboard ? "size-10" : "size-11",
                  )}
                >
                  <Users className="size-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <CardTitle className="text-balance">Employees On Leave</CardTitle>
                  <p
                    className={cn("text-ex-muted text-sm", isEmployeeDashboard ? "mt-0.5" : "mt-1")}
                  >
                    Approved leave for {displayDate(canManageLeave ? leaveDate : formatIsoDate())}
                  </p>
                </div>
              </div>
              {canManageLeave ? (
                <Input
                  type="date"
                  value={leaveDate}
                  onChange={(event) => {
                    setOnLeaveLoading(true);
                    setUnapprovedAbsenceFetchedDate(null);
                    setLeaveDate(event.target.value);
                  }}
                  className="w-full sm:w-44 sm:shrink-0"
                  aria-label="Select leave date"
                />
              ) : null}
            </div>
            {isEmployeeDashboard ? (
              onLeaveLoading ? (
                <div className="bg-ex-surface h-6 w-20 shrink-0 animate-pulse rounded-full" />
              ) : (
                <Badge
                  variant={onLeave.length > 0 ? "warning" : "default"}
                  className="shrink-0 whitespace-nowrap"
                >
                  {onLeave.length} on leave
                </Badge>
              )
            ) : (
              <div className="flex min-h-7 flex-wrap items-center gap-2">
                {onLeaveLoading ? (
                  <>
                    <div className="bg-ex-surface h-6 w-20 animate-pulse rounded-full" />
                    {canManageLeave ? (
                      <div className="bg-ex-surface h-6 w-20 animate-pulse rounded-full" />
                    ) : null}
                  </>
                ) : (
                  <>
                    <Badge variant={onLeave.length > 0 ? "warning" : "default"}>
                      {onLeave.length} on leave
                    </Badge>
                    {canManageLeave ? (
                      <Badge variant={birthdayLeaveEmployees.length > 0 ? "accent" : "default"}>
                        {birthdayLeaveEmployees.length} birthday
                      </Badge>
                    ) : null}
                  </>
                )}
              </div>
            )}
          </CardHeader>
          <CardContent className="flex flex-1 flex-col p-5">
            {onLeaveError ? (
              <div className={cn("flex items-center", DASHBOARD_PANEL_BODY)}>
                <p className="border-ex-banner-danger-border bg-ex-banner-danger-bg text-ex-banner-danger-fg w-full rounded-lg border px-4 py-3 text-sm">
                  {onLeaveError}
                </p>
              </div>
            ) : onLeaveLoading ? (
              <div className={cn("grid gap-3", DASHBOARD_PANEL_BODY)}>
                {[0, 1, 2].map((item) => (
                  <div
                    key={item}
                    className="border-ex-border bg-ex-surface h-full min-h-16 animate-pulse rounded-xl border"
                  />
                ))}
              </div>
            ) : onLeave.length === 0 ? (
              <div
                className={cn(
                  "border-ex-border bg-ex-surface/40 flex flex-col items-center justify-center rounded-xl border border-dashed px-6 text-center",
                  DASHBOARD_PANEL_BODY,
                )}
              >
                <div className="bg-ex-elevated text-ex-muted mx-auto flex size-12 items-center justify-center rounded-full text-xl">
                  ✓
                </div>
                <p className="text-ex-primary mt-3 font-medium">Everyone is available</p>
                <p className="text-ex-muted mt-1 text-sm">
                  No accepted leave records for{" "}
                  {displayDate(canManageLeave ? leaveDate : formatIsoDate())}.
                </p>
              </div>
            ) : (
              <div className={cn(DASHBOARD_PANEL_BODY, "space-y-6 overflow-y-auto pr-1")}>
                {birthdayLeaveEmployees.length > 0 ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-ex-primary font-semibold">Birthday leave</p>
                        <p className="text-ex-muted text-sm">
                          Employees celebrating their birthday
                        </p>
                      </div>
                      <Badge variant="accent">{birthdayLeaveEmployees.length}</Badge>
                    </div>
                    <div className="divide-ex-border border-ex-border divide-y overflow-hidden rounded-xl border">
                      {birthdayLeaveEmployees.map((employee) => (
                        <LeaveEmployeeCard
                          key={employee.id}
                          employee={employee}
                          birthday
                          showDetails={canManageLeave}
                        />
                      ))}
                    </div>
                  </div>
                ) : null}

                {otherLeaveEmployees.length > 0 ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-ex-primary font-semibold">
                          {canManageLeave ? "Other leave" : "On leave today"}
                        </p>
                        <p className="text-ex-muted text-sm">
                          {canManageLeave
                            ? "Paid, sick, casual, and unpaid leave"
                            : "Employees who are unavailable today"}
                        </p>
                      </div>
                      <Badge variant="default">{otherLeaveEmployees.length}</Badge>
                    </div>
                    <div className="divide-ex-border border-ex-border divide-y overflow-hidden rounded-xl border">
                      {otherLeaveEmployees.map((employee) => (
                        <LeaveEmployeeCard
                          key={employee.id}
                          employee={employee}
                          showDetails={canManageLeave}
                        />
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </CardContent>
        </Card>

        {canManageLeave ? (
          <Card className="flex h-full flex-col overflow-hidden">
            <CardHeader className="bg-ex-surface/40 flex flex-col gap-4">
              <div className="flex items-center gap-3">
                <div className="bg-ex-chip-danger-bg text-ex-chip-danger-fg flex size-11 items-center justify-center rounded-xl">
                  <AlertTriangle className="size-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <CardTitle>Absence</CardTitle>
                  <p className="text-ex-muted mt-1 text-sm">
                    Employees who have not punched in for {displayDate(leaveDate)}
                  </p>
                </div>
              </div>
              <div className="flex min-h-7 flex-wrap items-center gap-2">
                {unapprovedAbsenceLoading ? (
                  <div className="bg-ex-surface h-6 w-24 animate-pulse rounded-full" />
                ) : (
                  <Badge variant={unapprovedNoPunch.length > 0 ? "danger" : "default"}>
                    {unapprovedNoPunch.length} no punch
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col p-5">
              {unapprovedAbsenceError ? (
                <div className={cn("flex items-center", DASHBOARD_PANEL_BODY)}>
                  <p className="border-ex-banner-danger-border bg-ex-banner-danger-bg text-ex-banner-danger-fg w-full rounded-lg border px-4 py-3 text-sm">
                    {unapprovedAbsenceError}
                  </p>
                </div>
              ) : unapprovedAbsenceLoading ? (
                <div className={cn("grid gap-3", DASHBOARD_PANEL_BODY)}>
                  {[0, 1, 2].map((item) => (
                    <div
                      key={item}
                      className="border-ex-border bg-ex-surface h-full min-h-16 animate-pulse rounded-xl border"
                    />
                  ))}
                </div>
              ) : unapprovedAbsence.length === 0 ? (
                <div
                  className={cn(
                    "border-ex-border bg-ex-surface/40 flex flex-col items-center justify-center rounded-xl border border-dashed px-6 text-center",
                    DASHBOARD_PANEL_BODY,
                  )}
                >
                  <div className="bg-ex-elevated text-ex-muted mx-auto flex size-12 items-center justify-center rounded-full text-xl">
                    ✓
                  </div>
                  <p className="text-ex-primary mt-3 font-medium">Everyone has punched in</p>
                  <p className="text-ex-muted mt-1 text-sm">
                    No missing punch-ins for {displayDate(leaveDate)}.
                  </p>
                </div>
              ) : (
                <div className={cn(DASHBOARD_PANEL_BODY, "overflow-y-auto pr-1")}>
                  <div className="divide-ex-border border-ex-border divide-y overflow-hidden rounded-xl border">
                    {unapprovedAbsence.map((employee) => (
                      <UnapprovedAbsenceEmployeeCard key={employee.id} employee={employee} />
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        ) : null}
        {isEmployeeDashboard ? (
          <AttendanceWidget className="flex h-full flex-col overflow-hidden" />
        ) : null}
      </section>

      {!isEmployeeDashboard ? (
        <section className="max-w-xl">
          <AttendanceWidget />
          {/* <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Onboarding vs attrition</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={headcountTrend} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
                <defs>
                  <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--ex-secondary)" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="var(--ex-secondary)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="g2" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--ex-accent)" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="var(--ex-accent)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--ex-border)" vertical={false} />
                <XAxis dataKey="month" tickLine={false} axisLine={false} />
                <YAxis tickLine={false} axisLine={false} width={32} />
                <Tooltip
                  contentStyle={{
                    borderRadius: 12,
                    borderColor: "var(--ex-border)",
                    background: "var(--ex-elevated)",
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="onboarded"
                  stroke="var(--ex-secondary)"
                  fill="url(#g1)"
                  strokeWidth={2}
                />
                <Area
                  type="monotone"
                  dataKey="attrition"
                  stroke="var(--ex-accent)"
                  fill="url(#g2)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card> */}

          {/* <Card>
          <CardHeader>
            <CardTitle>Leave mix (MTD)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {leaveMix.map((row) => (
              <div key={row.type} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-ex-muted">{row.type}</span>
                  <span className="text-ex-primary font-medium tabular-nums">{row.value}</span>
                </div>
                <div className="bg-ex-surface h-2 overflow-hidden rounded-full">
                  <div
                    className="bg-ex-secondary h-full rounded-full"
                    style={{ width: `${(row.value / leaveMax) * 100}%` }}
                  />
                </div>
              </div>
            ))}
            <p className="text-ex-muted pt-2 text-xs">
              Paid / sick / casual / unpaid flows include half-day and full-day with configurable
              approval chains.
            </p>
          </CardContent>
        </Card> */}
        </section>
      ) : null}
      {/* <section>
        <Card>
          <CardHeader>
            <CardTitle>Approval queue</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <DataTable
              rows={approvals}
              columns={[
                { key: "item", header: "Item" },
                { key: "owner", header: "Routed to" },
                {
                  key: "status",
                  header: "Status",
                  render: (r) => <Badge variant="warning">{r.status}</Badge>,
                },
              ]}
            />
          </CardContent>
        </Card>
      </section> */}
    </div>
  );
}
