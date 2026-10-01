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

export default function ComplaintsPage() {
  const { user } = useAuth();
  const { refresh: refreshNotifications, pushToast } = useNotifications();
  const canReview = user ? canManageEmployees(user.role) : false;
  const [complaints, setComplaints] = useState<ComplaintRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState<ComplaintCategory>("workplace");
  const [severity, setSeverity] = useState<ComplaintSeverity>("normal");
  const [details, setDetails] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("All");
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [reviewingId, setReviewingId] = useState<string | null>(null);

  const loadComplaints = useCallback(async () => {
    try {
      setLoading(true);
      setComplaints(await fetchComplaintRecords());
      setError(null);
    } catch (loadError) {
      setError(toUserFacingFetchError(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetchComplaintRecords()
      .then((items) => {
        if (!cancelled) {
          setComplaints(items);
          setError(null);
        }
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(toUserFacingFetchError(loadError));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const visibleComplaints = useMemo(
    () =>
      statusFilter === "All"
        ? complaints
        : complaints.filter((complaint) => complaint.status === statusFilter),
    [complaints, statusFilter],
  );
  const pendingCount = complaints.filter((complaint) => complaint.status === "Pending").length;

  const submitComplaint = async () => {
    if (!subject.trim() || !details.trim()) {
      setError("Subject and complaint details are required.");
      return;
    }

    setSubmitting(true);
    setError(null);
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
        throw new Error(data.message ?? "Failed to submit complaint");
      }
      setSubject("");
      setCategory("workplace");
      setSeverity("normal");
      setDetails("");
      pushToast({
        title: "Complaint Submitted",
        body: "Your complaint was sent to HR and Super Admin for review.",
        href: "/complaints",
        variant: "success",
      });
      await Promise.all([loadComplaints(), refreshNotifications()]);
    } catch (submitError) {
      setError(toUserFacingActionError(submitError));
    } finally {
      setSubmitting(false);
    }
  };

  const review = async (complaint: ComplaintRecord, status: "Approved" | "Rejected") => {
    const reviewNote = String(reviewNotes[complaint.id] ?? "").trim();
    if (status === "Rejected" && !reviewNote) {
      setError("Enter a reason before rejecting the complaint.");
      return;
    }

    setReviewingId(complaint.id);
    setError(null);
    try {
      const response = await fetch("/api/complaints", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: complaint.id, status, reviewNote }),
      });
      const data = await readResponseJson<{ success?: boolean; message?: string }>(
        response,
        "action",
      );
      if (!response.ok || !data.success) {
        throw new Error(data.message ?? "Failed to review complaint");
      }
      setReviewNotes((current) => {
        const next = { ...current };
        delete next[complaint.id];
        return next;
      });
      pushToast({
        title: `Complaint ${status.toLowerCase()}`,
        body: `${complaint.submitterName}'s complaint has been ${status.toLowerCase()}.`,
        href: "/complaints",
        variant: "success",
      });
      await Promise.all([loadComplaints(), refreshNotifications()]);
    } catch (reviewError) {
      setError(toUserFacingActionError(reviewError));
    } finally {
      setReviewingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Complaints"
        description={
          canReview
            ? "Review employee concerns and record the action taken."
            : "Raise workplace concerns and track their review status."
        }
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => void loadComplaints()}
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
            <CardTitle>Submit Complaint</CardTitle>
            <p className="text-ex-muted mt-1 text-sm">
              HR and Super Admin will be notified after submission.
            </p>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <label className="space-y-1.5 md:col-span-2">
              <Label>Subject</Label>
              <Input
                value={subject}
                maxLength={120}
                placeholder="Briefly describe the concern"
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
              <Label>Complaint details</Label>
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
              onClick={() => void submitComplaint()}
            >
              <Send className="size-4" />
              {submitting ? "Submitting…" : "Submit complaint"}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {error ? (
        <p className="border-ex-banner-danger-border bg-ex-banner-danger-bg text-ex-banner-danger-fg rounded-lg border px-4 py-3 text-sm">
          {error}
        </p>
      ) : null}

      <Card className="overflow-hidden">
        <CardHeader className="bg-ex-surface/40 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>{canReview ? "Complaint Review Queue" : "My Complaints"}</CardTitle>
            <p className="text-ex-muted mt-1 text-sm">
              {canReview ? `${pendingCount} Complaints Awaiting Action` : "Your Submission History"}
            </p>
          </div>
          <div className="bg-ex-elevated flex w-fit rounded-lg p-1">
            {(["All", "Pending", "Approved", "Rejected"] as StatusFilter[]).map((status) => (
              <button
                key={status}
                type="button"
                onClick={() => setStatusFilter(status)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm font-medium transition",
                  statusFilter === status
                    ? "bg-ex-surface text-ex-primary shadow-sm"
                    : "text-ex-muted hover:text-ex-primary",
                )}
              >
                {status}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <p className="text-ex-muted px-5 py-10 text-sm">Loading Complaints…</p>
          ) : visibleComplaints.length === 0 ? (
            <div className="px-5 py-14 text-center">
              <MessageSquareWarning className="text-ex-muted/50 mx-auto size-8" />
              <p className="mt-3 font-medium">No {statusFilter.toLowerCase()} Complaints</p>
              <p className="text-ex-muted mt-1 text-sm">
                Complaints matching this status will appear here.
              </p>
            </div>
          ) : (
            <div className="divide-ex-border divide-y">
              {visibleComplaints.map((complaint) => (
                <article key={complaint.id} className="space-y-4 px-5 py-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex min-w-0 gap-3">
                      <div
                        className={cn(
                          "flex size-10 shrink-0 items-center justify-center rounded-xl",
                          complaint.severity === "high"
                            ? "bg-rose-500/15 text-rose-600"
                            : "bg-amber-500/15 text-amber-700",
                        )}
                      >
                        <AlertTriangle className="size-5" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-semibold">{complaint.subject}</h3>
                          <Badge variant={statusVariant(complaint.status)}>
                            {complaint.status}
                          </Badge>
                          <Badge variant="default">{complaint.severity} priority</Badge>
                        </div>
                        <p className="text-ex-muted mt-1 text-sm">
                          {canReview ? `${complaint.submitterName} · ` : ""}
                          {categoryLabel(complaint.category)} · {formatDate(complaint.createdAt)}
                        </p>
                      </div>
                    </div>
                  </div>
                  <p className="text-ex-primary text-sm leading-6 whitespace-pre-wrap">
                    {complaint.details}
                  </p>

                  {complaint.status !== "Pending" ? (
                    <div
                      className={cn(
                        "rounded-lg border px-4 py-3 text-sm",
                        complaint.status === "Approved"
                          ? "border-emerald-500/25 bg-emerald-500/8"
                          : "border-rose-500/25 bg-rose-500/8",
                      )}
                    >
                      <div className="flex items-center gap-2 font-medium">
                        {complaint.status === "Approved" ? (
                          <CheckCircle2 className="size-4 text-emerald-600" />
                        ) : (
                          <XCircle className="size-4 text-rose-600" />
                        )}
                        {complaint.status} by {complaint.reviewedByName || "HR"}
                      </div>
                      {complaint.reviewNote ? (
                        <p className="text-ex-muted mt-1">{complaint.reviewNote}</p>
                      ) : null}
                    </div>
                  ) : canReview ? (
                    <div className="border-ex-border bg-ex-surface/40 rounded-xl border p-4">
                      <Label htmlFor={`review-${complaint.id}`}>
                        Review note <span className="text-ex-muted">(required for rejection)</span>
                      </Label>
                      <Textarea
                        id={`review-${complaint.id}`}
                        rows={3}
                        maxLength={1000}
                        className="mt-2"
                        value={reviewNotes[complaint.id] ?? ""}
                        placeholder="Record the action to take or reason for rejection"
                        onChange={(event) =>
                          setReviewNotes((current) => ({
                            ...current,
                            [complaint.id]: event.target.value,
                          }))
                        }
                      />
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          disabled={reviewingId === complaint.id}
                          onClick={() => void review(complaint, "Approved")}
                        >
                          <CheckCircle2 className="size-4" />
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          disabled={reviewingId === complaint.id}
                          onClick={() => void review(complaint, "Rejected")}
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
