"use client";

import { readResponseJson } from "@/lib/api/read-response-json";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PendingCorrectionRequests } from "@/components/attendance/pending-correction-requests";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable } from "@/components/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { DEFAULT_PAGE_SIZE, Pagination } from "@/components/ui/pagination";
import { Check, Loader2, RefreshCw, X } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { LEAVE_STATUS } from "@/lib/attendance/leave-status";
import { parseLeaveDisplayDate } from "@/lib/attendance/leave-range-display";
import { toUserFacingActionError, toUserFacingFetchError } from "@/lib/api/user-facing-error";
import { useNotifications } from "@/contexts/notifications-provider";

type LeaveApprovalRow = {
  id: string;
  employeeId: string;
  employeeName: string;
  attendanceSpreadsheetId: string;
  leaveType: string;
  date: string;
  duration: string;
  reason: string;
  status: string;
  rejectReason: string;
  rowIndex: number;
  days: number;
};

type StatusFilter = "Applied" | "Accepted" | "Rejected" | "all";

const STATUS_FILTERS: Array<{ id: StatusFilter; label: string }> = [
  { id: LEAVE_STATUS.APPLIED, label: "Pending" },
  { id: LEAVE_STATUS.ACCEPTED, label: "Accepted" },
  { id: LEAVE_STATUS.REJECTED, label: "Rejected" },
  { id: "all", label: "All" },
];

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

function statusBadgeVariant(status: string): "default" | "success" | "warning" | "danger" {
  const normalized = status.trim().toLowerCase();
  if (normalized === "accepted") return "success";
  if (normalized === "applied") return "warning";
  if (normalized === "rejected") return "danger";
  return "default";
}

function isPendingStatus(status: string): boolean {
  return status.trim().toLowerCase() === LEAVE_STATUS.APPLIED.toLowerCase();
}

/** Descending by leave date: newest requests first. */
function sortApprovalsByDate(applications: LeaveApprovalRow[]): LeaveApprovalRow[] {
  return [...applications].sort((a, b) => {
    const aTime = parseLeaveDisplayDate(a.date)?.getTime() ?? Number.NEGATIVE_INFINITY;
    const bTime = parseLeaveDisplayDate(b.date)?.getTime() ?? Number.NEGATIVE_INFINITY;
    if (aTime !== bTime) return bTime - aTime;

    const rowCompare = b.rowIndex - a.rowIndex;
    if (rowCompare !== 0) return rowCompare;

    return b.id.localeCompare(a.id);
  });
}

function emptyCopy(filter: StatusFilter): { title: string; description: string } {
  if (filter === LEAVE_STATUS.APPLIED) {
    return {
      title: "No Pending Leave Requests",
      description: "Applied leave requests from all employees will appear here for review.",
    };
  }
  if (filter === LEAVE_STATUS.ACCEPTED) {
    return {
      title: "No Accepted Leave Requests",
      description: "Approved leave history from all employees will appear here.",
    };
  }
  if (filter === LEAVE_STATUS.REJECTED) {
    return {
      title: "No Rejected Leave Requests",
      description: "Rejected leave history with reasons will appear here.",
    };
  }
  return {
    title: "No Leave Requests",
    description: "Leave applications from all employees will appear here.",
  };
}

async function reviewLeaveRequest(
  row: LeaveApprovalRow,
  status: "Accepted" | "Rejected",
  reason = "",
): Promise<{ email?: { sent?: boolean; reason?: string; to?: string } }> {
  const res = await fetch("/api/employee/leaves/review", {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      employeeId: row.employeeId,
      attendanceSpreadsheetId: row.attendanceSpreadsheetId,
      rowIndex: row.rowIndex,
      leaveType: row.leaveType,
      status,
      rejectReason: reason,
    }),
  });

  const data = await readResponseJson<{
    success?: boolean;
    message?: string;
    email?: { sent?: boolean; reason?: string; to?: string };
  }>(res, "action");
  if (!data.success) {
    throw new Error(data.message ?? "Failed to review leave");
  }
  return { email: data.email };
}

export default function LeaveApprovalsPage() {
  const { refresh: refreshNotifications, pushToast } = useNotifications();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(LEAVE_STATUS.APPLIED);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [rows, setRows] = useState<LeaveApprovalRow[]>([]);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [reviewingStatus, setReviewingStatus] = useState<"Accepted" | "Rejected" | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [rejectReason, setRejectReason] = useState("");
  const [rejectingRow, setRejectingRow] = useState<LeaveApprovalRow | null>(null);
  const [bulkRejectOpen, setBulkRejectOpen] = useState(false);
  const [bulkRejectReason, setBulkRejectReason] = useState("");

  const loadApprovals = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!options?.silent) setLoading(true);
      setWarnings([]);
      try {
        const query = statusFilter === "all" ? "all" : statusFilter;
        const res = await fetch(
          `/api/employee/leaves/approvals?status=${encodeURIComponent(query)}`,
          { cache: "no-store" },
        );
        const data = await readResponseJson<{
          success?: boolean;
          message?: string;
          applications?: LeaveApprovalRow[];
          warnings?: string[];
        }>(res, "fetch");

        if (!data.success) {
          throw new Error(data.message ?? "Failed to load approvals");
        }

        setRows(sortApprovalsByDate(data.applications ?? []));
        setWarnings(Array.isArray(data.warnings) ? data.warnings : []);
        setSelectedIds(new Set());
      } catch (err) {
        pushToast({
          title: "Could not load approvals",
          body: toUserFacingFetchError(err),
          variant: "error",
        });
        if (!options?.silent) {
          setRows([]);
          setSelectedIds(new Set());
        }
      } finally {
        if (!options?.silent) setLoading(false);
      }
    },
    [statusFilter, pushToast],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadApprovals();
  }, [loadApprovals]);

  const pendingCount = useMemo(
    () => rows.filter((row) => isPendingStatus(row.status)).length,
    [rows],
  );

  const totalPages = Math.max(1, Math.ceil(rows.length / DEFAULT_PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);

  const paginatedRows = useMemo(
    () => rows.slice((currentPage - 1) * DEFAULT_PAGE_SIZE, currentPage * DEFAULT_PAGE_SIZE),
    [rows, currentPage],
  );

  const pendingOnPage = useMemo(
    () => paginatedRows.filter((row) => isPendingStatus(row.status)),
    [paginatedRows],
  );

  const selectedPendingRows = useMemo(
    () => rows.filter((row) => selectedIds.has(row.id) && isPendingStatus(row.status)),
    [rows, selectedIds],
  );

  const selectedCount = selectedPendingRows.length;
  const showBulkActions = selectedCount > 1;
  const allPendingOnPageSelected =
    pendingOnPage.length > 0 && pendingOnPage.every((row) => selectedIds.has(row.id));

  const showRejectReasonColumn = statusFilter === LEAVE_STATUS.REJECTED || statusFilter === "all";
  const showActions = statusFilter === LEAVE_STATUS.APPLIED || statusFilter === "all";
  const emptyState = emptyCopy(statusFilter);
  const actionsBusy = reviewingId != null || bulkBusy;

  function toggleRowSelected(row: LeaveApprovalRow) {
    if (!isPendingStatus(row.status) || actionsBusy) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(row.id)) next.delete(row.id);
      else next.add(row.id);
      return next;
    });
  }

  function toggleSelectAllOnPage() {
    if (actionsBusy || pendingOnPage.length === 0) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allPendingOnPageSelected) {
        for (const row of pendingOnPage) next.delete(row.id);
      } else {
        for (const row of pendingOnPage) next.add(row.id);
      }
      return next;
    });
  }

  const applyLocalReview = useCallback(
    (rowId: string, status: "Accepted" | "Rejected", reason = "") => {
      setRows((prev) => {
        // Pending tab should drop the row immediately after review.
        if (statusFilter === LEAVE_STATUS.APPLIED) {
          return prev.filter((row) => row.id !== rowId);
        }
        return prev.map((row) =>
          row.id === rowId
            ? {
                ...row,
                status,
                rejectReason: status === "Rejected" ? reason : row.rejectReason,
              }
            : row,
        );
      });
      setSelectedIds((prev) => {
        if (!prev.has(rowId)) return prev;
        const next = new Set(prev);
        next.delete(rowId);
        return next;
      });
    },
    [statusFilter],
  );

  const reviewApplication = async (
    row: LeaveApprovalRow,
    status: "Accepted" | "Rejected",
    reason = "",
  ) => {
    setReviewingId(row.id);
    setReviewingStatus(status);
    try {
      const data = await reviewLeaveRequest(row, status, reason);

      setRejectingRow(null);
      setRejectReason("");
      applyLocalReview(row.id, status, reason.trim());
      // Soft refresh — avoid replacing the table with a skeleton; optimistic update
      // already reflects the change if Sheets lag briefly.
      void loadApprovals({ silent: true });
      void refreshNotifications();

      const emailSent = data.email?.sent === true;
      const emailNote =
        data.email?.sent === false && data.email.reason
          ? ` Email was not sent: ${data.email.reason}`
          : emailSent
            ? ` Email sent to ${data.email?.to}.`
            : "";

      pushToast({
        title: status === "Accepted" ? "Leave Approved" : "Leave Rejected",
        body: `${row.employeeName}'s leave request was ${status.toLowerCase()}. The employee has been notified.${emailNote}`,
        href: "/notifications",
        variant: "success",
      });
    } catch (err) {
      pushToast({
        title: status === "Accepted" ? "Approve failed" : "Reject failed",
        body: toUserFacingActionError(err),
        variant: "error",
      });
    } finally {
      setReviewingId(null);
      setReviewingStatus(null);
    }
  };

  const submitReject = async () => {
    if (!rejectingRow) return;
    if (!rejectReason.trim()) {
      pushToast({
        title: "Reject reason required",
        body: "Please provide a reject reason.",
        variant: "error",
      });
      return;
    }
    await reviewApplication(rejectingRow, "Rejected", rejectReason.trim());
  };

  const runBulkReview = async (status: "Accepted" | "Rejected", reason = "") => {
    const targets = selectedPendingRows;
    if (targets.length < 2) return;

    setBulkBusy(true);
    setBulkRejectOpen(false);

    let succeeded = 0;
    const failures: string[] = [];

    for (const row of targets) {
      try {
        await reviewLeaveRequest(row, status, reason);
        succeeded += 1;
      } catch (err) {
        failures.push(`${row.employeeName} (${row.date}): ${toUserFacingActionError(err)}`);
      }
    }

    setSelectedIds(new Set());
    setBulkRejectReason("");
    // Drop reviewed pending rows immediately, then soft-refresh from server.
    const targetIds = new Set(targets.map((row) => row.id));
    if (statusFilter === LEAVE_STATUS.APPLIED) {
      setRows((prev) => prev.filter((row) => !targetIds.has(row.id)));
    } else {
      setRows((prev) =>
        prev.map((row) =>
          targetIds.has(row.id)
            ? {
                ...row,
                status,
                rejectReason: status === "Rejected" ? reason : row.rejectReason,
              }
            : row,
        ),
      );
    }
    await loadApprovals({ silent: true });
    await refreshNotifications();
    setBulkBusy(false);

    if (succeeded > 0) {
      pushToast({
        title: status === "Accepted" ? "Leaves Approved" : "Leaves Rejected",
        body: `${succeeded} leave request${succeeded === 1 ? "" : "s"} ${status.toLowerCase()}. Employees have been notified.`,
        href: "/notifications",
        variant: "success",
      });
    }

    if (failures.length > 0) {
      pushToast({
        title: `${failures.length} request${failures.length === 1 ? "" : "s"} failed`,
        body: `${failures.slice(0, 3).join(" · ")}${failures.length > 3 ? ` · …and ${failures.length - 3} more` : ""}`,
        variant: "error",
      });
    }
  };

  return (
    <div className="space-y-8">
      <PageHeader
        title="Leave Approvals"
        // description="Review leave and attendance correction requests from all employees. HR and Super Admin can accept or reject pending items; leave rejection requires a reason. Select multiple pending rows to approve or reject in bulk."
        actions={
          <div className="flex items-center gap-2">
            {statusFilter === LEAVE_STATUS.APPLIED && pendingCount > 0 ? (
              <Badge variant="warning">
                {pendingCount} pending
              </Badge>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              onClick={() => void loadApprovals()}
              disabled={loading || actionsBusy}
            >
              <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        }
      />

      <PendingCorrectionRequests />

      <div className="flex flex-wrap gap-2">
        {STATUS_FILTERS.map((filter) => (
          <button
            key={filter.id}
            type="button"
            onClick={() => {
              setStatusFilter(filter.id);
              setPage(1);
              setSelectedIds(new Set());
            }}
            className={cn(
              "inline-flex items-center rounded-full border px-3 py-1.5 text-sm font-medium transition",
              statusFilter === filter.id
                ? "border-ex-secondary bg-ex-secondary/15 text-ex-primary"
                : "border-ex-border bg-ex-elevated text-ex-muted hover:border-ex-secondary/30 hover:text-ex-primary",
            )}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {showBulkActions ? (
        <div className="border-ex-border bg-ex-elevated flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3">
          <p className="text-ex-primary text-sm font-medium">
            {selectedCount} Pending Leave{selectedCount === 1 ? "" : "s"} Selected
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={actionsBusy}
              onClick={() => setSelectedIds(new Set())}
            >
              Clear
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={actionsBusy}
              onClick={() => void runBulkReview("Accepted")}
            >
              {bulkBusy ? "Working…" : "Bulk Accept"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={actionsBusy}
              onClick={() => {
                setBulkRejectReason("");
                setBulkRejectOpen(true);
              }}
            >
              Bulk Reject
            </Button>
          </div>
        </div>
      ) : null}

      {warnings.length > 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <p className="font-medium">Some Employees Could Not Be Loaded</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {rejectingRow ? (
        <div className="border-ex-border bg-ex-elevated space-y-3 rounded-xl border p-4">
          <p className="text-sm font-medium">
            Reject {rejectingRow.employeeName}&apos;s {formatLeaveTypeLabel(rejectingRow.leaveType)}{" "}
            leave ({rejectingRow.date})
          </p>
          <Textarea
            rows={3}
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="Reason for rejection (required)"
          />
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={actionsBusy}
              onClick={() => {
                setRejectingRow(null);
                setRejectReason("");
              }}
            >
              Cancel
            </Button>
            <Button
              variant="secondary"
              onClick={() => void submitReject()}
              disabled={actionsBusy || !rejectReason.trim()}
            >
              {reviewingId === rejectingRow.id && reviewingStatus === "Rejected" ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Rejecting…
                </>
              ) : (
                <>
                  <X className="size-4" aria-hidden />
                  Confirm Reject
                </>
              )}
            </Button>
          </div>
        </div>
      ) : null}

      <div className="space-y-4">
        <DataTable
          loading={loading}
          rows={paginatedRows}
          emptyTitle={emptyState.title}
          emptyDescription={emptyState.description}
          columns={[
            ...(showActions
              ? [
                  {
                    key: "id" as const,
                    header: (
                      <input
                        type="checkbox"
                        className="accent-ex-secondary size-4"
                        checked={allPendingOnPageSelected}
                        disabled={actionsBusy || pendingOnPage.length === 0}
                        aria-label="Select All Pending Leaves On This Page"
                        onChange={toggleSelectAllOnPage}
                      />
                    ),
                    render: (r: LeaveApprovalRow) =>
                      isPendingStatus(r.status) ? (
                        <input
                          type="checkbox"
                          className="accent-ex-secondary size-4"
                          checked={selectedIds.has(r.id)}
                          disabled={actionsBusy}
                          aria-label={`Select leave for ${r.employeeName} on ${r.date}`}
                          onChange={() => toggleRowSelected(r)}
                        />
                      ) : (
                        <span className="text-ex-muted">—</span>
                      ),
                  },
                ]
              : []),
            { key: "employeeName", header: "Employee" },
            {
              key: "leaveType",
              header: "Request",
              render: (r) => {
                const typeLabel = formatLeaveTypeLabel(r.leaveType);
                const duration = r.duration ? ` · ${r.duration}` : "";
                const days = r.days > 0 ? ` · ${r.days} day${r.days === 1 ? "" : "s"}` : "";
                return `${typeLabel}${duration}${days} · ${r.date}`;
              },
            },
            {
              key: "reason",
              header: "Reason",
              render: (r) => r.reason || "—",
            },
            {
              key: "status",
              header: "Status",
              render: (r) => (
                <Badge variant={statusBadgeVariant(r.status)}>{r.status || "Pending"}</Badge>
              ),
            },
            ...(showRejectReasonColumn
              ? [
                  {
                    key: "rejectReason" as const,
                    header: "Reject Reason",
                    render: (r: LeaveApprovalRow) => r.rejectReason || "—",
                  },
                ]
              : []),
            ...(showActions
              ? [
                  {
                    key: "actions" as const,
                    header: "Actions",
                    render: (r: LeaveApprovalRow) =>
                      isPendingStatus(r.status) ? (
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={actionsBusy}
                            onClick={() => void reviewApplication(r, "Accepted")}
                          >
                            {reviewingId === r.id && reviewingStatus === "Accepted" ? (
                              <>
                                <Loader2 className="size-4 animate-spin" aria-hidden />
                                Accepting…
                              </>
                            ) : (
                              <>
                                <Check className="size-4" aria-hidden />
                                Accept
                              </>
                            )}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={actionsBusy}
                            onClick={() => {
                              setRejectingRow(r);
                              setRejectReason("");
                            }}
                          >
                            <X className="size-4" aria-hidden />
                            Reject
                          </Button>
                        </div>
                      ) : (
                        "—"
                      ),
                  },
                ]
              : []),
          ]}
        />

        {!loading && rows.length > DEFAULT_PAGE_SIZE ? (
          <Pagination
            pagination={{
              page: currentPage,
              totalPages,
              total: rows.length,
              pageSize: DEFAULT_PAGE_SIZE,
            }}
            onPageChange={setPage}
            itemLabel="requests"
          />
        ) : null}
      </div>

      <ConfirmationDialog
        open={bulkRejectOpen}
        title="Reject Selected Leave Requests?"
        description={
          <>
            Reject <span className="text-ex-primary font-medium">{selectedCount}</span> pending leave
            request{selectedCount === 1 ? "" : "s"}. The same reason will be applied to all selected
            items.
          </>
        }
        confirmText="Reject All"
        confirmVariant="danger"
        busy={bulkBusy}
        busyText="Rejecting…"
        inputLabel="Rejection Reason (required)"
        inputValue={bulkRejectReason}
        onInputChange={setBulkRejectReason}
        inputPlaceholder="Enter The Reason For Rejection"
        inputRequired
        onCancel={() => {
          if (bulkBusy) return;
          setBulkRejectOpen(false);
          setBulkRejectReason("");
        }}
        onConfirm={() => {
          void runBulkReview("Rejected", bulkRejectReason.trim());
        }}
      />
    </div>
  );
}
