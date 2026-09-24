"use client";

import { readResponseJson } from "@/lib/api/read-response-json";
import Link from "next/link";
import { Megaphone } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/auth-provider";
import { useNotifications } from "@/contexts/notifications-provider";
import { canManageEmployees } from "@/lib/auth/roles";
import { NOTIFICATION_TYPES } from "@/lib/notifications/types";
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
  if (category === "office_leave") return "Office leave";
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

function inferCategory(title: string, body: string): AnnouncementCategory {
  const text = `${title} ${body}`.toLowerCase();
  if (/\b(urgent|important|critical)\b/.test(text)) return "important";
  if (/\b(office|closed|leave|holiday|visarjan)\b/.test(text)) return "office_leave";
  return "general";
}

export function DashboardAnnouncements({ className }: { className?: string }) {
  const { user } = useAuth();
  const { notifications } = useNotifications();
  const canManage = user ? canManageEmployees(user.role) : false;
  const [announcements, setAnnouncements] = useState<DashboardAnnouncement[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/announcements?limit=${DASHBOARD_ANNOUNCEMENT_LIMIT}`, {
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
        setLoadFailed(false);
      })
      .catch(() => {
        if (cancelled) return;
        setAnnouncements([]);
        setLoadFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const fromNotifications = useMemo((): DashboardAnnouncement[] => {
    return notifications
      .filter((item) => item.type === NOTIFICATION_TYPES.ANNOUNCEMENT)
      .slice(0, DASHBOARD_ANNOUNCEMENT_LIMIT)
      .map((item) => ({
        id: item.id,
        title: item.title,
        message: item.body,
        category: inferCategory(item.title, item.body),
        authorName: "",
        createdAt: item.createdAt,
      }));
  }, [notifications]);

  const items = announcements.length > 0 ? announcements : loadFailed ? fromNotifications : [];
  const viewAllHref = canManage ? "/notifications/announcements" : "/notifications";

  if (loading) {
    return (
      <div
        className={cn(
          "border-ex-border bg-ex-surface/50 h-full min-h-[9.5rem] animate-pulse rounded-xl border",
          className,
        )}
        aria-hidden
      />
    );
  }

  if (items.length === 0) {
    return (
      <div
        className={cn(
          "border-ex-border bg-ex-elevated flex h-full min-h-[9.5rem] flex-col justify-center rounded-xl border border-dashed px-4 py-3",
          className,
        )}
      >
        <p className="text-ex-muted text-xs font-medium tracking-wide uppercase">
          Company announcements
        </p>
        <p className="text-ex-muted mt-1 text-sm">No announcements right now.</p>
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
          Company announcements
        </p>
        <Link
          href={viewAllHref}
          className="text-ex-secondary text-xs font-medium underline-offset-2 hover:underline"
        >
          View all
        </Link>
      </div>

      <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
        {items.map((announcement) => {
          const message = normalizeMessage(announcement.message);
          const meta = [announcement.authorName, formatPostedAt(announcement.createdAt)]
            .filter(Boolean)
            .join(" · ");

          return (
            <li
              key={announcement.id}
              className="border-ex-secondary/20 bg-ex-secondary/5 flex min-h-0 flex-1 items-start gap-2.5 rounded-lg border px-2.5 py-2.5"
            >
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
                  <p className="text-ex-muted mt-1 text-sm leading-snug">{message}</p>
                ) : null}
                {meta ? <p className="text-ex-muted mt-1 text-xs">{meta}</p> : null}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
