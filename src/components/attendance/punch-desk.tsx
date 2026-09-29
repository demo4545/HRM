"use client";

import {
  Coffee,
  Loader2,
  LogIn,
  LogOut,
  PartyPopper,
  Sparkles,
  Sun,
  Timer,
  TrendingUp,
} from "lucide-react";

import { WorkTimer } from "@/components/attendance/work-timer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  IDEAL_BREAK_HOURS,
  IDEAL_WORKING_HOURS,
  isHalfDayWorkMode,
} from "@/lib/attendance/constants";
import { formatDuration, parseDurationToMs } from "@/lib/attendance/time";
import type { TodayAttendance } from "@/lib/attendance/client";
import { cn } from "@/lib/utils";

type PunchPhase = "idle" | "working" | "break" | "done";
type DayOutcome = "short" | "overtime" | "complete";

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function getPhase(
  today: TodayAttendance | null,
  hasPunchedIn: boolean,
  hasPunchedOut: boolean,
  onBreak: boolean,
): PunchPhase {
  if (hasPunchedOut) return "done";
  if (onBreak) return "break";
  if (hasPunchedIn) return "working";
  return "idle";
}

const phaseConfig: Record<
  PunchPhase,
  {
    title: string;
    subtitle: string;
    gradient: string;
    icon: typeof Sun;
    iconClass: string;
  }
> = {
  idle: {
    title: "Ready when you are",
    subtitle: "Tap below to start your day — we’ll track your hours automatically.",
    gradient:
      "from-teal-500/15 via-emerald-500/10 to-transparent dark:from-teal-400/20 dark:via-emerald-500/10",
    icon: Sun,
    iconClass: "text-amber-500 dark:text-amber-400",
  },
  working: {
    title: "You’re on the clock",
    subtitle: "Stay focused — your live timer is running below.",
    gradient: "from-teal-500/20 via-cyan-500/10 to-transparent dark:from-teal-400/25",
    icon: Sparkles,
    iconClass: "text-ex-secondary",
  },
  break: {
    title: "Enjoy your break",
    subtitle: "Timer is paused. Hit “Back to work” when you’re ready.",
    gradient: "from-amber-500/15 via-orange-500/10 to-transparent dark:from-amber-400/20",
    icon: Coffee,
    iconClass: "text-amber-600 dark:text-amber-400",
  },
  done: {
    title: "Day complete",
    subtitle: "Great work today — see you tomorrow!",
    gradient: "from-emerald-500/15 via-teal-500/10 to-transparent dark:from-emerald-400/20",
    icon: PartyPopper,
    iconClass: "text-emerald-600 dark:text-emerald-400",
  },
};

const doneOutcomeConfig: Record<
  DayOutcome,
  {
    title: string;
    subtitle: string;
    gradient: string;
    icon: typeof Sun;
    iconClass: string;
    totalBorder: string;
  }
> = {
  short: {
    title: "Left early today",
    subtitle: "You punched out before completing your 8-hour work target.",
    gradient: "from-amber-500/15 via-orange-500/10 to-transparent dark:from-amber-400/20",
    icon: LogOut,
    iconClass: "text-amber-600 dark:text-amber-400",
    totalBorder: "border-amber-300/60 dark:border-amber-700/50",
  },
  overtime: {
    title: "Day complete — overtime",
    subtitle: "You went beyond your 8-hour work target today. Nice effort!",
    gradient: "from-emerald-500/15 via-teal-500/10 to-transparent dark:from-emerald-400/20",
    icon: TrendingUp,
    iconClass: "text-emerald-600 dark:text-emerald-400",
    totalBorder: "border-emerald-300/50 dark:border-emerald-700/40",
  },
  complete: {
    title: "Day complete",
    subtitle: "Great work today — see you tomorrow!",
    gradient: "from-emerald-500/15 via-teal-500/10 to-transparent dark:from-emerald-400/20",
    icon: PartyPopper,
    iconClass: "text-emerald-600 dark:text-emerald-400",
    totalBorder: "border-ex-border",
  },
};

function getDayOutcome(today: TodayAttendance | null): DayOutcome | null {
  if (!today?.hasPunchedOut) return null;
  if (today.status === "Short Hours") return "short";
  if (today.status === "Overtime") return "overtime";
  return "complete";
}

/** Shortfall amount from stored overtime field (e.g. `-30m` → `30m`). */
function parseShortfallAmount(overtime: string | undefined): string | null {
  if (!overtime?.startsWith("-")) return null;
  const amount = overtime.slice(1).trim();
  return amount || null;
}

function statusBadgeVariant(status: string) {
  if (status === "Completed" || status === "Overtime") return "success" as const;
  if (status === "Short Hours") return "warning" as const;
  return "default" as const;
}

function StatPill({
  label,
  value,
  highlight,
  tone,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  tone?: "default" | "warning" | "success" | "pending" | "info";
}) {
  return (
    <div
      className={cn(
        "rounded-xl border px-3 py-2.5 text-center transition",
        tone === "warning" && "border-ex-chip-warning-border bg-ex-chip-warning-bg",
        tone === "success" && "border-ex-chip-success-border bg-ex-chip-success-bg",
        tone === "pending" && "border-ex-border bg-ex-elevated",
        tone === "info" && "border-ex-chip-info-border bg-ex-chip-info-bg",
        (!tone || tone === "default") &&
          (highlight
            ? "border-ex-secondary/30 bg-ex-secondary/10"
            : "border-ex-border bg-ex-elevated/80"),
      )}
    >
      <p className="text-ex-muted text-[10px] font-semibold tracking-wider uppercase">{label}</p>
      <p
        className={cn(
          "mt-0.5 text-sm font-semibold tabular-nums",
          tone === "warning" && "text-ex-chip-warning-fg",
          tone === "success" && "text-ex-chip-success-fg",
          tone === "pending" && "text-ex-primary",
          tone === "info" && "text-ex-chip-info-fg",
          !tone || tone === "default" ? "text-ex-primary" : "",
        )}
      >
        {value || "—"}
      </p>
    </div>
  );
}

export function PunchDesk({
  userName,
  today,
  loading,
  acting,
  actingAction,
  liveWorkedMs,
  liveBreakSessionMs = 0,
  liveBreakUsedMs,
  onPunchIn,
  onPunchOut,
  onBreakStart,
  onBreakEnd,
  onRequestCorrection,
}: {
  userName?: string;
  today: TodayAttendance | null;
  loading: boolean;
  acting: boolean;
  actingAction: "punch-in" | "punch-out" | "break-start" | "break-end" | null;
  liveWorkedMs: number;
  /** Elapsed time for the current open break. */
  liveBreakSessionMs?: number;
  /** Total break used today including the open break. Falls back to stored total. */
  liveBreakUsedMs?: number;
  onPunchIn: () => void;
  onPunchOut: () => void;
  onBreakStart: () => void;
  onBreakEnd: () => void;
  onRequestCorrection?: () => void;
}) {
  const hasPunchedIn = today?.hasPunchedIn ?? false;
  const hasPunchedOut = today?.hasPunchedOut ?? false;
  const onBreak = today?.onBreak ?? false;
  const isHalfDayLeave = isHalfDayWorkMode(today?.workMode);
  const workGoalHours = today?.idealHours ?? (isHalfDayLeave ? 4 : IDEAL_WORKING_HOURS);
  const leavePunchBlocked = Boolean(today?.leavePunchBlocked);
  const leavePunchBlockMessage = today?.leavePunchBlockMessage?.trim() ?? "";
  const phase = getPhase(today, hasPunchedIn, hasPunchedOut, onBreak);
  const dayOutcome = getDayOutcome(today);
  const shortfallAmount = parseShortfallAmount(today?.overtime);
  const config =
    phase === "done" && dayOutcome ? doneOutcomeConfig[dayOutcome] : phaseConfig[phase];
  const doneTotalBorder =
    phase === "done" && dayOutcome ? doneOutcomeConfig[dayOutcome].totalBorder : undefined;
  const PhaseIcon = config.icon;
  const firstName = userName?.split(" ")[0] ?? "there";

  const fourthStat = !hasPunchedOut
    ? { label: "Overtime", value: "—", tone: "default" as const }
    : dayOutcome === "short" && shortfallAmount
      ? {
          label: "Early out",
          value: shortfallAmount,
          tone: "warning" as const,
        }
      : dayOutcome === "overtime" && today?.overtime && today.overtime !== "—"
        ? { label: "Overtime", value: today.overtime, tone: "success" as const }
        : { label: "Overtime", value: "—", tone: "default" as const };

  const breakUsedMs =
    liveBreakUsedMs ??
    parseDurationToMs(today?.totalBreakTime ?? "") + (onBreak ? liveBreakSessionMs : 0);

  return (
    <div className="border-ex-border bg-ex-elevated overflow-hidden rounded-2xl border shadow-sm dark:shadow-none">
      <div
        className={cn("relative bg-gradient-to-br px-6 pt-6 pb-8 sm:px-8 sm:pt-8", config.gradient)}
      >
        <div className="bg-ex-secondary/10 pointer-events-none absolute -top-8 -right-8 size-40 rounded-full blur-3xl" />
        <div className="bg-ex-accent/10 pointer-events-none absolute -bottom-12 -left-8 size-32 rounded-full blur-2xl" />

        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-3">
            <p className="text-ex-muted text-sm font-medium">
              {getGreeting()}, <span className="text-ex-primary">{firstName}</span>
            </p>
            <div className="flex items-start gap-3">
              <div
                className={cn(
                  "bg-ex-elevated ring-ex-border flex size-12 shrink-0 items-center justify-center rounded-2xl shadow-sm ring-1",
                  phase === "working" && "animate-pulse",
                  phase === "break" && "animate-pulse",
                )}
              >
                <PhaseIcon className={cn("size-6", config.iconClass)} aria-hidden />
              </div>
              <div>
                <h2 className="text-ex-primary text-xl font-bold tracking-tight sm:text-2xl">
                  {config.title}
                </h2>
                <p className="text-ex-muted mt-1 max-w-md text-sm leading-relaxed">
                  {config.subtitle}
                </p>
              </div>
            </div>
            {today?.leavePunchBlocked ? (
              <Badge variant="info" className="w-fit gap-1.5">
                On leave — punch blocked
              </Badge>
            ) : today?.status && hasPunchedIn ? (
              <Badge variant={statusBadgeVariant(today.status)} className="w-fit">
                {onBreak && today.breakStart
                  ? `On break · since ${today.breakStart}`
                  : today.status}
                {!onBreak && hasPunchedOut && today.punchOut ? ` · Out ${today.punchOut}` : ""}
                {!onBreak && !hasPunchedOut && today.punchIn ? ` · In ${today.punchIn}` : ""}
              </Badge>
            ) : !hasPunchedIn ? (
              <Badge variant="info" className="w-fit gap-1.5">
                <LogIn className="size-3.5" aria-hidden />
                Punch in not done
              </Badge>
            ) : null}
          </div>

          {loading ? (
            <div className="flex h-40 items-center justify-center lg:w-48">
              <Loader2 className="text-ex-muted size-8 animate-spin" />
            </div>
          ) : phase === "break" ? (
            <WorkTimer
              workedMs={liveBreakSessionMs}
              progressMs={breakUsedMs}
              showProgress
              mode="break"
              label="Break Time"
              breakAllowanceHours={today?.idealBreakHours ?? IDEAL_BREAK_HOURS}
            />
          ) : phase === "working" ? (
            <WorkTimer
              workedMs={liveWorkedMs}
              showProgress
              idealHours={workGoalHours}
            />
          ) : phase === "done" ? (
            <div
              className={cn(
                "bg-ex-elevated/90 flex flex-col items-center rounded-2xl border px-6 py-5 text-center shadow-sm backdrop-blur-sm",
                doneTotalBorder ?? "border-ex-border",
              )}
            >
              <p className="text-ex-muted text-xs font-semibold tracking-wider uppercase">
                Today&apos;s total
              </p>
              <p className="text-ex-primary mt-1 font-mono text-3xl font-bold tabular-nums">
                {today?.workingHours ?? "—"}
              </p>
              {dayOutcome === "short" && shortfallAmount ? (
                <p className="mt-2 text-sm font-medium text-amber-600 dark:text-amber-400">
                  {shortfallAmount} short of {workGoalHours}h
                </p>
              ) : null}
              {dayOutcome === "overtime" && today?.overtime && today.overtime !== "—" ? (
                <p className="mt-2 text-sm font-medium text-emerald-600 dark:text-emerald-400">
                  +{today.overtime} overtime
                </p>
              ) : null}
            </div>
          ) : (
            <div className="hidden items-center justify-center lg:flex lg:w-40">
              <div className="relative">
                <div className="bg-ex-secondary/20 absolute inset-0 animate-ping rounded-full" />
                <div className="border-ex-secondary/40 bg-ex-elevated/80 relative flex size-24 items-center justify-center rounded-full border-2 border-dashed">
                  <Timer className="text-ex-secondary/60 size-10" aria-hidden />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="border-ex-border bg-ex-elevated space-y-4 border-t p-4 sm:p-6">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatPill
            label="Punch in"
            value={
              hasPunchedIn ? (today?.punchIn ?? "") : leavePunchBlocked ? "On leave" : "Not done"
            }
            highlight={hasPunchedIn}
            tone={hasPunchedIn ? "default" : leavePunchBlocked ? "info" : "pending"}
          />
          <StatPill label="Punch out" value={today?.punchOut ?? ""} />
          <StatPill
            label="Break"
            value={
              hasPunchedIn
                ? isHalfDayLeave
                  ? "Not allowed"
                  : formatDuration(breakUsedMs)
                : "0h 0m"
            }
            highlight={onBreak}
            tone={onBreak ? "warning" : "default"}
          />
          <StatPill label={fourthStat.label} value={fourthStat.value} tone={fourthStat.tone} />
        </div>

        {leavePunchBlocked && leavePunchBlockMessage ? (
          <div
            role="status"
            className="border-ex-chip-info-border bg-ex-chip-info-bg flex items-start gap-3 rounded-xl border px-4 py-3"
          >
            <div className="bg-ex-elevated/80 flex size-9 shrink-0 items-center justify-center rounded-full">
              <Sun className="text-ex-chip-info-fg size-4" aria-hidden />
            </div>
            <div className="min-w-0 space-y-0.5">
              <p className="text-ex-chip-info-fg text-sm font-semibold">Punch unavailable</p>
              <p className="text-ex-chip-info-fg/90 text-sm leading-relaxed">
                {leavePunchBlockMessage}
              </p>
            </div>
          </div>
        ) : null}

        {dayOutcome === "short" && shortfallAmount ? (
          <div
            role="status"
            className="flex items-start gap-3 rounded-xl border border-amber-200/90 bg-amber-50 px-4 py-3 dark:border-amber-800/60 dark:bg-amber-950/40"
          >
            <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/50">
              <LogOut className="size-4 text-amber-700 dark:text-amber-300" aria-hidden />
            </div>
            <div className="min-w-0 space-y-0.5">
              <p className="text-sm font-semibold text-amber-950 dark:text-amber-50">
                Punched out early
              </p>
              <p className="text-sm leading-relaxed text-amber-900/85 dark:text-amber-100/85">
                You left <span className="font-semibold tabular-nums">{shortfallAmount}</span>{" "}
                before your {workGoalHours}h work goal
                {today?.punchOut ? (
                  <>
                    {" "}
                    (out at <span className="font-medium">{today.punchOut}</span>)
                  </>
                ) : null}
                .
              </p>
              {today?.earlyLeaveReason?.trim() ? (
                <p className="mt-2 rounded-lg bg-amber-100/60 px-3 py-2 text-sm text-amber-950 dark:bg-amber-900/40 dark:text-amber-50">
                  <span className="font-medium">Reason: </span>
                  {today.earlyLeaveReason}
                </p>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          {phase === "idle" ? (
            <Button
              size="lg"
              className="shadow-ex-secondary/20 min-h-12 min-w-[200px] flex-1 gap-2 text-base font-semibold shadow-md sm:flex-none"
              disabled={acting || loading || leavePunchBlocked}
              onClick={onPunchIn}
            >
              {actingAction === "punch-in" ? (
                <Loader2 className="size-5 animate-spin" />
              ) : (
                <LogIn className="size-5" />
              )}
              {actingAction === "punch-in" ? "Starting your day…" : "Punch in — Start my day"}
            </Button>
          ) : null}

          {phase === "working" ? (
            <>
              <Button
                size="lg"
                variant="outline"
                className="h-12 gap-2 border-amber-300/60 bg-amber-50/80 text-amber-900 hover:bg-amber-100 dark:border-amber-700/50 dark:bg-amber-950/40 dark:text-amber-100 dark:hover:bg-amber-950/60 dark:hover:text-amber-50"
                disabled={acting || loading || isHalfDayLeave || leavePunchBlocked}
                onClick={onBreakStart}
              >
                {actingAction === "break-start" ? (
                  <Loader2 className="size-5 animate-spin" />
                ) : (
                  <Coffee className="size-5" />
                )}
                Take a break
              </Button>
              <Button
                size="lg"
                variant="secondary"
                className="h-12 min-w-[160px] gap-2 font-semibold"
                disabled={acting || loading || leavePunchBlocked}
                onClick={onPunchOut}
              >
                {actingAction === "punch-out" ? (
                  <Loader2 className="size-5 animate-spin" />
                ) : (
                  <LogOut className="size-5" />
                )}
                Punch out
              </Button>
            </>
          ) : null}

          {phase === "break" ? (
            <Button
              size="lg"
              className="h-12 min-w-[200px] flex-1 gap-2 text-base font-semibold sm:flex-none"
              disabled={acting || loading || leavePunchBlocked}
              onClick={onBreakEnd}
            >
              {actingAction === "break-end" ? (
                <Loader2 className="size-5 animate-spin" />
              ) : (
                <Sparkles className="size-5" />
              )}
              {actingAction === "break-end" ? "Wrapping up break…" : "Back to work"}
            </Button>
          ) : null}

          {phase === "done" ? (
            dayOutcome === "short" ? (
              <p className="text-ex-primary flex flex-1 items-center gap-2 text-sm">
                <LogOut className="text-ex-accent size-4 shrink-0" aria-hidden />
                If your punch times are wrong, request a correction below.
              </p>
            ) : (
              <p className="text-ex-muted flex flex-1 items-center gap-2 text-sm">
                <PartyPopper className="size-4 shrink-0 text-emerald-600" aria-hidden />
                You&apos;re all set for today. Rest well!
              </p>
            )
          ) : null}

          {hasPunchedIn && onRequestCorrection ? (
            <Button
              variant="ghost"
              size="sm"
              className="text-ex-muted sm:ml-auto"
              onClick={onRequestCorrection}
            >
              Request correction
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
