"use client";

import {
  AlertTriangle,
  CheckCircle2,
  MessageSquareWarning,
  RefreshCw,
  Send,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/auth-provider";
import { useNotifications } from "@/contexts/notifications-provider";
import { canManageEmployees } from "@/lib/auth/roles";
import { toUserFacingActionError, toUserFacingFetchError } from "@/lib/api/user-facing-error";
import { assertApiSuccess, readResponseJson } from "@/lib/api/read-response-json";
import type {
  ComplaintCategory,
  ComplaintRecord,
  ComplaintSeverity,
  ComplaintStatus,
} from "@/lib/complaints";
import { cn } from "@/lib/utils";

type StatusFilter = ComplaintStatus | "All";

function statusVariant(status: ComplaintStatus): "warning" | "success" | "danger" {
  if (status === "Approved") return "success";
  if (status === "Rejected") return "danger";
  return "warning";
}

function categoryLabel(category: ComplaintCategory): string {
  const labels: Record<ComplaintCategory, string> = {
    workplace: "Workplace",
    it: "IT",
    people: "People & culture",
    facilities: "Facilities",
    other: "Other",
  };
  return labels[category];
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

async function fetchComplaintRecords(): Promise<ComplaintRecord[]> {
  const response = await fetch("/api/complaints", { cache: "no-store" });
  const data = await readResponseJson<{
    success?: boolean;
    message?: string;
    complaints?: ComplaintRecord[];
  }>(response, "fetch");
  assertApiSuccess(data, "fetch");
  return data.complaints ?? [];
}

function TicketListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="divide-ex-border divide-y" aria-busy aria-label="Loading help desk tickets">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="space-y-4 px-5 py-5">
          <div className="flex gap-3">
            <Skeleton className="size-10 shrink-0 rounded-xl" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Skeleton className="h-5 w-48 rounded-md" />
                <Skeleton className="h-5 w-16 rounded-md" />
                <Skeleton className="h-5 w-24 rounded-md" />
              </div>
              <Skeleton className="h-3 w-56 max-w-full rounded-md" />
            </div>
          </div>
          <div className="space-y-2">
            <Skeleton className="h-4 w-full rounded-md" />
            <Skeleton className="h-4 w-11/12 max-w-xl rounded-md" />
            <Skeleton className="h-4 w-3/4 max-w-md rounded-md" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function ComplaintsPage() {
  const { user } = useAuth();
  const { refresh: refreshNotifications, pushToast } = useNotifications();
  const canReview = user ? canManageEmployees(user.role) : false;
  const [complaints, setComplaints] = useState<ComplaintRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState<ComplaintCategory>("workplace");
  const [severity, setSeverity] = useState<ComplaintSeverity>("normal");
  const [details, setDetails] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("All");
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [reviewingId, setReviewingId] = useState<string | null>(null);

  const loadTickets = useCallback(async () => {
    try {
      setLoading(true);
      setComplaints(await fetchComplaintRecords());
    } catch (loadError) {
      pushToast({
        title: "Couldn’t Load Tickets",
        body: toUserFacingFetchError(loadError),
        variant: "error",
      });
    } finally {
      setLoading(false);
    }
  }, [pushToast]);

  useEffect(() => {
    let cancelled = false;
    void fetchComplaintRecords()
      .then((items) => {
        if (!cancelled) {
          setComplaints(items);
        }
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          pushToast({
            title: "Couldn’t Load Tickets",
            body: toUserFacingFetchError(loadError),
            variant: "error",
          });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pushToast]);

  const visibleTickets = useMemo(
    () =>
      statusFilter === "All"
        ? complaints
        : complaints.filter((ticket) => ticket.status === statusFilter),
    [complaints, statusFilter],
  );
  const pendingCount = complaints.filter((ticket) => ticket.status === "Pending").length;

  const submitTicket = async () => {
    if (!subject.trim() || !details.trim()) {
      pushToast({
        title: "Missing Details",
        body: "Subject and ticket details are required.",
        variant: "error",
      });
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/complaints", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: subject.trim(),
          category,
          severity,
          details: details.trim(),
        }),
      });
      const data = await readResponseJson<{
        success?: boolean;
        message?: string;
        complaint?: ComplaintRecord;
      }>(response, "action");
      if (!response.ok || !data.success || !data.complaint) {
        throw new Error(data.message ?? "Failed to submit ticket");
      }
      setSubject("");
      setCategory("workplace");
      setSeverity("normal");
      setDetails("");
      pushToast({
        title: "Ticket Submitted",
        body: "Your help desk ticket was sent to HR and Super Admin for review.",
        href: "/complaints",
        variant: "success",
      });
      await Promise.all([loadTickets(), refreshNotifications()]);
    } catch (submitError) {
      pushToast({
        title: "Couldn’t Submit Ticket",
        body: toUserFacingActionError(submitError),
        variant: "error",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const review = async (ticket: ComplaintRecord, status: "Approved" | "Rejected") => {
    const reviewNote = String(reviewNotes[ticket.id] ?? "").trim();
    if (status === "Rejected" && !reviewNote) {
      pushToast({
        title: "Reason Required",
        body: "Enter a reason before rejecting the ticket.",
        variant: "error",
      });
      return;
    }

    setReviewingId(ticket.id);
    try {
      const response = await fetch("/api/complaints", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: ticket.id, status, reviewNote }),
      });
      const data = await readResponseJson<{ success?: boolean; message?: string }>(
        response,
        "action",
      );
      if (!response.ok || !data.success) {
        throw new Error(data.message ?? "Failed to review ticket");
      }
      setReviewNotes((current) => {
        const next = { ...current };
        delete next[ticket.id];
        return next;
      });
      pushToast({
        title: `Ticket ${status.toLowerCase()}`,
        body: `${ticket.submitterName}'s ticket has been ${status.toLowerCase()}.`,
        href: "/complaints",
        variant: "success",
      });
      await Promise.all([loadTickets(), refreshNotifications()]);
    } catch (reviewError) {
      pushToast({
        title: "Couldn’t Update Ticket",
        body: toUserFacingActionError(reviewError),
        variant: "error",
      });
    } finally {
      setReviewingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Help Desk"
        description={
          canReview
            ? "Review and resolve employee help desk tickets."
            : "Raise a ticket for workplace issues and track its status."
        }
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => void loadTickets()}
            disabled={loading}
          >
            <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        }
      />

      {!canReview ? (
        <Card>
          <CardHeader>
            <CardTitle>Raise Ticket</CardTitle>
            <p className="text-ex-muted mt-1 text-sm">
              HR and Super Admin will be notified after you submit.
            </p>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <label className="space-y-1.5 md:col-span-2">
              <Label>Subject</Label>
              <Input
                value={subject}
                maxLength={120}
                placeholder="Briefly describe the issue"
                onChange={(event) => setSubject(event.target.value)}
              />
            </label>
            <label className="space-y-1.5">
              <Label>Category</Label>
              <Select
                value={category}
                onChange={(event) => setCategory(event.target.value as ComplaintCategory)}
              >
                <option value="workplace">Workplace</option>
                <option value="it">IT</option>
                <option value="people">People & culture</option>
                <option value="facilities">Facilities</option>
                <option value="other">Other</option>
              </Select>
            </label>
            <label className="space-y-1.5">
              <Label>Priority</Label>
              <Select
                value={severity}
                onChange={(event) => setSeverity(event.target.value as ComplaintSeverity)}
              >
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
              </Select>
            </label>
            <label className="space-y-1.5 md:col-span-2">
              <Label>Ticket details</Label>
              <Textarea
                rows={5}
                value={details}
                maxLength={2000}
                placeholder="Explain what happened and any action already taken"
                onChange={(event) => setDetails(event.target.value)}
              />
              <span className="text-ex-muted block text-right text-xs">{details.length}/2000</span>
            </label>
            <Button
              className="w-fit md:col-span-2"
              disabled={submitting}
              onClick={() => void submitTicket()}
            >
              <Send className="size-4" />
              {submitting ? "Submitting…" : "Submit"}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <Card className="overflow-hidden">
        <CardHeader className="bg-ex-surface/40 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>{canReview ? "Ticket Queue" : "My Tickets"}</CardTitle>
            <p className="text-ex-muted mt-1 text-sm">
              {loading
                ? "Loading…"
                : canReview
                  ? `${pendingCount} ticket${pendingCount === 1 ? "" : "s"} awaiting action`
                  : "Your submitted help desk tickets"}
            </p>
          </div>
          <div className="bg-ex-elevated flex w-fit rounded-lg p-1">
            {(["All", "Pending", "Approved", "Rejected"] as StatusFilter[]).map((status) => (
              <button
                key={status}
                type="button"
                onClick={() => setStatusFilter(status)}
                disabled={loading}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm font-medium transition",
                  statusFilter === status
                    ? "bg-ex-surface text-ex-primary shadow-sm"
                    : "text-ex-muted hover:text-ex-primary",
                  loading && "cursor-not-allowed opacity-60",
                )}
              >
                {status}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <TicketListSkeleton rows={3} />
          ) : visibleTickets.length === 0 ? (
            <div className="px-5 py-14 text-center">
              <MessageSquareWarning className="text-ex-muted/50 mx-auto size-8" />
              <p className="mt-3 font-medium">
                No {statusFilter === "All" ? "" : `${statusFilter} `}Tickets
              </p>
              <p className="text-ex-muted mt-1 text-sm">
                Help desk tickets matching this filter will appear here.
              </p>
            </div>
          ) : (
            <div className="divide-ex-border divide-y">
              {visibleTickets.map((ticket) => (
                <article key={ticket.id} className="space-y-4 px-5 py-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex min-w-0 gap-3">
                      <div
                        className={cn(
                          "flex size-10 shrink-0 items-center justify-center rounded-xl",
                          ticket.severity === "high"
                            ? "bg-rose-500/15 text-rose-600"
                            : "bg-amber-500/15 text-amber-700",
                        )}
                      >
                        <AlertTriangle className="size-5" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-semibold">{ticket.subject}</h3>
                          <Badge variant={statusVariant(ticket.status)}>{ticket.status}</Badge>
                          <Badge variant="default">{ticket.severity.toUpperCase()} Priority</Badge>
                        </div>
                        <p className="text-ex-muted mt-1 text-sm">
                          {canReview ? `${ticket.submitterName} · ` : ""}
                          {categoryLabel(ticket.category)} · {formatDate(ticket.createdAt)}
                        </p>
                      </div>
                    </div>
                  </div>
                  <p className="text-ex-primary text-sm leading-6 whitespace-pre-wrap">
                    {ticket.details}
                  </p>

                  {ticket.status !== "Pending" ? (
                    <div
                      className={cn(
                        "rounded-lg border px-4 py-3 text-sm",
                        ticket.status === "Approved"
                          ? "border-emerald-500/25 bg-emerald-500/8"
                          : "border-rose-500/25 bg-rose-500/8",
                      )}
                    >
                      <div className="flex items-center gap-2 font-medium">
                        {ticket.status === "Approved" ? (
                          <CheckCircle2 className="size-4 text-emerald-600" />
                        ) : (
                          <XCircle className="size-4 text-rose-600" />
                        )}
                        {ticket.status} by {ticket.reviewedByName || "HR"}
                      </div>
                      {ticket.reviewNote ? (
                        <p className="text-ex-muted mt-1">{ticket.reviewNote}</p>
                      ) : null}
                    </div>
                  ) : canReview ? (
                    <div className="border-ex-border bg-ex-surface/40 rounded-xl border p-4">
                      <Label htmlFor={`review-${ticket.id}`}>
                        Review note <span className="text-ex-muted">(required for rejection)</span>
                      </Label>
                      <Textarea
                        id={`review-${ticket.id}`}
                        rows={3}
                        maxLength={1000}
                        className="mt-2"
                        value={reviewNotes[ticket.id] ?? ""}
                        placeholder="Record the action taken or reason for rejection"
                        onChange={(event) =>
                          setReviewNotes((current) => ({
                            ...current,
                            [ticket.id]: event.target.value,
                          }))
                        }
                      />
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          disabled={reviewingId === ticket.id}
                          onClick={() => void review(ticket, "Approved")}
                        >
                          <CheckCircle2 className="size-4" />
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          disabled={reviewingId === ticket.id}
                          onClick={() => void review(ticket, "Rejected")}
                        >
                          <XCircle className="size-4" />
                          Reject
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
