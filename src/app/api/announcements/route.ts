import { NextResponse } from "next/server";

import {
  createAnnouncement,
  deleteAnnouncement,
  listAnnouncements,
  updateAnnouncement,
  type AnnouncementCategory,
} from "@/lib/announcements";
import { withActiveSession } from "@/lib/auth/api-guard";
import { canManageEmployees } from "@/lib/auth/roles";
import { listActiveEmployees } from "@/lib/notifications/recipients";
import {
  createNotifications,
  deleteNotificationsByDedupePrefix,
  updateNotificationsByDedupePrefix,
} from "@/lib/notifications/repository";
import { NOTIFICATION_TYPES } from "@/lib/notifications/types";
import { toApiErrorMessage } from "@/lib/api/user-facing-error";

function parseCategory(value: unknown): AnnouncementCategory | null {
  const category = String(value ?? "")
    .trim()
    .toLowerCase();
  if (category === "general" || category === "office_leave" || category === "important") {
    return category;
  }
  return null;
}

function categoryNoticeLabel(category: AnnouncementCategory): string {
  if (category === "office_leave") return "office leave";
  if (category === "important") return "important";
  return "general";
}

function announcementDedupePrefix(announcementId: string): string {
  return `announcement:${announcementId}:`;
}

function announcementNoticeCopy(params: {
  title: string;
  message: string;
  category: AnnouncementCategory;
  authorName: string;
}): { title: string; body: string } {
  return {
    title: `New announcement: ${params.title}`,
    body: `${params.authorName} published a new ${categoryNoticeLabel(params.category)} company notice.\n\n${params.message}`,
  };
}

export const GET = withActiveSession(async (req) => {
  try {
    const { searchParams } = new URL(req.url);
    const limitParam = Number(searchParams.get("limit") ?? "");
    const activeOnly =
      searchParams.get("activeOnly") === "1" || searchParams.get("activeOnly") === "true";
    const announcements = await listAnnouncements({ activeOnly });
    const limited =
      Number.isInteger(limitParam) && limitParam > 0
        ? announcements.slice(0, Math.min(limitParam, 50))
        : announcements;

    return NextResponse.json({ success: true, announcements: limited });
  } catch (error) {
    console.error("GET Announcements Error:", error);
    return NextResponse.json(
      {
        success: false,
        message: toApiErrorMessage(error, "Failed to load announcements"),
      },
      { status: 500 },
    );
  }
});

export const POST = withActiveSession(async (req, user) => {
  if (!canManageEmployees(user.role)) {
    return NextResponse.json({ success: false, message: "Forbidden" }, { status: 403 });
  }

  try {
    const body = (await req.json()) as Record<string, unknown>;
    const title = String(body.title ?? "").trim();
    const message = String(body.message ?? "").trim();
    const category = parseCategory(body.category);
    const expiresAt = String(body.expiresAt ?? "")
      .trim()
      .slice(0, 10);

    if (!title || title.length > 120) {
      return NextResponse.json(
        { success: false, message: "Title is required and must be at most 120 characters" },
        { status: 400 },
      );
    }
    if (!message || message.length > 2000) {
      return NextResponse.json(
        { success: false, message: "Message is required and must be at most 2000 characters" },
        { status: 400 },
      );
    }
    if (!category) {
      return NextResponse.json(
        { success: false, message: "Valid announcement category is required" },
        { status: 400 },
      );
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expiresAt)) {
      return NextResponse.json(
        { success: false, message: "Expiry / end date is required (YYYY-MM-DD)" },
        { status: 400 },
      );
    }

    // Company-wide notice: every Active employee, including HR and Super Admin.
    // Skip only the publisher — they already see the publish confirmation.
    const authorSheetRow = user.sheetRow ?? 0;
    const authorName = user.name.trim() || "HR";
    const recipients = (await listActiveEmployees()).filter(
      (employee) => authorSheetRow < 2 || employee.sheetRow !== authorSheetRow,
    );
    const announcement = await createAnnouncement({
      title,
      message,
      category,
      authorSheetRow,
      authorName,
      recipientCount: recipients.length,
      expiresAt,
    });

    const notice = announcementNoticeCopy({
      title,
      message,
      category,
      authorName,
    });

    const notified = await createNotifications(
      recipients.map((employee) => ({
        recipientSheetRow: employee.sheetRow,
        recipientEmployeeId: employee.employeeId,
        type: NOTIFICATION_TYPES.ANNOUNCEMENT,
        title: notice.title,
        body: notice.body,
        href: "/notifications",
        dedupeKey: `announcement:${announcement.id}:${employee.sheetRow}`,
      })),
    );

    return NextResponse.json(
      {
        success: true,
        announcement: { ...announcement, recipientCount: notified },
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("POST Announcement Error:", error);
    return NextResponse.json(
      {
        success: false,
        message: toApiErrorMessage(error, "Failed to publish announcement"),
      },
      { status: 500 },
    );
  }
});

export const PATCH = withActiveSession(async (req, user) => {
  if (!canManageEmployees(user.role)) {
    return NextResponse.json({ success: false, message: "Forbidden" }, { status: 403 });
  }

  try {
    const body = (await req.json()) as Record<string, unknown>;
    const id = String(body.id ?? "").trim();
    const title = String(body.title ?? "").trim();
    const message = String(body.message ?? "").trim();
    const category = parseCategory(body.category);
    const expiresAt = String(body.expiresAt ?? "")
      .trim()
      .slice(0, 10);

    if (!id) {
      return NextResponse.json({ success: false, message: "Announcement id is required" }, { status: 400 });
    }
    if (!title || title.length > 120) {
      return NextResponse.json(
        { success: false, message: "Title is required and must be at most 120 characters" },
        { status: 400 },
      );
    }
    if (!message || message.length > 2000) {
      return NextResponse.json(
        { success: false, message: "Message is required and must be at most 2000 characters" },
        { status: 400 },
      );
    }
    if (!category) {
      return NextResponse.json(
        { success: false, message: "Valid announcement category is required" },
        { status: 400 },
      );
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expiresAt)) {
      return NextResponse.json(
        { success: false, message: "Expiry / end date is required (YYYY-MM-DD)" },
        { status: 400 },
      );
    }

    const announcement = await updateAnnouncement(id, {
      title,
      message,
      category,
      expiresAt,
    });

    // Employee Notifications Center stores a copy of the notice text.
    // Keep those copies in sync so edits show for employees too.
    const notice = announcementNoticeCopy({
      title: announcement.title,
      message: announcement.message,
      category: announcement.category,
      authorName: announcement.authorName.trim() || user.name.trim() || "HR",
    });
    try {
      await updateNotificationsByDedupePrefix({
        dedupePrefix: announcementDedupePrefix(announcement.id),
        title: notice.title,
        body: notice.body,
        markUnread: true,
      });
    } catch (syncError) {
      console.warn("[announcements] notification sync after edit failed:", syncError);
    }

    return NextResponse.json({ success: true, announcement });
  } catch (error) {
    console.error("PATCH Announcement Error:", error);
    const message = toApiErrorMessage(error, "Failed to update announcement");
    const status = /not found/i.test(message) ? 404 : 500;
    return NextResponse.json({ success: false, message }, { status });
  }
});

export const DELETE = withActiveSession(async (req, user) => {
  if (!canManageEmployees(user.role)) {
    return NextResponse.json({ success: false, message: "Forbidden" }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const id = String(searchParams.get("id") ?? "").trim();
    if (!id) {
      return NextResponse.json({ success: false, message: "Announcement id is required" }, { status: 400 });
    }

    const deleted = await deleteAnnouncement(id);
    if (!deleted) {
      return NextResponse.json({ success: false, message: "Announcement not found" }, { status: 404 });
    }

    try {
      await deleteNotificationsByDedupePrefix(announcementDedupePrefix(id));
    } catch (syncError) {
      console.warn("[announcements] notification cleanup after delete failed:", syncError);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE Announcement Error:", error);
    return NextResponse.json(
      {
        success: false,
        message: toApiErrorMessage(error, "Failed to delete announcement"),
      },
      { status: 500 },
    );
  }
});
