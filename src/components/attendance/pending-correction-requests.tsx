"use client";

import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  fetchCorrectionRequests,
  reviewCorrection,
  type CorrectionRequestDto,
} from "@/lib/attendance/client";
import { CORRECTION_STATUS } from "@/lib/attendance/constants";
import { toUserFacingActionError, toUserFacingFetchError } from "@/lib/api/user-facing-error";
import { useNotifications } from "@/contexts/notifications-provider";

function fieldLabel(field: string): string {
  const labels: Record<string, string> = {
    punchIn: "Punch In",
    punchOut: "Punch Out",
    breakStart: "Break Start",
    breakEnd: "Break End",
  };
  return labels[field] ?? field;
}

export function PendingCorrectionRequests() {
  const { refresh: refreshNotifications, pushToast } = useNotifications();
  const [corrections, setCorrections] = useState<CorrectionRequestDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState<{
    id: string;
    status: "Approved" | "Rejected";
  } | null>(null);

  const loadCorrections = useCallback(async () => {
    try {
      const rows = await fetchCorrectionRequests();
      setCorrections(rows.filter((row) => row.status === CORRECTION_STATUS.PENDING));
      setError(null);
    } catch (err) {
      setError(toUserFacingFetchError(err));
      setCorrections([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load of pending corrections
    void loadCorrections();
  }, [loadCorrections]);

  useEffect(() => {
    if (loading) return;
    if (typeof window === "undefined") return;
    if (window.location.hash !== "#corrections") return;
    document.getElementById("corrections")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [loading, corrections.length]);

  async function handleReview(id: string, status: "Approved" | "Rejected") {
    setReviewing({ id, status });
    setError(null);
    try {
      await reviewCorrection(id, status);
      await loadCorrections();
      await refreshNotifications();
      pushToast({
        title: status === "Approved" ? "Correction Approved" : "Correction Rejected",
        body:
          status === "Approved"
            ? "The attendance record was updated and the employee has been notified."
            : "The correction request was rejected and the employee has been notified.",
        href: "/notifications",
        variant: "success",
      });
    } catch (err) {
      setError(toUserFacingActionError(err));
    } finally {
      setReviewing(null);
    }
  }

  if (loading && corrections.length === 0) {
    return (
      <Card id="corrections">
        <CardContent className="text-ex-muted flex items-center justify-center gap-2 py-8 text-sm">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Loading Correction Requests…
        </CardContent>
      </Card>
    );
  }

  if (!loading && corrections.length === 0 && !error) {
    return null;
  }

  return (
    <Card id="corrections" className="scroll-mt-6">
      <CardHeader>
        <CardTitle className="text-base">Pending Correction Requests</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <p className="border-ex-banner-danger-border bg-ex-banner-danger-bg text-ex-banner-danger-fg rounded-xl border px-4 py-3 text-sm">
            {error}
          </p>
        ) : null}

        {corrections.length === 0 ? (
          <p className="text-ex-muted text-sm">No Pending Correction Requests.</p>
        ) : (
          corrections.map((c) => (
            <div
              key={c.id}
              className="border-ex-border bg-ex-surface/50 flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="text-sm">
                <p className="text-ex-primary font-medium">
                  {c.employeeName} · {c.date} · {fieldLabel(c.field)}
                </p>
                <p className="text-ex-muted">
                  {c.originalValue || "—"} → {c.requestedValue}
                </p>
                <p className="text-ex-muted mt-1">{c.reason}</p>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={reviewing !== null}
                  onClick={() => void handleReview(c.id, "Approved")}
                >
                  {reviewing?.id === c.id && reviewing.status === "Approved" ? (
                    <>
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                      Approving…
                    </>
                  ) : (
                    "Approve"
                  )}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={reviewing !== null}
                  onClick={() => void handleReview(c.id, "Rejected")}
                >
                  {reviewing?.id === c.id && reviewing.status === "Rejected" ? (
                    <>
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                      Rejecting…
                    </>
                  ) : (
                    "Reject"
                  )}
                </Button>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
