import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { isSessionUserActive } from "@/lib/auth/account-status";
import { getSessionFromCookie } from "@/lib/auth/server";
import { COOKIE, SESSION_COOKIE_CLEAR_OPTIONS } from "@/lib/session";

/** Skip a live employee lookup briefly after login — credentials were just verified. */
const RECENT_LOGIN_TRUST_MS = 2 * 60 * 1000;

export async function GET() {
  try {
    const raw = (await cookies()).get(COOKIE)?.value;
    const user = await getSessionFromCookie();
    if (!user) {
      const res = NextResponse.json({ user: null });
      // Drop expired / invalid cookies so the browser does not keep a dead session.
      if (raw) res.cookies.set(COOKIE, "", SESSION_COOKIE_CLEAR_OPTIONS);
      return res;
    }

    const loggedInAt = typeof user.loggedInAt === "number" ? user.loggedInAt : 0;
    const recentlyLoggedIn =
      loggedInAt > 0 && Date.now() - loggedInAt < RECENT_LOGIN_TRUST_MS;

    if (!recentlyLoggedIn) {
      const active = await isSessionUserActive(user);
      if (!active) {
        const res = NextResponse.json({ user: null, inactive: true });
        res.cookies.set(COOKIE, "", SESSION_COOKIE_CLEAR_OPTIONS);
        return res;
      }
    }

    return NextResponse.json({ user });
  } catch (error) {
    console.error("[auth/me]", error);
    return NextResponse.json({ user: null, error: "session_check_failed" });
  }
}
