"use client";

import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { CorrectionForm } from "@/components/attendance/correction-form";
import { AbsenceExplanationPanel } from "@/components/attendance/absence-explanation-panel";
import { EarlyLeaveDialog } from "@/components/attendance/early-leave-dialog";
import { PunchDesk, PunchDeskSkeleton } from "@/components/attendance/punch-desk";
import { AccessDenied } from "@/components/ui/access-denied";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useTodayAttendance } from "@/hooks/use-today-attendance";
import { useAuth } from "@/contexts/auth-provider";
import { useNotifications } from "@/contexts/notifications-provider";
import { toUserFacingActionError } from "@/lib/api/user-facing-error";
import { roleCanPunchInOut } from "@/lib/auth/roles";
import { roleRequiresAbsenceExplanationGate } from "@/lib/attendance/absence-gate";
import { updateDailyUpdate } from "@/lib/attendance/client";
import { WORK_MODE, WORK_MODE_OPTIONS, workModeOptionLabel } from "@/lib/attendance/constants";

export default function PunchPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { pushToast } = useNotifications();
  const canPunch = user ? roleCanPunchInOut(user.role) : false;
  const showAbsenceGate = user ? roleRequiresAbsenceExplanationGate(user.role) : false;
  const {
    today,
    loading,
    error,
    acting,
    actingAction,
    liveWorkedMs,
    liveBreakSessionMs,
    liveBreakUsedMs,
    runAction,
    refresh,
  } = useTodayAttendance();
  const [showCorrection, setShowCorrection] = useState(false);
  const correctionFormRef = useRef<HTMLDivElement>(null);
  const [earlyLeaveOpen, setEarlyLeaveOpen] = useState(false);
  const [earlyLeaveError, setEarlyLeaveError] = useState<string | null>(null);
  const [dailyUpdateDraft, setDailyUpdateDraft] = useState("");
  const [dailyUpdateSaving, setDailyUpdateSaving] = useState(false);
  const [dailyUpdateError, setDailyUpdateError] = useState<string | null>(null);
  const [workMode, setWorkMode] = useState<string>(WORK_MODE.FULL_DAY_ONSITE);
  // Stay blocked until the absence check finishes successfully with no pending items.
  // Do not trust a login "false" hint to unhide the desk — that race can flash PunchDesk
  // before the late-coming explanation loads, then bounce the user back to the form.
  const [absenceGate, setAbsenceGate] = useState<{
    blocked: boolean;
    error: string | null;
  } | null>(() => (showAbsenceGate ? null : { blocked: false, error: null }));
  const absenceGateChecking = showAbsenceGate && absenceGate === null;
  const absenceGateBlocked = showAbsenceGate && (absenceGate?.blocked ?? true);
  const absenceGateError = showAbsenceGate ? (absenceGate?.error ?? null) : null;
  const showPunchSkeleton = absenceGateChecking || (!absenceGateBlocked && loading && !today);

  const targetMs = (today?.idealHours ?? 8) * 60 * 60 * 1000;
  const shortfallMs = Math.max(0, targetMs - liveWorkedMs);
  const isLeavingEarly = Boolean(today?.hasPunchedIn && !today?.hasPunchedOut && shortfallMs > 0);

  async function handlePunchOut() {
    setEarlyLeaveError(null);
    setEarlyLeaveOpen(true);
  }

  async function confirmEarlyLeave(payload: { earlyLeaveReason?: string; dailyUpdate: string }) {
    setEarlyLeaveError(null);
    try {
      await runAction("punch-out", payload);
      // Empty string so the field does not fall back to the saved EOD update.
      setDailyUpdateDraft("");
      setEarlyLeaveOpen(false);
    } catch (err) {
      setEarlyLeaveError(toUserFacingActionError(err));
    }
  }

  async function handleSaveDailyUpdate() {
    if (!today?.date) return;
    const value = dailyUpdateDraft.trim();
    if (!value) {
      setDailyUpdateError("Daily update cannot be empty");
      return;
    }
    setDailyUpdateSaving(true);
    setDailyUpdateError(null);
    try {
      await updateDailyUpdate(today.date, value);
      // Empty string (not null) so the field does not fall back to the saved value.
      setDailyUpdateDraft("");
      await refresh();
      pushToast({
        title: "Daily update saved",
        body: "Your update for today was saved successfully.",
        variant: "success",
      });
    } catch (err) {
      setDailyUpdateError(toUserFacingActionError(err));
    } finally {
      setDailyUpdateSaving(false);
    }
  }

  useEffect(() => {
    if (!authLoading && user && !canPunch) {
      router.replace("/dashboard");
    }
  }, [authLoading, user, canPunch, router]);

  useEffect(() => {
    if (!showCorrection) return;
    correctionFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [showCorrection]);

  if (authLoading) {
    return (
      <div className="w-full space-y-6" aria-busy aria-live="polite" aria-label="Loading punch desk">
        <div className="space-y-2">
          <Skeleton className="h-8 w-40 rounded-md" />
          <Skeleton className="h-4 w-72 max-w-full rounded-md" />
        </div>
        <div className="border-ex-border space-y-2 rounded-xl border p-4">
          <Skeleton className="h-5 w-24 rounded-md" />
          <Skeleton className="h-10 w-full rounded-lg" />
          <Skeleton className="h-3 w-56 rounded-md" />
        </div>
        <PunchDeskSkeleton />
      </div>
    );
  }

  if (!canPunch) {
    return (
      <div className="w-full space-y-6">
        <AccessDenied
          title="Punch Desk Unavailable"
          description="Punch in/out is only available for Employee and HR Manager roles."
          action={
            <Link href="/dashboard">
              <Button variant="outline" size="sm">
                <ArrowLeft className="size-4" />
                Back to Dashboard
              </Button>
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="w-full space-y-6">
      <div className="space-y-1">
        <h1 className="text-ex-primary text-2xl font-bold tracking-tight">Punch Desk</h1>
        <p className="text-ex-muted text-sm">
          Your daily check-in — one tap to start, one tap to finish.
        </p>
      </div>

      {error || absenceGateError ? (
        <p className="border-ex-banner-danger-border bg-ex-banner-danger-bg text-ex-banner-danger-fg rounded-xl border px-4 py-3 text-sm">
          {error ?? absenceGateError}
        </p>
      ) : null}

      {showAbsenceGate ? (
        <AbsenceExplanationPanel
          onGateChange={(status) => {
            setAbsenceGate({ blocked: status.blocked, error: status.error });
          }}
          onSubmitted={() => {
            void refresh();
          }}
        />
      ) : null}

      {showPunchSkeleton ? (
        <>
          <div className="border-ex-border space-y-2 rounded-xl border p-4">
            <Skeleton className="h-5 w-24 rounded-md" />
            <Skeleton className="h-10 w-full rounded-lg" />
            <Skeleton className="h-3 w-56 rounded-md" />
          </div>
          <PunchDeskSkeleton />
        </>
      ) : !absenceGateBlocked ? (
        <>
          {!today?.hasPunchedIn ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Work Mode</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Select
                  value={workMode}
                  onChange={(e) => setWorkMode(e.target.value)}
                  disabled={acting || loading}
                >
                  {WORK_MODE_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {workModeOptionLabel(option)}
                    </option>
                  ))}
                </Select>
                <p className="text-ex-muted text-xs">
                  This mode will be saved in today&apos;s attendance row.
                </p>
              </CardContent>
            </Card>
          ) : null}

          <PunchDesk
            userName={user?.name}
            today={today}
            loading={loading}
            acting={acting}
            actingAction={actingAction}
            liveWorkedMs={liveWorkedMs}
            liveBreakSessionMs={liveBreakSessionMs}
            liveBreakUsedMs={liveBreakUsedMs}
            onPunchIn={() => void runAction("punch-in", { workMode })}
            onPunchOut={() => void handlePunchOut()}
            onBreakStart={() => void runAction("break-start")}
            onBreakEnd={() => void runAction("break-end")}
            onRequestCorrection={
              today?.hasPunchedIn ? () => setShowCorrection((v) => !v) : undefined
            }
          />

          <EarlyLeaveDialog
            key={`${today?.date ?? "today"}-${earlyLeaveOpen ? "open" : "closed"}`}
            open={earlyLeaveOpen}
            shortfallMs={shortfallMs}
            requireEarlyLeaveReason={isLeavingEarly}
            initialDailyUpdate={today?.dailyUpdate ?? ""}
            submitting={acting}
            error={earlyLeaveError}
            onConfirm={(payload) => void confirmEarlyLeave(payload)}
            onCancel={() => {
              if (!acting) {
                setEarlyLeaveOpen(false);
                setEarlyLeaveError(null);
              }
            }}
          />

          {today?.hasPunchedIn ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Daily Update</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <textarea
                  value={dailyUpdateDraft}
                  onChange={(e) => setDailyUpdateDraft(e.target.value)}
                  placeholder="Add completed work for this day"
                  rows={4}
                  className="border-ex-border bg-ex-elevated w-full rounded-md border px-3 py-2 text-sm"
                  disabled={dailyUpdateSaving}
                />
                {dailyUpdateError ? (
                  <p className="text-sm text-red-600 dark:text-red-400">{dailyUpdateError}</p>
                ) : null}
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    onClick={() => void handleSaveDailyUpdate()}
                    disabled={dailyUpdateSaving || !dailyUpdateDraft.trim()}
                  >
                    {dailyUpdateSaving ? (
                      <>
                        <Loader2 className="size-4 animate-spin" aria-hidden />
                        Saving...
                      </>
                    ) : (
                      "Save Update"
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : null}

          {showCorrection && today?.hasPunchedIn ? (
            <div ref={correctionFormRef} className="scroll-mt-6">
              <CorrectionForm
                date={today.date}
                onSuccess={() => setShowCorrection(false)}
                onCancel={() => setShowCorrection(false)}
              />
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
