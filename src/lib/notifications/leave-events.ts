import {
  formatLeaveDurationDisplay,
  isHalfDayLeaveDuration,
} from "@/lib/attendance/leave-display";
import { parseLeaveDisplayDate } from "@/lib/attendance/leave-range-display";
import { sendLeaveReviewedEmail } from "@/lib/email/leave-emails";
import type { EmailDeliveryResult } from "@/lib/email/types";
import { addDaysToDateIso, notificationDateIso } from "@/lib/notifications/automation-date";
import { getEmployeeEmailBySheetRow } from "@/lib/notifications/employee-lookup";
import { createNotifications } from "@/lib/notifications/repository";
import { NOTIFICATION_TYPES, type NotificationType } from "@/lib/notifications/types";
import { listHrAndSuperAdminRecipients } from "@/lib/notifications/recipients";

export type LeaveNotificationContext = {
  employeeSheetRow: number;
  employeeId: string;
  employeeName: string;
  employeeEmail?: string;
  leaveType: string;
  dateRange: string;
  /** Leave bucket duration label, e.g. Full Day, Half Day (AM). */
  duration?: string;
  reason?: string;
  applicationId?: string;
  /** When set, notification copy reflects punch-gate absence backfill. */
  source?: "leave_desk" | "absence_explanation";
};

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

function leaveExpirationDate(dateRange: string): string | undefined {
  const endPart = dateRange.trim().split(" - ").at(-1)?.trim() ?? "";
  const endDate = parseLeaveDisplayDate(endPart);
  if (!endDate) return undefined;

  const endIso = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(
    2,
    "0",
  )}-${String(endDate.getDate()).padStart(2, "0")}`;
  return addDaysToDateIso(endIso, 1);
}

/** Keep notifications visible long enough for HR to act, even for past-dated leave. */
function resolveLeaveNotificationExpiresAt(dateRange: string): string {
  const fromLeave = leaveExpirationDate(dateRange);
  const minExpiry = addDaysToDateIso(notificationDateIso(), 14);
  if (!fromLeave) return minExpiry;
  return fromLeave > minExpiry ? fromLeave : minExpiry;
}

export async function notifyLeaveSubmitted(context: LeaveNotificationContext): Promise<number> {
  const leaveLabel = formatLeaveTypeLabel(context.leaveType);
  const expiresAt = resolveLeaveNotificationExpiresAt(context.dateRange);
  const hrRecipients = await listHrAndSuperAdminRecipients();
  const fromAbsence = context.source === "absence_explanation";
  const inputs = [];

  inputs.push({
    recipientSheetRow: context.employeeSheetRow,
    recipientEmployeeId: context.employeeId,
    type: NOTIFICATION_TYPES.LEAVE_SUBMITTED_EMPLOYEE as NotificationType,
    title: fromAbsence ? "Absence leave request submitted" : "Leave request submitted",
    body: fromAbsence
      ? `Your ${leaveLabel} leave request for ${context.dateRange} (from absence explanation) has been submitted and is pending approval.`
      : `Your ${leaveLabel} leave request for ${context.dateRange} has been submitted and is pending approval.`,
    href: "/leave",
    dedupeKey: context.applicationId
      ? `leave_submitted_employee:${context.applicationId}`
      : undefined,
    expiresAt,
  });

  for (const recipient of hrRecipients) {
    inputs.push({
      recipientSheetRow: recipient.sheetRow,
      recipientEmployeeId: recipient.employeeId,
      type: NOTIFICATION_TYPES.LEAVE_SUBMITTED as NotificationType,
      title: fromAbsence ? "New absence leave request" : "New leave request",
      body: fromAbsence
        ? `${context.employeeName} submitted a ${leaveLabel} leave request for ${context.dateRange} after an unauthorized absence.${context.reason ? ` Reason: ${context.reason}` : ""}`
        : `${context.employeeName} submitted a ${leaveLabel} leave request for ${context.dateRange}.`,
      href: "/leave/approvals",
      dedupeKey: context.applicationId
        ? `leave_submitted_hr:${context.applicationId}:${recipient.sheetRow}`
        : undefined,
      expiresAt,
    });
  }

  return createNotifications(inputs);
}

export async function notifyLeaveReviewed(params: {
  context: LeaveNotificationContext;
  status: "Accepted" | "Rejected";
  rejectReason?: string;
}): Promise<{ email: EmailDeliveryResult }> {
  const { context, status, rejectReason } = params;
  const isApproved = status === "Accepted";
  const expiresAt = resolveLeaveNotificationExpiresAt(context.dateRange);
  const type = isApproved ? NOTIFICATION_TYPES.LEAVE_APPROVED : NOTIFICATION_TYPES.LEAVE_REJECTED;
  const leaveLabel = formatLeaveTypeLabel(context.leaveType);
  const durationLabel = formatLeaveDurationDisplay(context.duration);
  const halfDay = isHalfDayLeaveDuration(context.duration);
  const durationPhrase = halfDay ? `${durationLabel.toLowerCase()} ` : "full-day ";

  let body = isApproved
    ? `Your ${leaveLabel} ${durationPhrase}leave request for ${context.dateRange} has been approved (${durationLabel}).`
    : `Your ${leaveLabel} ${durationPhrase}leave request for ${context.dateRange} has been rejected (${durationLabel}).`;

  if (!isApproved && rejectReason?.trim()) {
    body += ` Reason: ${rejectReason.trim()}`;
  }
  if (isApproved) {
    body += " Your leave balance has been updated.";
  } else {
    body += " Your leave balance has been restored for this request.";
  }

  await createNotifications([
    {
      recipientSheetRow: context.employeeSheetRow,
      recipientEmployeeId: context.employeeId,
      type,
      title: isApproved
        ? halfDay
          ? "Your half-day leave is approved"
          : "Your full-day leave is approved"
        : halfDay
          ? "Your half-day leave is rejected"
          : "Your full-day leave is rejected",
      body,
      href: "/leave",
      dedupeKey: context.applicationId
        ? `leave_review:${context.applicationId}:${status.toLowerCase()}`
        : undefined,
      expiresAt,
    },
  ]);

  const employeeEmail =
    context.employeeEmail?.trim() || (await getEmployeeEmailBySheetRow(context.employeeSheetRow));
  if (!employeeEmail) {
    const reason = "Employee work email is missing in the employee sheet.";
    console.warn(`Leave review email skipped: ${reason}`);
    return { email: { sent: false, reason } };
  }

  try {
    const email = await sendLeaveReviewedEmail({
      to: employeeEmail,
      employeeName: context.employeeName,
      leaveType: context.leaveType,
      dateRange: context.dateRange,
      duration: context.duration,
      status,
      rejectReason,
    });
    return { email };
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : "Unknown error while sending leave review email.";
    console.error("Leave review email error:", error);
    return { email: { sent: false, reason, to: employeeEmail } };
  }
}

export function getLeaveStartDateFromRange(dateRange: string): Date | null {
  const startPart = dateRange.trim().split(" - ")[0]?.trim() ?? "";
  return parseLeaveDisplayDate(startPart);
}

export async function notifyUpcomingLeave(params: {
  employeeSheetRow: number;
  employeeId: string;
  employeeName: string;
  leaveType: string;
  dateRange: string;
  applicationId: string;
  leaveStartDate: Date;
}): Promise<number> {
  const hrRecipients = await listHrAndSuperAdminRecipients();
  const leaveLabel = formatLeaveTypeLabel(params.leaveType);
  const startLabel = `${params.leaveStartDate.getDate()}/${params.leaveStartDate.getMonth() + 1}/${params.leaveStartDate.getFullYear()}`;
  const dedupeBase = `leave_upcoming:${params.applicationId}:${startLabel}`;
  const expiresAt = resolveLeaveNotificationExpiresAt(params.dateRange);

  const inputs = hrRecipients.map((recipient) => ({
    recipientSheetRow: recipient.sheetRow,
    recipientEmployeeId: recipient.employeeId,
    type: NOTIFICATION_TYPES.LEAVE_UPCOMING as NotificationType,
    title: "Upcoming leave reminder",
    body: `${params.employeeName} will be on ${leaveLabel} leave starting ${startLabel} (in 2 days). Leave period: ${params.dateRange}.`,
    href: "/leave/approvals",
    dedupeKey: `${dedupeBase}:${recipient.sheetRow}`,
    expiresAt,
  }));

  return createNotifications(inputs);
}
