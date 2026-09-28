"use client";

import { useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";

import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { DataTable } from "@/components/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/auth-provider";
import {
  fetchOvertimeRequests,
  reviewOvertimeRequest,
  type OvertimeRequestDto,
} from "@/lib/attendance/client";
import { canReviewOvertime, canReviewOvertimeRequest } from "@/lib/auth/roles";
import { toUserFacingActionError, toUserFacingFetchError } from "@/lib/api/user-facing-error";
import { ROLES } from "@/app/consts/common";

function statusVariant(status: OvertimeRequestDto["status"]) {
  if (status === "Approved") return "success" as const;
  if (status === "Rejected" || status === "Cancelled") return "danger" as const;
  return "warning" as const;
}

function submittedByLabel(role?: string): string {
  const value = String(role ?? "")
    .trim()
    .toLowerCase();
  if (value === ROLES.HR_MANAGER) return "HR";
  if (value === ROLES.SUPER_ADMIN) return "Super Admin";
  if (value === ROLES.EMPLOYEE) return "Employee";
  return value ? value : "Employee";
}

export default function OvertimePage() {
  const { user } = useAuth();
  const canSeeActions = user ? canReviewOvertime(user.role) : false;
  const [rows, setRows] = useState<OvertimeRequestDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);
  const [pendingReview, setPendingReview] = useState<{
    row: OvertimeRequestDto;
    status: "Approved" | "Rejected" | "Cancelled";
  } | null>(null);
  const [reviewRemarks, setReviewRemarks] = useState("");

  function canDecideRow(row: OvertimeRequestDto): boolean {
    if (!user) return false;
    return canReviewOvertimeRequest(user.role, row.requestedByRole);
  }

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setRows(await fetchOvertimeRequests());
    } catch (err) {
      setError(toUserFacingFetchError(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await fetchOvertimeRequests();
        if (!cancelled) setRows(data);
      } catch (err) {
        if (!cancelled) {
          setError(toUserFacingFetchError(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function decide(
    row: OvertimeRequestDto,
    status: "Approved" | "Rejected" | "Cancelled",
    remarks: string,
  ) {
    setActingId(row.id);
    setError(null);
    try {
      await reviewOvertimeRequest(row.id, status, remarks);
      setPendingReview(null);
      setReviewRemarks("");
      await load();
    } catch (err) {
      setError(toUserFacingActionError(err));
    } finally {
      setActingId(null);
    }
  }

  const pendingCount = useMemo(() => rows.filter((r) => r.status === "Pending").length, [rows]);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Overtime Approvals"
        description="Employee-submitted OT can be accepted or rejected by HR or Super Admin. OT submitted by HR is reviewed by Super Admin only. Approved OT can later be cancelled so it is not paid."
        actions={
          <div className="flex items-center gap-2">
            <Badge variant={pendingCount > 0 ? "warning" : "default"}>{pendingCount} pending</Badge>
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        }
      />
      {error ? (
        <p className="border-ex-banner-danger-border bg-ex-banner-danger-bg text-ex-banner-danger-fg rounded-xl border px-4 py-3 text-sm">
          {error}
        </p>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle>Queue</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <DataTable
            loading={loading}
            className="rounded-none border-0 shadow-none"
            rows={rows}
            columns={[
              {
                key: "employeeName",
                header: "Employee",
                render: (r) => (
                  <div>
                    <p className="text-ex-primary font-medium">{r.employeeName}</p>
                    <p className="text-ex-muted text-xs">{r.employeeId}</p>
                  </div>
                ),
              },
              { key: "date", header: "Date" },
              { key: "overtime", header: "OT" },
              {
                key: "requestedByRole",
                header: "Submitted by",
                render: (r) => (
                  <span className="text-ex-muted text-sm">{submittedByLabel(r.requestedByRole)}</span>
                ),
              },
              {
                key: "comment",
                header: "Employee note",
                render: (r) =>
                  r.comment?.trim() ? (
                    <span className="text-ex-muted line-clamp-2 text-sm" title={r.comment}>
                      {r.comment}
                    </span>
                  ) : (
                    <span className="text-ex-muted">—</span>
                  ),
              },
              {
                key: "status",
                header: "State",
                render: (r) => <Badge variant={statusVariant(r.status)}>{r.status}</Badge>,
              },
              {
                key: "remarks",
                header: "Review remarks",
                render: (r) =>
                  r.remarks?.trim() ? r.remarks : <span className="text-ex-muted">—</span>,
              },
              {
                key: "actions",
                header: "Actions",
                sticky: "right",
                render: (r) => {
                  if (!canSeeActions) {
                    return <span className="text-ex-muted">View only</span>;
                  }
                  if (!canDecideRow(r)) {
                    return (
                      <span className="text-ex-muted">
                        {r.status === "Pending" || r.status === "Approved"
                          ? "Super Admin only"
                          : "Reviewed"}
                      </span>
                    );
                  }
                  if (r.status === "Approved") {
                    return (
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-red-600"
                        disabled={actingId != null}
                        onClick={() => {
                          setError(null);
                          setReviewRemarks("");
                          setPendingReview({ row: r, status: "Cancelled" });
                        }}
                      >
                        {actingId === r.id ? "Saving..." : "Cancel approval"}
                      </Button>
                    );
                  }
                  if (r.status !== "Pending") {
                    return <span className="text-ex-muted">Reviewed</span>;
                  }
                  return (
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        disabled={actingId != null}
                        onClick={() => {
                          setError(null);
                          setReviewRemarks("");
                          setPendingReview({ row: r, status: "Approved" });
                        }}
                      >
                        {actingId === r.id ? "Saving..." : "Approve"}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={actingId != null}
                        onClick={() => {
                          setError(null);
                          setReviewRemarks("");
                          setPendingReview({ row: r, status: "Rejected" });
                        }}
                      >
                        {actingId === r.id ? "Saving..." : "Reject"}
                      </Button>
                    </div>
                  );
                },
              },
            ]}
          />
        </CardContent>
      </Card>

      <ConfirmationDialog
        open={Boolean(pendingReview)}
        title={
          pendingReview?.status === "Cancelled"
            ? "Cancel overtime approval?"
            : pendingReview?.status === "Rejected"
              ? "Reject overtime request?"
              : "Approve overtime?"
        }
        description={
          pendingReview ? (
            pendingReview.status === "Cancelled" ? (
              <>
                Cancel approval for{" "}
                <span className="text-ex-primary font-medium">{pendingReview.row.employeeName}</span>{" "}
                on {pendingReview.row.date} ({pendingReview.row.overtime}). This OT will no longer
                be paid in payroll.
              </>
            ) : (
              <>
                {pendingReview.status === "Rejected" ? "Reject" : "Approve"} overtime for{" "}
                <span className="text-ex-primary font-medium">{pendingReview.row.employeeName}</span>{" "}
                on {pendingReview.row.date} ({pendingReview.row.overtime}).
              </>
            )
          ) : (
            ""
          )
        }
        confirmText={
          pendingReview?.status === "Cancelled"
            ? "Cancel approval"
            : pendingReview?.status === "Rejected"
              ? "Reject"
              : "Approve"
        }
        confirmVariant={
          pendingReview?.status === "Approved" ? "primary" : "danger"
        }
        busy={Boolean(actingId)}
        busyText="Saving…"
        iconContainerClassName={
          pendingReview?.status === "Approved" ? "bg-amber-500" : "bg-rose-600"
        }
        inputLabel={
          pendingReview?.status === "Cancelled"
            ? "Cancellation remarks (required)"
            : pendingReview?.status === "Rejected"
              ? "Rejection remarks (required)"
              : "Approval remarks (optional)"
        }
        inputValue={reviewRemarks}
        onInputChange={setReviewRemarks}
        inputPlaceholder={
          pendingReview?.status === "Cancelled"
            ? "Why is this approval being cancelled?"
            : pendingReview?.status === "Rejected"
              ? "Enter the reason for rejection"
              : "Add a note (optional)"
        }
        inputRequired={
          pendingReview?.status === "Rejected" || pendingReview?.status === "Cancelled"
        }
        onCancel={() => {
          if (actingId) return;
          setPendingReview(null);
          setReviewRemarks("");
        }}
        onConfirm={() => {
          if (!pendingReview) return;
          void decide(pendingReview.row, pendingReview.status, reviewRemarks);
        }}
      />
    </div>
  );
}
