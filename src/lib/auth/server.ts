import { cookies } from "next/headers";

import { COOKIE, decodeSession } from "@/lib/session";
import type { SessionUser } from "@/types/auth";

import { isSessionUserActive } from "./account-status";

export { canManageEmployees, canReviewOvertime, canReviewOvertimeRequest } from "./roles";

/** Decode session cookie without checking account status. */
export async function getSessionFromCookie(): Promise<SessionUser | null> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return null;
  return decodeSession(raw);
}

/** Active users only — returns null when inactive or not signed in. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const user = await getSessionFromCookie();
  if (!user) return null;
  if (!(await isSessionUserActive(user))) return null;
  return user;
}
