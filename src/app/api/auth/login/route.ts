import { after, NextResponse } from "next/server";

import {
  setAbsenceGateCookie,
  setMorningPunchGateCookie,
} from "@/lib/attendance/absence-gate-cookie";
import { roleRequiresAbsenceExplanationGate } from "@/lib/attendance/absence-gate";
import { syncAbsenceGateForUser } from "@/lib/attendance/absence-gate-sync";
import { ensureForgottenPunchOutForUser } from "@/lib/attendance/auto-punch-out";
import { userRequiresMorningPunchGate } from "@/lib/attendance/morning-punch-gate";
import { authenticateFromSheet } from "@/lib/auth/login";
import { evaluateNetworkAccess } from "@/lib/network-access/gate";
import { isValidIpv4, normalizeIp } from "@/lib/network-access/ip";
import { setNetworkGateCookie } from "@/lib/network-access/network-gate-cookie";
import { COOKIE, encodeSession, sessionCookieOptionsForRole } from "@/lib/session";
import type { SessionUser } from "@/types/auth";

const LOGIN_RETRY_DELAYS_MS = [150, 350];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function authenticateWithRetry(login: string, password: string) {
  let lastError: unknown;
  for (let attempt = 0; attempt <= LOGIN_RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await authenticateFromSheet(login, password);
    } catch (error) {
      lastError = error;
      if (attempt < LOGIN_RETRY_DELAYS_MS.length) {
        await sleep(LOGIN_RETRY_DELAYS_MS[attempt]);
        continue;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Authentication failed");
}

/**
 * Heavy punch-desk gates run after the login response so sign-in is not blocked.
 * DashboardShell already calls /api/auth/absence-gate and redirects when needed.
 */
function schedulePostLoginGates(user: SessionUser): void {
  if (!roleRequiresAbsenceExplanationGate(user.role)) return;

  after(() => {
    void Promise.all([
      syncAbsenceGateForUser(user).catch((error) => {
        console.warn("[auth/login] background absence gate failed:", error);
      }),
      userRequiresMorningPunchGate(user).catch((error) => {
        console.warn("[auth/login] background morning punch gate failed:", error);
      }),
      ensureForgottenPunchOutForUser(user).catch((error) => {
        console.warn("[auth/login] auto punch-out catch-up failed:", error);
      }),
    ]);
  });
}

export async function POST(req: Request) {
  try {
    let body: {
      email?: string;
      login?: string;
      password?: string;
      /** Browser-detected public IP — used only when the server sees localhost (local dev). */
      publicIp?: string;
    };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const login = (body.login ?? body.email ?? "").trim();
    const password = body.password ?? "";
    const reportedPublicIp = normalizeIp(body.publicIp ?? "");
    const safeReportedIp = isValidIpv4(reportedPublicIp) ? reportedPublicIp : null;

    const result = await authenticateWithRetry(login, password);

    if (!result.ok) {
      if (result.reason === "account_inactive") {
        return NextResponse.json(
          {
            error:
              "Your account is inactive. You cannot sign in. Contact HR or your administrator.",
            code: "ACCOUNT_INACTIVE",
          },
          { status: 403 },
        );
      }

      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    // Only the network gate must finish before redirect (security). Absence /
    // morning punch gates are deferred — DashboardShell syncs them after load.
    const network = await evaluateNetworkAccess(req, result.user, {
      reportedPublicIp: safeReportedIp,
    }).catch((error) => {
      console.warn("[auth/login] network check failed, allowing temporary access:", error);
      return {
        allowed: true,
        reason: "restriction_disabled" as const,
        clientIp: safeReportedIp ?? "",
      };
    });

    schedulePostLoginGates(result.user);

    const token = encodeSession({ ...result.user, loggedInAt: Date.now() });
    const res = NextResponse.json({
      ok: true,
      user: result.user,
      // Provisional: real values are set by /api/auth/absence-gate after navigation.
      requiresAbsenceExplanation: false,
      requiresMorningPunch: false,
      requiresSiteGate: false,
      networkAllowed: network.allowed,
      networkReason: network.reason,
      clientIp: network.clientIp,
      gatesDeferred: true,
    });
    res.cookies.set(COOKIE, token, sessionCookieOptionsForRole(result.user.role));
    // Clear punch-desk gate cookies so middleware does not block on stale values.
    // DashboardShell + /api/auth/absence-gate refresh them right after load.
    setAbsenceGateCookie(res, false);
    setMorningPunchGateCookie(res, false);
    setNetworkGateCookie(res, network.allowed, network.clientIp);
    return res;
  } catch (error) {
    console.error("[auth/login]", error);
    return NextResponse.json(
      {
        error: "Sign-in is temporarily unavailable. Please try again.",
      },
      { status: 500 },
    );
  }
}
