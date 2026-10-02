import { ROLES } from "@/app/consts/common";
import type { UserRole } from "@/types/auth";

export const PUNCH_GATE_ROUTE = "/employee/punch";
export const LEAVE_DESK_ROUTE = "/leave";

export function isPunchRoute(pathname: string): boolean {
  return pathname === PUNCH_GATE_ROUTE || pathname.startsWith(`${PUNCH_GATE_ROUTE}/`);
}

/** Leave application desk only — not `/leave/approvals` or `/leave/holidays`. */
export function isLeaveDeskRoute(pathname: string): boolean {
  const normalized = pathname.replace(/\/+$/, "") || "/";
  return normalized === LEAVE_DESK_ROUTE;
}

export function roleCanPunchInOut(role: UserRole): boolean {
  return role === ROLES.HR_MANAGER || role === ROLES.EMPLOYEE || role === ROLES.INTERN;
}

export function roleCanApplyLeave(role: UserRole): boolean {
  return role === ROLES.HR_MANAGER || role === ROLES.EMPLOYEE || role === ROLES.INTERN;
}

export function roleRequiresAbsenceExplanationGate(role: UserRole): boolean {
  return roleCanPunchInOut(role);
}
