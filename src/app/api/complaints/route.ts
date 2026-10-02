import { NextResponse } from "next/server";

import { withActiveSession } from "@/lib/auth/api-guard";
import { canManageEmployees } from "@/lib/auth/roles";
import {
  COMPLAINT_CATEGORIES,
  COMPLAINT_SEVERITIES,
  createComplaint,
  listComplaints,
  reviewComplaint,
  type ComplaintCategory,
  type ComplaintSeverity,
} from "@/lib/complaints";
import {
  notifyComplaintReviewed,
  notifyComplaintSubmitted,
} from "@/lib/notifications/complaint-events";
import { toApiErrorMessage } from "@/lib/api/user-facing-error";

function parseSubmission(body: Record<string, unknown>): {
  subject: string;
  category: ComplaintCategory;
  severity: ComplaintSeverity;
  details: string;
} | null {
  const subject = String(body.subject ?? "").trim();
  const category = String(body.category ?? "")
    .trim()
    .toLowerCase() as ComplaintCategory;
  const severity = String(body.severity ?? "")
    .trim()
    .toLowerCase() as ComplaintSeverity;
  const details = String(body.details ?? "").trim();

  if (!subject || subject.length > 120 || !details || details.length > 2000) return null;
  if (!COMPLAINT_CATEGORIES.includes(category)) return null;
  if (!COMPLAINT_SEVERITIES.includes(severity)) return null;
  return { subject, category, severity, details };
}

export const GET = withActiveSession(async (_req, user) => {
  try {
    const complaints = await listComplaints();
    const visibleComplaints = canManageEmployees(user.role)
      ? complaints
      : complaints.filter((complaint) => complaint.submitterSheetRow === user.sheetRow);
    return NextResponse.json({ success: true, complaints: visibleComplaints });
  } catch (error) {
    console.error("GET Complaints Error:", error);
    return NextResponse.json(
      {
        success: false,
        message: toApiErrorMessage(error, "Failed to load help desk tickets"),
      },
      { status: 500 },
    );
  }
});

export const POST = withActiveSession(async (req, user) => {
  if (!user.sheetRow) {
    return NextResponse.json(
      { success: false, message: "Employee record not found" },
      { status: 404 },
    );
  }

  try {
    const body = (await req.json()) as Record<string, unknown>;
    const input = parseSubmission(body);
    if (!input) {
      return NextResponse.json(
        {
          success: false,
          message: "Subject, category, priority, and ticket details are required",
        },
        { status: 400 },
      );
    }

    const complaint = await createComplaint({
      submitterSheetRow: user.sheetRow,
      submitterEmployeeId: user.id,
      submitterName: user.name,
      ...input,
    });
    try {
      await notifyComplaintSubmitted(complaint);
    } catch (notificationError) {
      console.error("Complaint submission notification error:", notificationError);
    }

    return NextResponse.json({ success: true, complaint }, { status: 201 });
  } catch (error) {
    console.error("POST Complaint Error:", error);
    return NextResponse.json(
      {
        success: false,
        message: toApiErrorMessage(error, "Failed to submit ticket"),
      },
      { status: 500 },
    );
  }
});

export const PATCH = withActiveSession(async (req, user) => {
  if (!canManageEmployees(user.role)) {
    return NextResponse.json({ success: false, message: "Forbidden" }, { status: 403 });
  }
  if (!user.sheetRow) {
    return NextResponse.json(
      { success: false, message: "Employee record not found" },
      { status: 404 },
    );
  }

  try {
    const body = (await req.json()) as Record<string, unknown>;
    const id = String(body.id ?? "").trim();
    const status = String(body.status ?? "").trim();
    const reviewNote = String(body.reviewNote ?? "").trim();
    if (!id || (status !== "Approved" && status !== "Rejected")) {
      return NextResponse.json(
        { success: false, message: "Ticket id and valid review status are required" },
        { status: 400 },
      );
    }
    if (reviewNote.length > 1000 || (status === "Rejected" && !reviewNote)) {
      return NextResponse.json(
        {
          success: false,
          message: "A rejection reason is required and must be under 1000 characters",
        },
        { status: 400 },
      );
    }

    const result = await reviewComplaint({
      id,
      status,
      reviewNote,
      reviewedBySheetRow: user.sheetRow,
      reviewedByName: user.name,
    });
    if (!result.complaint) {
      return NextResponse.json({ success: false, message: "Ticket not found" }, { status: 404 });
    }
    if (result.alreadyReviewed) {
      return NextResponse.json(
        { success: false, message: "Ticket has already been reviewed" },
        { status: 409 },
      );
    }

    try {
      await notifyComplaintReviewed(result.complaint);
    } catch (notificationError) {
      console.error("Complaint review notification error:", notificationError);
    }
    return NextResponse.json({ success: true, complaint: result.complaint });
  } catch (error) {
    console.error("PATCH Complaint Error:", error);
    return NextResponse.json(
      {
        success: false,
        message: toApiErrorMessage(error, "Failed to review ticket"),
      },
      { status: 500 },
    );
  }
});
