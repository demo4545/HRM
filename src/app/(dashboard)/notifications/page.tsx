"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  Bell,
  Cake,
  CalendarClock,
  Check,
  CheckCheck,
  CheckCircle2,
  Clock3,
  Inbox,
  Megaphone,
  Send,
  Sparkles,
  XCircle,
} from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { canManageEmployees } from "@/lib/auth/roles";
import { useAuth } from "@/contexts/auth-provider";
import { useNotifications } from "@/contexts/notifications-provider";

type NotificationRow = {
  id: string;
  title: string;
  body: string;
  href: string;
  read: boolean;
  createdAt: string;
  type: string;
};

type StatusFilter = "all" | "unread" | "read";

const STATUS_FILTERS: Array<{ id: StatusFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "unread", label: "Unread" },
  { id: "read", label: "Read" },
];

function formatRelativeTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.floor(diffMs / 60000);
  if (diffMinutes < 1) return "Just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleString();
}

function typeBadgeVariant(type: string): "default" | "success" | "warning" | "danger" | "accent" {
  if (type.includes("approved")) return "success";
  if (type.includes("rejected")) return "danger";
  if (type.includes("submitted")) return "warning";
  if (type.includes("upcoming")) return "accent";
  if (type.includes("birthday")) return "accent";
  if (type === "expense_payment_due") return "warning";
  if (type === "expense_payment_overdue") return "danger";
  if (type === "auto_punch_out") return "warning";
  if (type === "announcement") return "accent";
  return "default";
}

function typeLabel(type: string): string {
  const labels: Record<string, string> = {
    leave_submitted: "Leave submitted",
    leave_submitted_employee: "Submitted",
    leave_approved: "Approved",
    leave_rejected: "Rejected",
    leave_upcoming: "Upcoming leave",
    employee_birthday: "Birthday",
    employee_increment_upcoming: "Increment reminder",
    announcement: "Announcement",
    complaint_submitted: "New complaint",
    complaint_approved: "Complaint approved",
    complaint_rejected: "Complaint rejected",
    correction_submitted: "New correction",
    correction_submitted_employee: "Submitted",
    correction_approved: "Correction approved",
    correction_rejected: "Correction rejected",
    expense_payment_due: "Expense payment pending",
    expense_payment_overdue: "Expense payment overdue",
    auto_punch_out: "Auto punch-out",
  };
  return labels[type] ?? "Notification";
}

function NotificationIcon({ type }: { type: string }) {
  const className = "size-5";
  if (type.includes("approved")) return <CheckCircle2 className={className} />;
  if (type.includes("rejected")) return <XCircle className={className} />;
  if (type.includes("submitted")) return <Send className={className} />;
  if (type.includes("birthday")) return <Cake className={className} />;
  if (type.includes("increment")) return <Sparkles className={className} />;
  if (type.includes("upcoming")) return <CalendarClock className={className} />;
  if (type === "expense_payment_overdue") return <AlertTriangle className={className} />;
  if (type === "expense_payment_due") return <Clock3 className={className} />;
  if (type === "auto_punch_out") return <AlertTriangle className={className} />;
  if (type === "announcement") return <Megaphone className={className} />;
  return <Bell className={className} />;
}

function notificationIconClasses(type: string): string {
  if (type.includes("approved")) return "bg-emerald-500/12 text-emerald-600";
  if (type.includes("rejected")) return "bg-rose-500/12 text-rose-600";
  if (type.includes("submitted")) return "bg-amber-500/12 text-amber-700";
  if (type.includes("birthday")) return "bg-pink-500/12 text-pink-600";
  if (type.includes("increment")) return "bg-violet-500/12 text-violet-600";
  if (type === "expense_payment_overdue") return "bg-rose-500/12 text-rose-600";
  if (type === "expense_payment_due") return "bg-amber-500/12 text-amber-700";
  if (type === "auto_punch_out") return "bg-amber-500/12 text-amber-700";
  if (type === "announcement") return "bg-sky-500/12 text-sky-600";
  return "bg-ex-accent/15 text-ex-accent";
}

function birthdayEmployeeName(title: string): string {
  return title.replace(/'s birthday(?: this month| today)?$/, "");
}

export default function NotificationsPage() {
  const { user } = useAuth();
  const { notifications, birthdayReminders, unreadCount, loading, markAsRead, markAllAsRead } =
    useNotifications();
  const canViewBirthdays = user ? canManageEmployees(user.role) : false;
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [markingAll, setMarkingAll] = useState(false);
  const [markingIds, setMarkingIds] = useState<Set<string>>(() => new Set());
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());

  const rows = notifications as NotificationRow[];

  const filteredRows = useMemo(() => {
    if (filter === "unread") return rows.filter((row) => !row.read);
    if (filter === "read") return rows.filter((row) => row.read);
    return rows;
  }, [filter, rows]);
  const birthdayRows = useMemo(() => birthdayReminders as NotificationRow[], [birthdayReminders]);
  const birthdayCount = birthdayRows.length;

  const markRead = async (id: string) => {
    setMarkingIds((current) => new Set(current).add(id));
    try {
      await markAsRead(id);
    } finally {
      setMarkingIds((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  };

  const markAllRead = async () => {
    setMarkingAll(true);
    try {
      await markAllAsRead();
    } finally {
      setMarkingAll(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Notification Center"
        description="Stay on top of leave activity, employee milestones, and company updates."
        actions={
          unreadCount > 0 ? (
            <Button
              variant="outline"
              size="sm"
              disabled={markingAll}
              onClick={() => void markAllRead()}
            >
              <CheckCheck className="size-4" />
              {markingAll ? "Marking…" : "Mark all read"}
            </Button>
          ) : undefined
        }
      />

      <div className={cn("grid gap-4 sm:grid-cols-2", canViewBirthdays && "sm:grid-cols-3")}>
        <Card className="overflow-hidden">
          <CardContent className="flex items-center gap-4 p-4">
            <div className="bg-ex-accent/15 text-ex-accent flex size-11 items-center justify-center rounded-xl">
              <Bell className="size-5" />
            </div>
            <div>
              <p className="text-ex-muted text-xs font-medium tracking-wide uppercase">
                All notifications
              </p>
              <p className="mt-0.5 text-2xl font-semibold">{rows.length}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="overflow-hidden">
          <CardContent className="flex items-center gap-4 p-4">
            <div className="flex size-11 items-center justify-center rounded-xl bg-sky-500/12 text-sky-600">
              <Inbox className="size-5" />
            </div>
            <div>
              <p className="text-ex-muted text-xs font-medium tracking-wide uppercase">Unread</p>
              <p className="mt-0.5 text-2xl font-semibold">{unreadCount}</p>
            </div>
          </CardContent>
        </Card>
        {canViewBirthdays ? (
          <Card className="overflow-hidden">
            <CardContent className="flex items-center gap-4 p-4">
              <div className="flex size-11 items-center justify-center rounded-xl bg-pink-500/12 text-pink-600">
                <Cake className="size-5" />
              </div>
              <div>
                <p className="text-ex-muted text-xs font-medium tracking-wide uppercase">
                  Birthdays this month
                </p>
                <p className="mt-0.5 text-2xl font-semibold">{birthdayCount}</p>
              </div>
            </CardContent>
          </Card>
        ) : null}
      </div>

      <div
        className={cn(
          "grid items-start gap-6",
          canViewBirthdays && "lg:grid-cols-[minmax(0,1fr)_340px]",
        )}
      >
        <Card className="overflow-hidden">
          <div className="border-ex-border flex flex-col gap-4 border-b px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-semibold">Recent activity</h2>
              <p className="text-ex-muted mt-0.5 text-sm">Your latest workplace updates</p>
            </div>
            <div className="bg-ex-surface flex w-fit rounded-lg p-1">
              {STATUS_FILTERS.map((item) => {
                const count =
                  item.id === "all"
                    ? rows.length
                    : item.id === "unread"
                      ? unreadCount
                      : rows.length - unreadCount;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setFilter(item.id)}
                    className={cn(
                      "rounded-md px-3 py-1.5 text-sm font-medium transition-all",
                      filter === item.id
                        ? "bg-ex-elevated text-ex-primary shadow-sm"
                        : "text-ex-muted hover:text-ex-primary",
                    )}
                  >
                    {item.label} <span className="ml-1 text-xs opacity-70">{count}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {loading ? (
            <div className="space-y-1 p-2">
              {[1, 2, 3].map((item) => (
                <div key={item} className="flex animate-pulse gap-4 rounded-xl p-4">
                  <div className="bg-ex-surface size-11 rounded-xl" />
                  <div className="flex-1 space-y-2 py-1">
                    <div className="bg-ex-surface h-4 w-1/3 rounded" />
                    <div className="bg-ex-surface h-3 w-4/5 rounded" />
                  </div>
                </div>
              ))}
            </div>
          ) : filteredRows.length === 0 ? (
            <div className="flex flex-col items-center px-6 py-16 text-center">
              <div className="bg-ex-surface text-ex-muted flex size-14 items-center justify-center rounded-2xl">
                <Inbox className="size-6" />
              </div>
              <p className="mt-4 font-medium">
                {filter === "unread" ? "You’re all caught up" : "No notifications here"}
              </p>
              <p className="text-ex-muted mt-1 max-w-xs text-sm">
                {filter === "unread"
                  ? "There are no unread updates waiting for you."
                  : "New workplace activity will appear here."}
              </p>
            </div>
          ) : (
            <div className="divide-ex-border divide-y">
              {filteredRows.map((row) => {
                const expanded = expandedIds.has(row.id);
                const isLong = row.body.length > 180;
                return (
                  <article
                    key={row.id}
                    className={cn(
                      "group relative flex gap-3 px-4 py-5 transition-colors sm:gap-4 sm:px-5",
                      !row.read ? "bg-ex-accent/[0.035]" : "hover:bg-ex-surface/60",
                    )}
                  >
                    {!row.read ? (
                      <span className="bg-ex-accent absolute top-6 left-0 h-8 w-0.5 rounded-r" />
                    ) : null}
                    <div
                      className={cn(
                        "flex size-11 shrink-0 items-center justify-center rounded-xl",
                        notificationIconClasses(row.type),
                      )}
                    >
                      <NotificationIcon type={row.type} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <h3 className={cn("font-medium", !row.read && "font-semibold")}>
                            {row.title}
                          </h3>
                          {!row.read ? (
                            <span className="bg-ex-accent size-1.5 rounded-full" />
                          ) : null}
                        </div>
                        <span className="text-ex-muted flex shrink-0 items-center gap-1 text-xs">
                          <Clock3 className="size-3" />
                          {formatRelativeTime(row.createdAt)}
                        </span>
                      </div>
                      <p
                        className={cn(
                          "text-ex-muted mt-1.5 text-sm leading-6 wrap-break-word whitespace-pre-wrap",
                          isLong && !expanded && "line-clamp-2",
                        )}
                      >
                        {row.body}
                      </p>
                      <div className="mt-3 flex flex-wrap items-center gap-3">
                        <Badge variant={typeBadgeVariant(row.type)}>{typeLabel(row.type)}</Badge>
                        {isLong ? (
                          <button
                            type="button"
                            className="text-ex-muted hover:text-ex-primary cursor-pointer text-xs font-medium"
                            onClick={() =>
                              setExpandedIds((current) => {
                                const next = new Set(current);
                                if (next.has(row.id)) next.delete(row.id);
                                else next.add(row.id);
                                return next;
                              })
                            }
                          >
                            {expanded ? "Show less" : "Read more"}
                          </button>
                        ) : null}
                        {row.href && row.href !== "/notifications" ? (
                          <Link
                            href={row.href}
                            className="text-ex-accent inline-flex items-center gap-1 text-xs font-medium hover:underline"
                          >
                            View details <ArrowUpRight className="size-3" />
                          </Link>
                        ) : null}
                        {!row.read ? (
                          <button
                            type="button"
                            disabled={markingIds.has(row.id)}
                            onClick={() => void markRead(row.id)}
                            className="text-ex-muted hover:text-ex-primary ml-auto inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium disabled:cursor-wait disabled:opacity-60"
                          >
                            <Check className="size-3.5" />
                            {markingIds.has(row.id) ? "Marking…" : "Mark as read"}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </Card>

        {canViewBirthdays ? (
          <Card className="overflow-hidden lg:sticky lg:top-6">
            <div className="relative overflow-hidden bg-linear-to-br from-pink-500/15 via-rose-500/8 to-transparent px-5 py-5">
              <div className="absolute -top-8 -right-8 size-28 rounded-full bg-pink-400/10" />
              <div className="relative flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex size-10 items-center justify-center rounded-xl bg-pink-500/15 text-pink-600">
                    <Cake className="size-5" />
                  </div>
                  <div>
                    <h2 className="font-semibold">Birthdays this month</h2>
                    <p className="text-ex-muted text-sm">{birthdayCount} remaining</p>
                  </div>
                </div>
              </div>
            </div>

            <CardContent className="p-0">
              {birthdayCount === 0 ? (
                <div className="px-5 py-10 text-center">
                  <Cake className="text-ex-muted/50 mx-auto size-7" />
                  <p className="text-ex-muted mt-3 text-sm">No upcoming birthdays this month.</p>
                </div>
              ) : (
                <div className="divide-ex-border divide-y">
                  {birthdayRows.map((birthday) => {
                    const employeeName = birthdayEmployeeName(birthday.title);
                    return (
                      <Link
                        key={birthday.id}
                        href={birthday.href || "/notifications"}
                        className="hover:bg-ex-surface/60 flex items-center gap-3 px-5 py-4 transition-colors"
                      >
                        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-pink-500/12 font-semibold text-pink-700">
                          {employeeName.charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{employeeName}</p>
                          <p className="text-ex-muted mt-0.5 line-clamp-2 text-xs leading-5">
                            {birthday.body}
                          </p>
                        </div>
                        <ArrowUpRight className="text-ex-muted size-4 shrink-0" />
                      </Link>
                    );
                  })}
                </div>
              )}
              <div className="border-ex-border bg-ex-surface/50 flex items-start gap-2 border-t px-5 py-3">
                <Clock3 className="text-ex-muted mt-0.5 size-3.5 shrink-0" />
                <p className="text-ex-muted text-xs leading-5">
                  Birthday reminders disappear automatically after the date passes.
                </p>
              </div>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
