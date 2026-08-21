import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { COOKIE, decodeSession } from "@/lib/session";
import { canAccessPath } from "@/lib/rbac";
import {
  ABSENCE_GATE_COOKIE,
  PUNCH_TODAY_COOKIE,
  isSiteAccessGateActive,
} from "@/lib/attendance/absence-gate-cookie";
import {
  PUNCH_GATE_ROUTE,
  isPunchRoute,
  roleCanPunchInOut,
  roleRequiresAbsenceExplanationGate,
} from "@/lib/attendance/absence-gate";
import { NETWORK_BLOCKED_PATH } from "@/lib/network-access/constants";
import {
  NETWORK_GATE_COOKIE,
  readNetworkGateDecision,
} from "@/lib/network-access/network-gate-cookie";
import { canManageEmployees } from "@/lib/auth/roles";
import type { UserRole } from "@/types/auth";

const PUBLIC_PATHS = [
  "/login",
  "/account-inactive",
  NETWORK_BLOCKED_PATH,
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/me",
  "/api/auth/status",
  "/api/auth/absence-gate",
  "/api/auth/network-access",
  "/api/integrations/google-drive/callback",
  "/api/cron/leave-reminders",
  // Vercel Cron (midnight IST) — auth is enforced inside the route.
  "/api/admin/sync-attendance-to-sheets",
  "/api/branding/public",
];

const NETWORK_GATE_ALLOWED_PATHS = [
  NETWORK_BLOCKED_PATH,
  "/api/auth/logout",
  "/api/auth/me",
  "/api/auth/status",
  "/api/auth/network-access",
];

const GATE_ALLOWED_PAGE_PATHS = [PUNCH_GATE_ROUTE];

const GATE_ALLOWED_API_PATHS = [
  "/api/attendance",
  "/api/attendance/absence-explanation",
  "/api/attendance/corrections",
  "/api/auth/logout",
  "/api/auth/me",
  "/api/auth/status",
  "/api/auth/absence-gate",
];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

async function fetchAccountActive(req: NextRequest): Promise<boolean> {
  const url = new URL("/api/auth/status", req.url);
  // Next.js Edge middleware can behave inconsistently with `req.headers.get("cookie")`.
  // We forward the session cookie explicitly from the parsed cookie store.
  const sessionCookie = req.cookies.get(COOKIE)?.value ?? "";
  const res = await fetch(url, {
    headers: sessionCookie ? { cookie: `${COOKIE}=${sessionCookie}` } : {},
    cache: "no-store",
  });
  if (!res.ok) return true;
  try {
    const data = (await res.json()) as {
      authenticated?: boolean;
      active?: boolean;
      error?: string;
    };
    // Fail-open on transient status-check failures (common on serverless/edge):
    // only treat as inactive when the API explicitly confirms it.
    if (data.authenticated === true) {
      return data.active !== false;
    }
    return true;
  } catch {
    return true;
  }
}

function isNetworkGateAllowedPath(pathname: string): boolean {
  return NETWORK_GATE_ALLOWED_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function redirectToNetworkBlocked(req: NextRequest) {
  const url = req.nextUrl.clone();
  url.pathname = NETWORK_BLOCKED_PATH;
  url.search = "";
  return NextResponse.redirect(url);
}

/**
 * Cookie-based network gate (no Google Sheets in middleware).
 * Missing/stale cookie → /network-blocked to revalidate via Node API.
 */
function enforceNetworkGate(req: NextRequest, role: UserRole): NextResponse | null {
  if (canManageEmployees(role)) return null;

  const decision = readNetworkGateDecision(req.cookies.get(NETWORK_GATE_COOKIE)?.value, req);
  if (decision === "allow") return null;
  return redirectToNetworkBlocked(req);
}

function isGateRequired(req: NextRequest, gateRole: boolean): boolean {
  if (!gateRole) return false;
  return isSiteAccessGateActive(
    req.cookies.get(ABSENCE_GATE_COOKIE)?.value,
    req.cookies.get(PUNCH_TODAY_COOKIE)?.value,
  );
}

function isGateAllowedPath(pathname: string): boolean {
  if (GATE_ALLOWED_PAGE_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return true;
  }

  if (pathname === "/api/attendance") {
    return true;
  }

  return GATE_ALLOWED_API_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function redirectToPunch(req: NextRequest) {
  const url = req.nextUrl.clone();
  url.pathname = PUNCH_GATE_ROUTE;
  url.search = "";
  return NextResponse.redirect(url);
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.match(/\.(ico|png|jpg|jpeg|svg|webp)$/)
  ) {
    return NextResponse.next();
  }

  const raw = req.cookies.get(COOKIE)?.value;
  const user = raw ? decodeSession(raw) : null;
  const gateRole = user ? roleRequiresAbsenceExplanationGate(user.role as UserRole) : false;
  const gateRequired = isGateRequired(req, gateRole);

  if (pathname === "/account-inactive") {
    if (!user) {
      return NextResponse.redirect(new URL("/login", req.url));
    }
    const active = await fetchAccountActive(req);
    if (active) {
      const networkRedirect = enforceNetworkGate(req, user.role as UserRole);
      if (networkRedirect) return networkRedirect;
      if (gateRequired) {
        return redirectToPunch(req);
      }
      return NextResponse.redirect(new URL("/dashboard", req.url));
    }
    return NextResponse.next();
  }

  if (pathname === NETWORK_BLOCKED_PATH) {
    if (!user) {
      return NextResponse.redirect(new URL("/login", req.url));
    }
    const active = await fetchAccountActive(req);
    if (!active) {
      return NextResponse.redirect(new URL("/account-inactive", req.url));
    }
    // Always allow this page so the client can call /api/auth/network-access and refresh the cookie.
    return NextResponse.next();
  }

  if (pathname === "/absence-explanation") {
    return redirectToPunch(req);
  }

  if (pathname === "/login") {
    if (user) {
      const active = await fetchAccountActive(req);
      if (!active) {
        return NextResponse.redirect(new URL("/account-inactive", req.url));
      }
      const networkRedirect = enforceNetworkGate(req, user.role as UserRole);
      if (networkRedirect) return networkRedirect;
      if (gateRequired) {
        return redirectToPunch(req);
      }
      return NextResponse.redirect(new URL("/dashboard", req.url));
    }
    return NextResponse.next();
  }

  if (isPublicPath(pathname) || pathname.startsWith("/api/auth")) {
    return NextResponse.next();
  }

  if (!user) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("from", pathname);
    return NextResponse.redirect(url);
  }

  const active = await fetchAccountActive(req);
  if (!active) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        {
          success: false,
          message: "You cannot access this route. Your account is deactivated.",
          code: "ACCOUNT_INACTIVE",
        },
        { status: 403 },
      );
    }
    const url = req.nextUrl.clone();
    url.pathname = "/account-inactive";
    return NextResponse.redirect(url);
  }

  if (!isNetworkGateAllowedPath(pathname)) {
    const networkRedirect = enforceNetworkGate(req, user.role as UserRole);
    if (networkRedirect) {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json(
          {
            success: false,
            message: "Access is limited to the office Wi‑Fi network.",
            code: "NETWORK_RESTRICTED",
          },
          { status: 403 },
        );
      }
      return networkRedirect;
    }
  }

  if (gateRequired && !isGateAllowedPath(pathname)) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        {
          success: false,
          message: "Complete punch desk requirements before accessing the site.",
          code: "PUNCH_DESK_REQUIRED",
        },
        { status: 403 },
      );
    }
    return redirectToPunch(req);
  }

  if (isPunchRoute(pathname) && !roleCanPunchInOut(user.role as UserRole)) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        {
          success: false,
          message: "Punch in/out is not available for your role.",
          code: "PUNCH_ACCESS_DENIED",
        },
        { status: 403 },
      );
    }
    const url = req.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  if (!canAccessPath(user.role as UserRole, pathname)) {
    const url = req.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
