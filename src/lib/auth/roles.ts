import { ROLES } from "@/app/consts/common";
import type { UserRole } from "@/types/auth";

export function canManageEmployees(role: UserRole): boolean {
  return role === ROLES.HR_MANAGER || role === ROLES.SUPER_ADMIN;
}

/** Roles that may review at least some overtime requests (HR and Super Admin). */
export function canReviewOvertime(role: UserRole): boolean {
  return role === ROLES.SUPER_ADMIN || role === ROLES.HR_MANAGER;
}

/**
 * Employee-submitted OT → HR or Super Admin.
 * HR/Super Admin-submitted OT → Super Admin only.
 * Missing/legacy `requestedByRole` is treated as employee-submitted.
 */
export function canReviewOvertimeRequest(
  reviewerRole: UserRole,
  requestedByRole?: string | null,
): boolean {
  if (!canReviewOvertime(reviewerRole)) return false;
  if (reviewerRole === ROLES.SUPER_ADMIN) return true;

  const by = String(requestedByRole ?? "")
    .trim()
    .toLowerCase();
  if (by === ROLES.HR_MANAGER || by === ROLES.SUPER_ADMIN) return false;
  return true;
}

export function canManageCompanyBranding(role: UserRole): boolean {
  return role === ROLES.SUPER_ADMIN;
}

export {
  roleRequiresAbsenceExplanationGate,
  roleCanPunchInOut,
  roleCanApplyLeave,
  isPunchRoute,
  isLeaveDeskRoute,
  PUNCH_GATE_ROUTE,
  LEAVE_DESK_ROUTE,
} from "@/lib/attendance/absence-gate";
