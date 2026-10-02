"use client";

import { useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";

import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { DataTable } from "@/components/ui/data-table";
import { DEFAULT_PAGE_SIZE, Pagination } from "@/components/ui/pagination";
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
import type { SheetPagination } from "@/types/sheet";

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
  if (value === ROLES.INTERN) return "Intern";
  return value ? value : "Employee";
}

export default function OvertimePage() {
  const { user } = useAuth();
  const canSeeActions = user ? canReviewOvertime(user.role) : false;
  const [rows, setRows] = useState<OvertimeRequestDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
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

  const totalPages = Math.max(1, Math.ceil(rows.length / DEFAULT_PAGE_SIZE));
  const safePage = Math.min(page, totalPages);

  const pagination = useMemo<SheetPagination>(
    () => ({
      page: safePage,
      pageSize: DEFAULT_PAGE_SIZE,
      total: rows.length,
      totalPages,
    }),
    [safePage, rows.length, totalPages],
  );

  const pagedRows = useMemo(() => {
    const start = (safePage - 1) * DEFAULT_PAGE_SIZE;
    return rows.slice(start, start + DEFAULT_PAGE_SIZE);
  }, [safePage, rows]);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Overtime Approvals"
        actions={
          <div className="flex items-center gap-2">
            {pendingCount > 0 && <Badge variant="warning">{pendingCount} Pending</Badge>}
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
        <CardContent className="space-y-4 p-0 pb-4">
          <DataTable
            loading={loading}
            className="rounded-none border-0 shadow-none"
            rows={pagedRows}
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
                header: "Submitted By",
                render: (r) => (
                  <span className="text-ex-muted text-sm">{submittedByLabel(r.requestedByRole)}</span>
                ),
              },
              {
                key: "comment",
                header: "Employee Note",
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
                header: "Status",
                render: (r) => <Badge variant={statusVariant(r.status)}>{r.status}</Badge>,
              },
              {
                key: "remarks",
                header: "Review Remarks",
                render: (r) =>
                  r.remarks?.trim() ? r.remarks : <span className="text-ex-muted">—</span>,
              },
              {
                key: "actions",
                header: "Actions",
                sticky: "right",
                render: (r) => {
                  if (!canSeeActions) {
                    return <span className="text-ex-muted">View Only</span>;
                  }
                  if (!canDecideRow(r)) {
                    return (
                      <span className="text-ex-muted">
                        {r.status === "Pending" || r.status === "Approved"
                          ? "Super Admin Only"
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
                        {actingId === r.id ? "Saving..." : "Cancel Approval"}
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
          {!loading ? (
            <Pagination
              className="px-4"
              pagination={pagination}
              onPageChange={setPage}
              itemLabel="requests"
            />
          ) : null}
        </CardContent>
      </Card>

      <ConfirmationDialog
        open={Boolean(pendingReview)}
        title={
          pendingReview?.status === "Cancelled"
            ? "Cancel Overtime Approval?"
            : pendingReview?.status === "Rejected"
              ? "Reject Overtime Request?"
              : "Approve Overtime?"
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
            ? "Cancel Approval"
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
            ? "Cancellation Remarks (required)"
            : pendingReview?.status === "Rejected"
              ? "Rejection Remarks (required)"
              : "Approval Remarks (optional)"
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
