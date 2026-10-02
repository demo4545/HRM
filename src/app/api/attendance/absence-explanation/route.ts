import { NextResponse } from "next/server";
import { z } from "zod";

import { submitAbsenceExplanations } from "@/lib/attendance/absence-explanation";
import { roleRequiresAbsenceExplanationGate } from "@/lib/attendance/absence-gate";
import {
  getPendingAbsenceGroupsForUser,
  invalidateAbsenceExplanationCache,
} from "@/lib/attendance/absence-gate-sync";
import {
  ABSENCE_GATE_COOKIE,
  ABSENCE_GATE_SUPPRESS_COOKIE,
  isAbsenceGateCookieActive,
  readAbsenceGateSuppressDates,
  setAbsenceGateCookie,
  setAbsenceGateSuppressCookie,
} from "@/lib/attendance/absence-gate-cookie";
import { resolveAttendanceEmployee } from "@/lib/attendance/employee";
import { setCachedAbsenceGroups } from "@/lib/attendance/absence-explanation-cache";
import { withActiveSession } from "@/lib/auth/api-guard";
import { toApiErrorMessage } from "@/lib/api/user-facing-error";
import type { PendingAbsenceGroup } from "@/lib/attendance/absence-explanation";

function filterSuppressedGroups(
  groups: PendingAbsenceGroup[],
  suppressedDates: Set<string>,
): PendingAbsenceGroup[] {
  if (suppressedDates.size === 0) return groups;
  return groups
    .map((group) => ({
      ...group,
      entries: group.entries.filter((entry) => !suppressedDates.has(entry.dateIso)),
    }))
    .filter((group) => group.entries.length > 0);
}

const submitSchema = z.object({
  submissions: z
    .array(
      z.object({
        groupId: z.string().min(1),
        explanation: z.string().min(1),
        leaveType: z.enum(["sick", "casual"]).optional(),
        reasonType: z.enum(["today_no_punch", "rejected_leave", "unauthorized_absence"]).optional(),
        dateFromIso: z.string().optional(),
        dateToIso: z.string().optional(),
        entryDates: z.array(z.string().min(1)).optional(),
      }),
    )
    .min(1),
});

export const dynamic = "force-dynamic";

export const GET = withActiveSession(async (req, user) => {
  if (!roleRequiresAbsenceExplanationGate(user.role)) {
    const res = NextResponse.json({
      success: true,
      groups: [],
      requiresExplanation: false,
    });
    setAbsenceGateCookie(res, false);
    return res;
  }

  try {
    const forceRefresh = req.headers.get("x-absence-gate-refresh") === "1";
    const gateCookie = req.cookies.get(ABSENCE_GATE_COOKIE)?.value;
    const suppressedDates = readAbsenceGateSuppressDates(
      req.cookies.get(ABSENCE_GATE_SUPPRESS_COOKIE)?.value,
    );

    // Cookie was cleared after a successful submit (or login bootstrap). Never return a
    // stale non-empty in-memory cache from another instance — that re-shows the form and
    // re-activates the gate. Recompute from storage so login still discovers real pending.
    if (!forceRefresh && !isAbsenceGateCookieActive(gateCookie)) {
      const fresh = await getPendingAbsenceGroupsForUser(user, { forceRefresh: true });
      const groups = filterSuppressedGroups(fresh, suppressedDates);
      const res = NextResponse.json({
        success: true,
        groups,
        requiresExplanation: groups.length > 0,
      });
      setAbsenceGateCookie(res, groups.length > 0);
      return res;
    }

    const fresh = await getPendingAbsenceGroupsForUser(user, { forceRefresh });
    const groups = filterSuppressedGroups(fresh, suppressedDates);
    const res = NextResponse.json({
      success: true,
      groups,
      requiresExplanation: groups.length > 0,
    });
    setAbsenceGateCookie(res, groups.length > 0);
    return res;
  } catch (error) {
    console.error("[absence-explanation GET]", error);
    const message = toApiErrorMessage(error, "Failed to load absence explanations");
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
});

export const POST = withActiveSession(async (req, user) => {
  if (!roleRequiresAbsenceExplanationGate(user.role)) {
    return NextResponse.json(
      { success: false, message: "Not applicable for your role" },
      { status: 403 },
    );
  }

  try {
    const employee = await resolveAttendanceEmployee(user);
    if (!employee?.attendanceSpreadsheetId) {
      return NextResponse.json(
        { success: false, message: "Employee attendance record not found" },
        { status: 404 },
      );
    }

    const body = await req.json();
    const parsed = submitSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, message: parsed.error.issues[0]?.message ?? "Invalid request" },
        { status: 400 },
      );
    }

    const submittedGroupIds = new Set(parsed.data.submissions.map((item) => item.groupId));
    const submittedDates = new Set(
      parsed.data.submissions.flatMap((item) => {
        const dates = item.entryDates?.filter(Boolean) ?? [];
        if (dates.length > 0) return dates;
        if (item.dateFromIso) return [item.dateFromIso];
        return [];
      }),
    );

    await submitAbsenceExplanations({
      employee,
      submissions: parsed.data.submissions,
    });

    invalidateAbsenceExplanationCache(employee.employeeId);
    // Sheets (and multi-instance memory caches) can lag right after write. Treat just-submitted
    // groups/dates as cleared so the client is not bounced back to the same form.
    const freshGroups = await getPendingAbsenceGroupsForUser(user, { forceRefresh: true });
    const groups = freshGroups.filter(
      (group) =>
        !submittedGroupIds.has(group.id) &&
        !group.entries.some((entry) => submittedDates.has(entry.dateIso)),
    );
    setCachedAbsenceGroups(employee.employeeId, groups);

    const res = NextResponse.json({
      success: true,
      message: "Absence explanation submitted",
      requiresExplanation: groups.length > 0,
      groups,
    });
    setAbsenceGateCookie(res, groups.length > 0);
    setAbsenceGateSuppressCookie(res, [...submittedDates]);
    return res;
  } catch (error) {
    console.error("[absence-explanation POST]", error);
    const message = toApiErrorMessage(error, "Failed to submit absence explanation");
    return NextResponse.json({ success: false, message }, { status: 400 });
  }
});
