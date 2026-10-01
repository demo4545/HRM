"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { submitCorrectionRequest } from "@/lib/attendance/client";
import { formatWallClockTime } from "@/lib/attendance/time";
import { toUserFacingActionError } from "@/lib/api/user-facing-error";

export function CorrectionForm({
  date,
  onSuccess,
  onCancel,
}: {
  date?: string;
  onSuccess?: () => void;
  onCancel?: () => void;
}) {
  const [field, setField] = useState("punchIn");
  const [requestedTime, setRequestedTime] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const [hours, minutes] = requestedTime.split(":").map((p) => parseInt(p, 10));
      const clock = formatWallClockTime(hours || 0, minutes || 0);

      await submitCorrectionRequest({
        field,
        requestedTime: clock,
        reason,
        date,
      });
      onSuccess?.();
    } catch (err) {
      setError(toUserFacingActionError(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="border-ex-border bg-ex-elevated space-y-4 rounded-xl border p-4"
    >
      <div className="space-y-2">
        <Label htmlFor="correction-field">Field</Label>
        <Select id="correction-field" value={field} onChange={(e) => setField(e.target.value)}>
          <option value="punchIn">Punch In</option>
          <option value="punchOut">Punch Out</option>
          <option value="breakStart">Break Start</option>
          <option value="breakEnd">Break End</option>
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="correction-time">Requested Time</Label>
        <Input
          id="correction-time"
          type="time"
          required
          value={requestedTime}
          onChange={(e) => setRequestedTime(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="correction-reason">Reason</Label>
        <Textarea
          id="correction-reason"
          required
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Explain why this correction is needed"
        />
      </div>
      {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={submitting}>
          {submitting ? "Submitting…" : "Submit Request"}
        </Button>
        {onCancel ? (
          <Button type="button" variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}
