"use client";

import Link from "next/link";
import { Clock } from "lucide-react";

import { PunchInBanner } from "@/components/attendance/punch-in-status-flag";
import { WorkTimer } from "@/components/attendance/work-timer";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/contexts/auth-provider";
import { roleCanPunchInOut } from "@/lib/auth/roles";
import { IDEAL_WORKING_HOURS } from "@/lib/attendance/constants";
import { formatDuration } from "@/lib/attendance/time";
import { useTodayAttendance } from "@/hooks/use-today-attendance";
import { cn } from "@/lib/utils";

export function AttendanceWidget({
  className,
  loading: externalLoading,
}: {
  className?: string;
  /** When true, keep the loader even if attendance already finished fetching. */
  loading?: boolean;
}) {
  const { user } = useAuth();
  const { today, loading, liveWorkedMs, liveBreakUsedMs } = useTodayAttendance();

  if (!user || !roleCanPunchInOut(user.role)) {
    return null;
  }

  const remainingMs = Math.max(0, IDEAL_WORKING_HOURS * 60 * 60 * 1000 - liveWorkedMs);
  const showLoading = externalLoading || loading;

  return (
    <Card className={cn("flex flex-col overflow-hidden", className)}>
      <CardHeader className="bg-ex-surface/40 flex flex-row items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="bg-ex-secondary/15 text-ex-secondary flex size-10 shrink-0 items-center justify-center rounded-xl">
            <Clock className="size-5" />
          </div>
          <div className="min-w-0">
            <CardTitle>Today&apos;s Attendance</CardTitle>
            <p className="text-ex-muted mt-0.5 text-sm">Punch status and worked hours</p>
          </div>
        </div>
        <Link href="/employee/punch" className="shrink-0">
          <Button variant="outline" size="sm" type="button">
            Punch
          </Button>
        </Link>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col p-5">
        {showLoading ? (
          <p className="text-ex-muted text-sm">Loading attendance…</p>
        ) : !today?.hasPunchedIn ? (
          <PunchInBanner />
        ) : (
          <div className="space-y-3">
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-ex-muted">Punch In</dt>
                <dd className="text-ex-primary font-medium">{today.punchIn || "—"}</dd>
              </div>
              <div>
                <dt className="text-ex-muted">Current Break</dt>
                <dd className="text-ex-primary font-medium">{today.onBreak ? "Yes" : "No"}</dd>
              </div>
              <div>
                <dt className="text-ex-muted">Work Goal</dt>
                <dd className="text-ex-primary font-medium">{IDEAL_WORKING_HOURS}h</dd>
              </div>
              <div>
                <dt className="text-ex-muted">Work Left</dt>
                <dd className="text-ex-primary font-medium">
                  {today.hasPunchedOut ? "—" : formatDuration(remainingMs)}
                </dd>
              </div>
              <div>
                <dt className="text-ex-muted">Break</dt>
                <dd className="text-ex-primary font-medium">{formatDuration(liveBreakUsedMs)}</dd>
              </div>
              <div>
                <dt className="text-ex-muted">Punch Out</dt>
                <dd className="text-ex-primary font-medium">{today.punchOut || "—"}</dd>
              </div>
            </dl>
            <WorkTimer workedMs={liveWorkedMs} />
            {today.status ? <p className="text-ex-muted text-xs">Status: {today.status}</p> : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
