"use client";

import { readResponseJson } from "@/lib/api/read-response-json";
import Link from "next/link";
import { ArrowLeft, CalendarDays, Wallet } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AccessDenied } from "@/components/ui/access-denied";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { formatIsoDate } from "@/lib/attendance/time";
import { formatLeaveDayCount } from "@/lib/attendance/leave-display";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/contexts/auth-provider";
import { toUserFacingActionError, toUserFacingFetchError } from "@/lib/api/user-facing-error";
import { useNotifications } from "@/contexts/notifications-provider";
import { roleCanApplyLeave } from "@/lib/auth/roles";
import { cn } from "@/lib/utils";

type UnpaidLeaveEntry = {
  slot: string;
  date: string;
  duration: string;
  reason: string;
  status: string;
  rejectReason: string;
  days: number;
};

type LeaveApplication = {
  id: string;
  leaveType: string;
  slot: string;
  date: string;
  duration: string;
  reason: string;
  status: string;
  rejectReason: string;
  days?: number;
};

type LeavePolicyBalance = {
  allocated: number;
  accrued: number;
  used: number;
  expired: number;
  available: number;
  remaining: number;
};

type LeaveBalanceResponse = {
  success: boolean;
  birthdayDate?: string;
  birthdayDateIso?: string;
  paid: LeavePolicyBalance;
  casual: LeavePolicyBalance;
  sick: LeavePolicyBalance;
  unpaid: {
    used: number;
    leaves: UnpaidLeaveEntry[];
  };
  birthday: LeavePolicyBalance;
  applications?: LeaveApplication[];
};

function statusBadgeVariant(status: string): "default" | "success" | "warning" | "danger" {
  const normalized = status.trim().toLowerCase();
  if (normalized === "accepted") return "success";
  if (normalized === "applied") return "warning";
  if (normalized === "rejected") return "danger";
  return "default";
}

function formatLeaveTypeLabel(leaveType: string): string {
  const labels: Record<string, string> = {
    paid: "Paid",
    casual: "Casual",
    sick: "Sick",
    birthday: "Birthday",
    unpaid: "Unpaid",
  };
  return labels[leaveType] ?? leaveType;
}

const LEAVE_TYPE_OPTIONS = [
  { value: "paid", label: "Paid" },
  { value: "casual", label: "Casual" },
  { value: "sick", label: "Sick" },
  { value: "birthday", label: "Birthday" },
  { value: "unpaid", label: "Unpaid" },
] as const;

type LeaveTypeValue = (typeof LEAVE_TYPE_OPTIONS)[number]["value"];

function getLeaveTypeAvailable(
  balances: LeaveBalanceResponse,
  leaveType: LeaveTypeValue,
): number | null {
  if (leaveType === "unpaid") return null;

  return balances[leaveType].available;
}

function getAvailableLeaveTypes(
  balances: LeaveBalanceResponse | null,
  loading: boolean,
): Array<(typeof LEAVE_TYPE_OPTIONS)[number]> {
  if (loading || !balances) {
    return [...LEAVE_TYPE_OPTIONS];
  }

  return LEAVE_TYPE_OPTIONS.filter((option) => {
    if (option.value === "unpaid") return true;
    return (getLeaveTypeAvailable(balances, option.value) ?? 0) > 0;
  });
}

function BalanceRow({
  title,
  detail,
  badge,
  badgeVariant = "default",
}: {
  title: string;
  detail: string;
  badge: string;
  badgeVariant?: "default" | "accent" | "success" | "warning" | "danger";
}) {
  return (
    <div className="bg-ex-surface/60 border-ex-border flex items-start justify-between gap-3 rounded-lg border px-3 py-2.5">
      <div className="min-w-0 space-y-0.5">
        <p className="text-ex-primary text-sm font-medium">{title}</p>
        <p className="text-ex-muted text-xs leading-snug">{detail}</p>
      </div>
      <Badge variant={badgeVariant} className="shrink-0">
        {badge}
      </Badge>
    </div>
  );
}

export default function LeaveDeskPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const canApplyLeave = user ? roleCanApplyLeave(user.role) : false;
  const { refresh: refreshNotifications, pushToast } = useNotifications();
  const [isSingleDay, setIsSingleDay] = useState(false);

  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [birthdayLeaveDate, setBirthdayLeaveDate] = useState("");

  const [leaveType, setLeaveType] = useState("paid");
  const [duration, setDuration] = useState("full");
  const [reason, setReason] = useState("");

  const [submitting, setSubmitting] = useState(false);

  const [balancesLoading, setBalancesLoading] = useState(true);
  const [balances, setBalances] = useState<LeaveBalanceResponse | null>(null);

  const formDisabled = balancesLoading || submitting;

  const availableLeaveTypes = getAvailableLeaveTypes(balances, balancesLoading);
  const resolvedLeaveType = availableLeaveTypes.some((option) => option.value === leaveType)
    ? leaveType
    : (availableLeaveTypes[0]?.value ?? "unpaid");

  const isBirthdayLeave = resolvedLeaveType === "birthday";
  const birthdayLeaveDateValue =
    birthdayLeaveDate || (isBirthdayLeave ? (balances?.birthdayDateIso ?? "") : "");

  const loadBalances = useCallback(async () => {
    if (!canApplyLeave) return;
    setBalancesLoading(true);
    try {
      const res = await fetch("/api/employee/leaves");
      const data = await readResponseJson<LeaveBalanceResponse & { message?: string }>(
        res,
        "fetch",
      );

      if (data.success) {
        setBalances(data);
        if (data.birthdayDateIso) {
          setBirthdayLeaveDate((current) => current || data.birthdayDateIso || "");
        }
      } else {
        pushToast({
          title: "Could not load leave balances",
          body: toUserFacingFetchError(),
          variant: "error",
        });
      }
    } catch (error) {
      pushToast({
        title: "Could not load leave balances",
        body: toUserFacingFetchError(error),
        variant: "error",
      });
    } finally {
      setBalancesLoading(false);
    }
  }, [canApplyLeave, pushToast]);

  useEffect(() => {
    if (!authLoading && user && !canApplyLeave) {
      router.replace("/dashboard");
    }
  }, [authLoading, user, canApplyLeave, router]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadBalances();
  }, [loadBalances]);

  if (!canApplyLeave) {
    return (
      <div className="mx-auto max-w-4xl space-y-6">
        <AccessDenied
          title="Leave Desk Unavailable"
          description="Leave applications are only available for Employee and HR Manager roles."
          action={
            <Link href="/dashboard">
              <Button variant="outline" size="sm">
                <ArrowLeft className="size-4" />
                Back to dashboard
              </Button>
            </Link>
          }
        />
      </div>
    );
  }

  const minLeaveDate = formatIsoDate();
  const isHalfDay = duration === "half_am" || duration === "half_pm";

  const handleSingleDayChange = (checked: boolean) => {
    setIsSingleDay(checked);

    if (checked) {
      setToDate(fromDate);
      return;
    }

    // Multi-day leave is always full day.
    setDuration("full");
  };

  const handleFromDateChange = (value: string) => {
    setFromDate(value);

    if (isSingleDay || isHalfDay) {
      setToDate(value);
    }
  };

  const handleDurationChange = (value: string) => {
    setDuration(value);

    if (value === "half_am" || value === "half_pm") {
      setIsSingleDay(true);
      setToDate(fromDate);
    }
  };

  const totalDays = (() => {
    if (isBirthdayLeave) return 1;
    if (!fromDate) return 0;

    const endDate = isSingleDay || isHalfDay ? fromDate : toDate;

    if (!endDate) return 0;

    const start = new Date(fromDate);
    const end = new Date(endDate);

    const diff = Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;

    if (duration === "full") {
      return diff;
    }

    return 0.5;
  })();

  const submitLeaveRequest = async () => {
    if (isBirthdayLeave) {
      if (!birthdayLeaveDateValue) {
        pushToast({
          title: "Birthday Date Required",
          body: "Please select your birthday leave date.",
          variant: "error",
        });
        return;
      }
    } else {
      if (!fromDate) {
        pushToast({
          title: "Date Required",
          body: "Please select a date.",
          variant: "error",
        });
        return;
      }

      if (!isSingleDay && !isHalfDay && !toDate) {
        pushToast({
          title: "End Date Required",
          body: "Please select an end date.",
          variant: "error",
        });
        return;
      }

      if (!reason.trim()) {
        pushToast({
          title: "Reason Required",
          body: "Please provide a reason for leave.",
          variant: "error",
        });
        return;
      }
    }

    setSubmitting(true);
    setBalancesLoading(true);

    try {
      const body = isBirthdayLeave
        ? { leaveType: "birthday", fromDate: birthdayLeaveDateValue }
        : {
            leaveType: resolvedLeaveType,
            duration,
            fromDate,
            toDate: isSingleDay || isHalfDay ? fromDate : toDate,
            totalDays,
            reason,
          };

      const res = await fetch("/api/employee/leaves", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      const data = await readResponseJson<{
        success?: boolean;
        message?: string;
        [key: string]: unknown;
      }>(res, "action");

      if (!data.success) {
        throw new Error(data.message);
      }

      setFromDate("");
      setToDate("");
      setBirthdayLeaveDate("");
      setReason("");
      setLeaveType("paid");
      setDuration("full");
      setIsSingleDay(false);
      pushToast({
        title: "Leave Submitted",
        body: "Your leave request was submitted for approval.",
        variant: "success",
      });
      await loadBalances();
      await refreshNotifications();
    } catch (error) {
      pushToast({
        title: "Submit Failed",
        body: toUserFacingActionError(error),
        variant: "error",
      });
    } finally {
      setSubmitting(false);
      setBalancesLoading(false);
    }
  };

  const applications = balances?.applications ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Leave Desk"
        description="Apply for leave and track balances. Requests stay Applied until HR accepts or rejects them."
      />
      <div className="grid items-start gap-5 lg:grid-cols-3">
        <Card className="overflow-hidden lg:col-span-2">
          <CardHeader className="bg-ex-surface/30">
            <div className="flex items-start gap-3">
              <div className="bg-ex-secondary/10 text-ex-secondary flex size-9 shrink-0 items-center justify-center rounded-lg">
                <CalendarDays className="size-4" aria-hidden />
              </div>
              <div className="min-w-0 space-y-0.5">
                <CardTitle>Apply For Leave</CardTitle>
                <CardDescription>Choose a type, dates, and submit for approval.</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-5 pt-5">
            <div className={cn("grid gap-4", isSingleDay || isHalfDay ? "sm:grid-cols-2" : "")}>
              <div className="space-y-2">
                <Label>Leave Type</Label>
                <Select
                  value={resolvedLeaveType}
                  onChange={(e) => setLeaveType(e.target.value)}
                  disabled={formDisabled}
                >
                  {availableLeaveTypes.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
                {!balancesLoading &&
                balances &&
                availableLeaveTypes.length < LEAVE_TYPE_OPTIONS.length ? (
                  <p className="text-ex-muted text-xs">
                    Leave types with no remaining balance are hidden from this list.
                  </p>
                ) : null}
              </div>

              {!isBirthdayLeave && (isSingleDay || isHalfDay) ? (
                <div className="space-y-2">
                  <Label>Duration</Label>
                  <Select
                    value={duration}
                    onChange={(e) => handleDurationChange(e.target.value)}
                    disabled={formDisabled}
                  >
                    <option value="full">Full Day</option>
                    <option value="half_am">Half Day · Morning</option>
                    <option value="half_pm">Half Day · Afternoon</option>
                  </Select>
                </div>
              ) : null}
            </div>

            {isBirthdayLeave ? (
              <div className="border-ex-border bg-ex-surface/40 space-y-3 rounded-xl border p-4">
                <div className="space-y-2">
                  <Label>Birthday Date</Label>
                  <Input
                    type="date"
                    min={minLeaveDate}
                    value={birthdayLeaveDateValue}
                    onChange={(e) => setBirthdayLeaveDate(e.target.value)}
                    disabled={formDisabled}
                  />
                  <p className="text-ex-muted text-xs">
                    {balances?.birthdayDateIso
                      ? "Pre-filled from your employee profile. You can change it before submitting."
                      : "Select your birthday leave date. No reason or duration is required."}
                  </p>
                </div>
              </div>
            ) : (
              <>
                <div className="border-ex-border bg-ex-surface/40 space-y-4 rounded-xl border p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-ex-primary text-sm font-medium">Leave Dates</p>
                      <p className="text-ex-muted text-xs">
                        {isSingleDay || isHalfDay
                          ? "One calendar day"
                          : "Select a from and to date range"}
                      </p>
                    </div>
                    <label className="border-ex-border bg-ex-elevated flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5">
                      <Switch
                        checked={isSingleDay}
                        onCheckedChange={handleSingleDayChange}
                        disabled={formDisabled}
                      />
                      <span className="text-ex-primary text-xs font-medium">Single Day</span>
                    </label>
                  </div>

                  <div
                    className={
                      isSingleDay || isHalfDay ? "grid gap-4" : "grid gap-4 sm:grid-cols-2"
                    }
                  >
                    <div className="space-y-2">
                      <Label>{isSingleDay || isHalfDay ? "Date" : "From Date"}</Label>
                      <Input
                        type="date"
                        min={minLeaveDate}
                        value={fromDate}
                        onChange={(e) => handleFromDateChange(e.target.value)}
                        disabled={formDisabled}
                      />
                    </div>

                    {!isSingleDay && !isHalfDay ? (
                      <div className="space-y-2">
                        <Label>To Date</Label>
                        <Input
                          type="date"
                          min={fromDate || minLeaveDate}
                          value={toDate}
                          onChange={(e) => setToDate(e.target.value)}
                          disabled={formDisabled}
                        />
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Reason</Label>
                  <Textarea
                    rows={3}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Reason For leave"
                    disabled={formDisabled}
                  />
                </div>
              </>
            )}

            <div className="border-ex-border flex flex-wrap items-center justify-between gap-3 border-t pt-4">
              {!isBirthdayLeave ? (
                <Badge variant="accent">
                  Total Leave: {totalDays} Day
                  {totalDays > 0 ? "s" : ""}
                </Badge>
              ) : (
                <span className="text-ex-muted text-xs">Birthday leave counts as 1 day.</span>
              )}
              <Button
                className="ml-auto w-fit"
                onClick={submitLeaveRequest}
                disabled={formDisabled || (isBirthdayLeave && !birthdayLeaveDateValue)}
              >
                {formDisabled ? (submitting ? "Submitting…" : "Loading…") : "Submit For Approval"}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader className="bg-ex-surface/30">
            <div className="flex items-start gap-3">
              <div className="bg-ex-secondary/10 text-ex-secondary flex size-9 shrink-0 items-center justify-center rounded-lg">
                <Wallet className="size-4" aria-hidden />
              </div>
              <div className="min-w-0 space-y-0.5">
                <CardTitle>Balances</CardTitle>
                <CardDescription>Your current leave entitlements.</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-2.5 pt-5">
            <BalanceRow
              title="Paid Leave"
              detail={
                balancesLoading
                  ? "Loading monthly accrual…"
                  : `${balances?.paid?.used ?? 0} used · ${balances?.paid?.accrued ?? 0}/${balances?.paid?.allocated ?? 12} accrued`
              }
              badge={`${balancesLoading ? "…" : (balances?.paid?.available ?? 0)} Available`}
            />
            <BalanceRow
              title="Sick Leave"
              detail={
                balancesLoading
                  ? "Loading quarterly entitlement…"
                  : `${balances?.sick?.remaining ?? 0}/${balances?.sick?.allocated ?? 4} yearly remaining · ${balances?.sick?.expired ?? 0} expired`
              }
              badge={`${balancesLoading ? "…" : (balances?.sick?.available ?? 0)} This Quarter`}
            />
            <BalanceRow
              title="Casual Leave"
              detail={
                balancesLoading
                  ? "Loading quarterly entitlement…"
                  : `${balances?.casual?.remaining ?? 0}/${balances?.casual?.allocated ?? 4} yearly remaining · ${balances?.casual?.expired ?? 0} expired`
              }
              badge={`${balancesLoading ? "…" : (balances?.casual?.available ?? 0)} This Quarter`}
            />
            <BalanceRow
              title="Birthday Leave"
              detail="One day per calendar year"
              badge={`${balancesLoading ? "…" : (balances?.birthday?.available ?? 0)} Available`}
              badgeVariant="accent"
            />
            <BalanceRow
              title="Unpaid Leave"
              detail="Tracked separately from paid entitlements"
              badge={`${balancesLoading ? "…" : (balances?.unpaid?.used ?? 0)} Used`}
              badgeVariant="accent"
            />

            {(balances?.unpaid?.leaves?.length ?? 0) > 0 && (
              <div className="space-y-2 border-t pt-3">
                <p className="text-ex-muted text-xs font-medium tracking-wide uppercase">
                  Unpaid Leave History
                </p>
                <ul className="max-h-48 space-y-2 overflow-y-auto">
                  {balances?.unpaid?.leaves.map((leave, index) => (
                    <li
                      key={`${leave.date}-${leave.slot}-${index}`}
                      className="bg-ex-surface border-ex-border rounded-lg border p-2.5 text-xs"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">
                          {leave.date} {leave.duration ? ` · ${leave.duration}` : ""}
                        </span>
                        <div className="flex shrink-0 items-center gap-2">
                          {leave.status ? (
                            <Badge variant={statusBadgeVariant(leave.status)}>{leave.status}</Badge>
                          ) : null}
                          <span className="text-ex-muted">{formatLeaveDayCount(leave.days)}</span>
                        </div>
                      </div>
                      {leave.reason ? <p className="text-ex-muted mt-1">{leave.reason}</p> : null}
                      {leave.rejectReason ? (
                        <p className="mt-1 text-rose-600 dark:text-rose-400">
                          Rejected: {leave.rejectReason}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {applications.length > 0 && (
              <div className="space-y-2 border-t pt-3">
                <p className="text-ex-muted text-xs font-medium tracking-wide uppercase">
                  Your Leave Applications
                </p>
                <ul className="max-h-56 space-y-2 overflow-y-auto">
                  {applications.map((application) => (
                    <li
                      key={`${application.id}:${application.date}:${application.status}`}
                      className="bg-ex-surface border-ex-border rounded-lg border p-2.5 text-xs"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">
                          {formatLeaveTypeLabel(application.leaveType)} · {application.date}
                          {application.duration ? ` · ${application.duration}` : ""}
                        </span>
                        <div className="flex shrink-0 items-center gap-2">
                          {application.status ? (
                            <Badge variant={statusBadgeVariant(application.status)}>
                              {application.status}
                            </Badge>
                          ) : null}
                          {(application.days ?? 0) > 0 ? (
                            <span className="text-ex-muted">
                              {formatLeaveDayCount(application.days ?? 0)}
                            </span>
                          ) : null}
                        </div>
                      </div>

                      {application.reason ? (
                        <p className="text-ex-muted mt-1">{application.reason}</p>
                      ) : null}
                      {application.rejectReason ? (
                        <p className="mt-1 text-rose-600 dark:text-rose-400">
                          Rejected: {application.rejectReason}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <p className="text-ex-muted border-ex-border border-t pt-3 text-xs leading-relaxed">
              Paid leave accrues monthly and carries forward within the calendar year. Sick and
              casual leave provide one day per quarter and expire when the quarter ends. Applied
              leaves count toward availability until rejected.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
