"use client";

import { readResponseJson } from "@/lib/api/read-response-json";
import Link from "next/link";
import { Megaphone } from "lucide-react";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/auth-provider";
import { canManageEmployees } from "@/lib/auth/roles";
import { cn } from "@/lib/utils";

type AnnouncementCategory = "general" | "office_leave" | "important";

type DashboardAnnouncement = {
  id: string;
  title: string;
  message: string;
  category: AnnouncementCategory;
  authorName: string;
  createdAt: string;
};

const DASHBOARD_ANNOUNCEMENT_LIMIT = 1;

function categoryLabel(category: AnnouncementCategory): string {
  if (category === "office_leave") return "Office Leave";
  if (category === "important") return "Important";
  return "General";
}

function categoryVariant(category: AnnouncementCategory): "default" | "accent" | "danger" {
  if (category === "office_leave") return "accent";
  if (category === "important") return "danger";
  return "default";
}

function formatPostedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

function normalizeMessage(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function DashboardAnnouncements({
  className,
  loading: externalLoading,
  onLoadingChange,
}: {
  className?: string;
  /** When true, keep the skeleton even if this section already finished fetching. */
  loading?: boolean;
  onLoadingChange?: (loading: boolean) => void;
}) {
  const { user } = useAuth();
  const canManage = user ? canManageEmployees(user.role) : false;
  const [announcements, setAnnouncements] = useState<DashboardAnnouncement[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    onLoadingChange?.(true);
    void fetch(`/api/announcements?limit=${DASHBOARD_ANNOUNCEMENT_LIMIT}&activeOnly=1`, {
      cache: "no-store",
      credentials: "include",
    })
      .then(async (response) => {
        const data = await readResponseJson<{
          success?: boolean;
          announcements?: DashboardAnnouncement[];
        }>(response, "fetch");
        if (!response.ok || !data.success) {
          throw new Error("Failed to load announcements");
        }
        return data.announcements ?? [];
      })
      .then((records) => {
        if (cancelled) return;
        setAnnouncements(records);
      })
      .catch(() => {
        if (cancelled) return;
        setAnnouncements([]);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
        onLoadingChange?.(false);
      });

    return () => {
      cancelled = true;
    };
  }, [onLoadingChange]);

  const items = announcements;
  const viewAllHref = canManage ? "/notifications/announcements" : "/notifications";
  const showLoading = externalLoading || loading;

  if (showLoading) {
    return (
      <section
        className={cn(
          "border-ex-border bg-ex-elevated flex h-full min-h-[9.5rem] flex-col rounded-xl border p-3 shadow-sm dark:shadow-none",
          className,
        )}
        aria-busy
        aria-live="polite"
        aria-label="Loading announcements"
      >
        <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
          <Skeleton className="h-3 w-36 rounded-md" />
          <Skeleton className="h-3 w-14 rounded-md" />
        </div>
        <div className="bg-ex-secondary/5 flex min-h-0 flex-1 flex-col rounded-lg border px-2.5 py-2.5">
          <div className="flex items-start gap-2.5">
            <Skeleton className="mt-0.5 size-7 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Skeleton className="h-5 w-16 rounded-full" />
                <Skeleton className="h-4 w-40 max-w-[55%] rounded-md" />
              </div>
              <Skeleton className="h-3 w-full rounded-md" />
              <Skeleton className="h-3 w-3/4 max-w-sm rounded-md" />
              <div className="flex items-center justify-between gap-2 pt-0.5">
                <Skeleton className="h-3 w-32 rounded-md" />
                <Skeleton className="h-3 w-24 rounded-md" />
              </div>
            </div>
          </div>
        </div>
      </section>
    );
  }

  if (items.length === 0) {
    return (
      <div
        className={cn(
          "border-ex-border bg-ex-elevated flex h-full min-h-[9.5rem] flex-col rounded-xl border border-dashed p-3 shadow-sm dark:shadow-none",
          className,
        )}
      >
        <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
          <p className="text-ex-muted text-xs font-medium tracking-wide uppercase">
            Company Announcements
          </p>
          {canManage ? (
            <Link
              href="/notifications/announcements"
              className="text-ex-secondary text-xs font-medium underline-offset-2 hover:underline"
            >
              Create Announcement
            </Link>
          ) : (
            <Link
              href={viewAllHref}
              className="text-ex-secondary text-xs font-medium underline-offset-2 hover:underline"
            >
              View All
            </Link>
          )}
        </div>
        <div className="flex min-h-0 flex-1 items-center gap-3 px-1">
          <div className="bg-ex-secondary/10 text-ex-secondary flex size-10 shrink-0 items-center justify-center rounded-full">
            <Megaphone className="size-4" aria-hidden />
          </div>
          <div className="min-w-0">
            <p className="text-ex-primary text-sm font-medium">No Announcements</p>
            <p className="text-ex-muted mt-0.5 text-xs leading-snug">
              {canManage
                ? "No active notices. Publish one when you need to reach the team."
                : "No active company notices today. Check back later for updates."}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <section
      className={cn(
        "border-ex-border bg-ex-elevated flex h-full min-h-[9.5rem] flex-col rounded-xl border p-3 shadow-sm dark:shadow-none",
        className,
      )}
    >
      <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
        <p className="text-ex-muted text-xs font-medium tracking-wide uppercase">
          Company Announcements
        </p>
        <Link
          href={viewAllHref}
          className="text-ex-secondary text-xs font-medium underline-offset-2 hover:underline"
        >
          View All
        </Link>
      </div>

      <ul className="flex min-h-0 flex-1 flex-col gap-2">
        {items.map((announcement) => {
          const message = normalizeMessage(announcement.message);
          const meta = [announcement.authorName, formatPostedAt(announcement.createdAt)]
            .filter(Boolean)
            .join(" · ");

          return (
            <li
              key={announcement.id}
              className="border-ex-secondary/20 bg-ex-secondary/5 flex min-h-0 flex-1 flex-col rounded-lg border px-2.5 py-2.5"
            >
              <div className="flex items-start gap-2.5">
                <div className="bg-ex-secondary/15 text-ex-secondary mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full">
                  <Megaphone className="size-3.5" aria-hidden />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <Badge variant={categoryVariant(announcement.category)} className="px-1.5 py-0">
                      {categoryLabel(announcement.category)}
                    </Badge>
                    <p className="text-ex-primary text-sm font-semibold">{announcement.title}</p>
                  </div>
                  {message ? (
                    <div className="relative mt-1 max-h-24 overflow-hidden">
                      <p className="text-ex-muted text-sm leading-snug whitespace-pre-wrap wrap-break-word">
                        {message}
                      </p>
                    </div>
                  ) : null}
                  <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
                    {meta ? <p className="text-ex-muted text-xs">{meta}</p> : <span />}
                    <Link
                      href={viewAllHref}
                      className="text-ex-secondary text-xs font-medium underline-offset-2 hover:underline"
                    >
                      Read Full Notice
                    </Link>
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
