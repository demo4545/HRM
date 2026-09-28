"use client";

import { readResponseJson } from "@/lib/api/read-response-json";
import { useEffect, useState } from "react";

import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useNotifications } from "@/contexts/notifications-provider";
import { toUserFacingActionError, toUserFacingFetchError } from "@/lib/api/user-facing-error";
import { localTodayIso } from "@/lib/attendance/manual-entry";

type AnnouncementCategory = "general" | "office_leave" | "important";

type AnnouncementRecord = {
  id: string;
  title: string;
  message: string;
  category: AnnouncementCategory;
  authorName: string;
  recipientCount: number;
  createdAt: string;
  expiresAt?: string;
};

function categoryLabel(category: AnnouncementCategory): string {
  if (category === "office_leave") return "Office leave";
  if (category === "important") return "Important";
  return "General";
}

function categoryVariant(category: AnnouncementCategory): "default" | "warning" | "danger" {
  if (category === "office_leave") return "warning";
  if (category === "important") return "danger";
  return "default";
}

function formatDate(value?: string): string {
  const raw = String(value ?? "")
    .trim()
    .slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return "—";
  const date = new Date(`${raw}T12:00:00`);
  if (Number.isNaN(date.getTime())) return raw;
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

function isExpired(expiresAt?: string): boolean {
  const end = String(expiresAt ?? "")
    .trim()
    .slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(end)) return true;
  return end < localTodayIso();
}

export default function AnnouncementsPage() {
  const { pushToast } = useNotifications();
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [category, setCategory] = useState<AnnouncementCategory>("general");
  const [expiresAt, setExpiresAt] = useState(localTodayIso());
  const [announcements, setAnnouncements] = useState<AnnouncementRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/announcements", { cache: "no-store" })
      .then(async (response) => {
        const data = await readResponseJson<{
          success?: boolean;
          message?: string;
          announcements?: AnnouncementRecord[];
        }>(response, "fetch");
        if (!response.ok || !data.success) {
          throw new Error(data.message ?? "Failed to load announcements");
        }
        return data.announcements ?? [];
      })
      .then((records) => {
        if (!cancelled) setAnnouncements(records);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          pushToast({
            title: "Couldn’t load announcements",
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

  const publishAnnouncement = async () => {
    if (!title.trim() || !message.trim()) {
      pushToast({
        title: "Missing details",
        body: "Title and message are required.",
        variant: "error",
      });
      return;
    }
    if (!expiresAt.trim()) {
      pushToast({
        title: "Expiry date required",
        body: "Choose a visible-until end date.",
        variant: "error",
      });
      return;
    }

    setPublishing(true);
    try {
      const response = await fetch("/api/announcements", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          message: message.trim(),
          category,
          expiresAt,
        }),
      });
      const data = await readResponseJson<{
        success?: boolean;
        message?: string;
        announcement?: AnnouncementRecord;
      }>(response, "action");

      if (!response.ok || !data.success || !data.announcement) {
        throw new Error(data.message ?? "Failed to publish announcement");
      }

      setAnnouncements((current) => [data.announcement!, ...current]);
      setTitle("");
      setMessage("");
      setCategory("general");
      setExpiresAt(localTodayIso());
      pushToast({
        title: "Announcement published",
        body: `Sent to ${data.announcement.recipientCount} active employee${data.announcement.recipientCount === 1 ? "" : "s"}.`,
        variant: "success",
      });
    } catch (publishError) {
      pushToast({
        title: "Publish failed",
        body: toUserFacingActionError(publishError),
        variant: "error",
      });
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div className="space-y-8">
      <PageHeader
        title="Notice / Announcement"
        description="Publish office leave notices and general messages to all active employees."
      />

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Compose announcement</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2 md:col-span-2">
            <Label>Title</Label>
            <Input
              value={title}
              maxLength={120}
              placeholder="Office closed, policy update, team meeting…"
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Notice type</Label>
            <Select
              value={category}
              onChange={(event) => setCategory(event.target.value as AnnouncementCategory)}
            >
              <option value="general">General message</option>
              <option value="office_leave">Office leave</option>
              <option value="important">Important notice</option>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Audience</Label>
            <Input value="All active employees" disabled />
          </div>
          <div className="space-y-2">
            <Label>Visible until (end date)</Label>
            <Input
              type="date"
              value={expiresAt}
              min={localTodayIso()}
              onChange={(event) => setExpiresAt(event.target.value)}
            />
            <p className="text-ex-muted text-xs">
              Shown on the dashboard through this date, then hidden automatically.
            </p>
          </div>
          <div className="space-y-2 md:col-span-2">
            <div className="flex items-center justify-between">
              <Label>Message</Label>
              <span className="text-ex-muted text-xs">{message.length}/2000</span>
            </div>
            <Textarea
              rows={6}
              value={message}
              maxLength={2000}
              placeholder="Write the announcement employees should receive…"
              onChange={(event) => setMessage(event.target.value)}
            />
          </div>

          <Button
            className="w-fit md:col-span-2"
            variant="secondary"
            disabled={publishing}
            onClick={() => void publishAnnouncement()}
          >
            {publishing ? "Publishing…" : "Publish to all employees"}
          </Button>
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Published announcements</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <p className="text-ex-muted px-5 py-8 text-sm">Loading announcement history…</p>
          ) : announcements.length === 0 ? (
            <div className="px-5 py-10 text-center">
              <p className="text-ex-primary font-medium">No announcements published</p>
              <p className="text-ex-muted mt-1 text-sm">
                Published notices will appear here for HR and Super Admin.
              </p>
            </div>
          ) : (
            <div className="divide-ex-border divide-y">
              {announcements.map((announcement) => (
                <article key={announcement.id} className="space-y-3 px-5 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-ex-primary font-semibold">{announcement.title}</h3>
                        <Badge variant={categoryVariant(announcement.category)}>
                          {categoryLabel(announcement.category)}
                        </Badge>
                        {isExpired(announcement.expiresAt) ? (
                          <Badge variant="default">Expired</Badge>
                        ) : (
                          <Badge variant="accent">Active on dashboard</Badge>
                        )}
                      </div>
                      <p className="text-ex-muted mt-1 text-xs">
                        Published by {announcement.authorName || "Manager"} ·{" "}
                        {new Date(announcement.createdAt).toLocaleString()} · Visible until{" "}
                        {formatDate(announcement.expiresAt)}
                      </p>
                    </div>
                    <Badge variant="accent">
                      {announcement.recipientCount} recipient
                      {announcement.recipientCount === 1 ? "" : "s"}
                    </Badge>
                  </div>
                  <p className="text-ex-primary text-sm whitespace-pre-wrap">
                    {announcement.message}
                  </p>
                </article>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
