import { NextRequest, NextResponse } from "next/server";

import {
  ABSENCE_GATE_SUPPRESS_COOKIE,
  readAbsenceGateSuppressDates,
  setAbsenceGateCookie,
  setMorningPunchGateCookie,
} from "@/lib/attendance/absence-gate-cookie";
import { roleRequiresAbsenceExplanationGate } from "@/lib/attendance/absence-gate";
import { getPendingAbsenceGroupsForUser } from "@/lib/attendance/absence-gate-sync";
import { userRequiresMorningPunchGate } from "@/lib/attendance/morning-punch-gate";
import { getSessionFromCookie } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

/** Sync punch-desk gates and return whether site access is blocked. */
export async function GET(req: NextRequest) {
  const user = await getSessionFromCookie();
  if (!user || !roleRequiresAbsenceExplanationGate(user.role)) {
    return NextResponse.json({ active: false });
  }

  const suppressedDates = readAbsenceGateSuppressDates(
    req.cookies.get(ABSENCE_GATE_SUPPRESS_COOKIE)?.value,
  );

  const [pendingGroups, requiresMorningPunch] = await Promise.all([
    getPendingAbsenceGroupsForUser(user, { forceRefresh: true }),
    userRequiresMorningPunchGate(user),
  ]);
  const requiresAbsenceExplanation = pendingGroups.some((group) =>
    group.entries.some((entry) => !suppressedDates.has(entry.dateIso)),
  );
  const active = requiresAbsenceExplanation || requiresMorningPunch;

  const res = NextResponse.json({
    active,
    absenceExplanation: requiresAbsenceExplanation,
    morningPunch: requiresMorningPunch,
  });
  setAbsenceGateCookie(res, requiresAbsenceExplanation);
  setMorningPunchGateCookie(res, requiresMorningPunch);
  return res;
}
