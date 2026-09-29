"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { useNotifications } from "@/contexts/notifications-provider";
import {
  WORK_MODE,
  WORK_MODE_OPTIONS,
  isPunchOptionalWorkMode,
  workModeOptionLabel,
} from "@/lib/attendance/constants";
import type { AttendanceHistoryRow } from "@/lib/attendance/client";
import { clockToTimeInput, localTodayIso } from "@/lib/attendance/manual-entry";

export type HrAttendanceFormValues = {
  date: string;
  workMode: string;
  punchIn: string;
  punchOut: string;
  breakStart: string;
  breakEnd: string;
};

type HrAttendanceFormProps = {
  employeeLabel?: string;
  initialDate?: string;
  initialRow?: AttendanceHistoryRow | null;
  submitting?: boolean;
  onSubmit: (values: HrAttendanceFormValues) => Promise<void>;
  onCancel?: () => void;
};

function clampToTodayOrEarlier(date: string): string {
  const today = localTodayIso();
  if (!date) return today;
  return date > today ? today : date;
}

function emptyForm(date = ""): HrAttendanceFormValues {
  return {
    date: clampToTodayOrEarlier(date),
    workMode: WORK_MODE.FULL_DAY_ONSITE,
    punchIn: "",
    punchOut: "",
    breakStart: "",
    breakEnd: "",
  };
}

function buildInitialForm(
  initialDate?: string,
  initialRow?: AttendanceHistoryRow | null,
): HrAttendanceFormValues {
  if (!initialRow) return emptyForm(initialDate ?? "");

  const baseDate = new Date(`${initialRow.date}T12:00:00`);
  return {
    date: clampToTodayOrEarlier(initialRow.date),
    workMode: initialRow.workMode?.trim() || WORK_MODE.FULL_DAY_ONSITE,
    punchIn: clockToTimeInput(initialRow.punchIn ?? "", baseDate),
    punchOut: clockToTimeInput(initialRow.punchOut ?? "", baseDate),
    breakStart: clockToTimeInput(initialRow.breakStart ?? "", baseDate),
    breakEnd: clockToTimeInput(initialRow.breakEnd ?? "", baseDate),
  };
}

export function HrAttendanceForm({
  employeeLabel,
  initialDate,
  initialRow,
  submitting = false,
  onSubmit,
  onCancel,
}: HrAttendanceFormProps) {
  const { pushToast } = useNotifications();
  const [form, setForm] = useState(() => buildInitialForm(initialDate, initialRow));
  const maxDate = localTodayIso();
  const punchOptional = isPunchOptionalWorkMode(form.workMode);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (form.date > maxDate) {
      pushToast({
        title: "Invalid date",
        body: "Future dates are not allowed. Choose today or an earlier date.",
        variant: "error",
      });
      return;
    }
    try {
      await onSubmit(form);
    } catch {
      // Parent (attendance history page) already shows a toaster for save failures.
    }
  }

  return (
    <form
      onSubmit={(e) => void handleSubmit(e)}
      className="border-ex-border bg-ex-elevated space-y-4 rounded-xl border p-5"
    >
      <div>
        <h3 className="text-ex-primary text-base font-semibold">
          {initialRow ? "Edit attendance" : "Add attendance"}
        </h3>
        {employeeLabel ? <p className="text-ex-muted mt-1 text-sm">For {employeeLabel}</p> : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="hr-attendance-date">Date</Label>
          <Input
            id="hr-attendance-date"
            type="date"
            required
            max={maxDate}
            value={form.date}
            onChange={(e) =>
              setForm((prev) => ({ ...prev, date: clampToTodayOrEarlier(e.target.value) }))
            }
            disabled={submitting || Boolean(initialRow)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="hr-attendance-work-mode">Work mode</Label>
          <Select
            id="hr-attendance-work-mode"
            value={form.workMode}
            onChange={(e) =>
              setForm((prev) => {
                const workMode = e.target.value;
                if (isPunchOptionalWorkMode(workMode)) {
                  return {
                    ...prev,
                    workMode,
                    punchIn: "",
                    punchOut: "",
                    breakStart: "",
                    breakEnd: "",
                  };
                }
                return { ...prev, workMode };
              })
            }
            disabled={submitting}
          >
            {WORK_MODE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {workModeOptionLabel(option)}
              </option>
            ))}
          </Select>
        </div>
        {!punchOptional ? (
          <>
            <div className="space-y-2">
              <Label htmlFor="hr-attendance-punch-in">Punch in</Label>
              <Input
                id="hr-attendance-punch-in"
                type="time"
                value={form.punchIn}
                onChange={(e) => setForm((prev) => ({ ...prev, punchIn: e.target.value }))}
                disabled={submitting}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="hr-attendance-punch-out">Punch out</Label>
              <Input
                id="hr-attendance-punch-out"
                type="time"
                value={form.punchOut}
                onChange={(e) => setForm((prev) => ({ ...prev, punchOut: e.target.value }))}
                disabled={submitting}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="hr-attendance-break-start">Break start</Label>
              <Input
                id="hr-attendance-break-start"
                type="time"
                value={form.breakStart}
                onChange={(e) => setForm((prev) => ({ ...prev, breakStart: e.target.value }))}
                disabled={submitting}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="hr-attendance-break-end">Break end</Label>
              <Input
                id="hr-attendance-break-end"
                type="time"
                value={form.breakEnd}
                onChange={(e) => setForm((prev) => ({ ...prev, breakEnd: e.target.value }))}
                disabled={submitting}
              />
            </div>
          </>
        ) : null}
      </div>

      <p className="text-ex-muted text-xs">
        {punchOptional
          ? "Punch and break times are not needed for leave or holiday. Saving marks the day as On Leave."
          : "Set punch in/out for missed punches. Break start and end must both be filled to record break time. Working hours and status are recalculated automatically when punch out is set."}
      </p>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={submitting}>
          {submitting ? "Saving…" : initialRow ? "Update attendance" : "Save attendance"}
        </Button>
        {onCancel ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onCancel}
            disabled={submitting}
          >
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}
