import { canManageEmployees } from "@/lib/auth/roles";
import { NETWORK_BLOCKED_PATH } from "@/lib/network-access/constants";
import { ipsMatch, resolveClientIp } from "@/lib/network-access/ip";
import {
  NETWORK_GATE_COOKIE,
  decodeNetworkGateCookie,
} from "@/lib/network-access/network-gate-cookie";
import {
  getNetworkAccessSettings,
  isCompanyWfhDay,
  isEmployeeRemoteExempt,
  listOfficeNetworks,
  listRemoteAccessEmployees,
} from "@/lib/network-access/repository";
import type { NetworkAccessDecision } from "@/lib/network-access/types";
import type { SessionUser } from "@/types/auth";
import type { NextRequest } from "next/server";

export { NETWORK_BLOCKED_PATH };

function readGateCookieIp(req: Request): string {
  try {
    if ("cookies" in req && typeof (req as NextRequest).cookies?.get === "function") {
      return (
        decodeNetworkGateCookie((req as NextRequest).cookies.get(NETWORK_GATE_COOKIE)?.value)?.ip ??
        ""
      );
    }
    const raw = req.headers.get("cookie") ?? "";
    const match = raw.match(new RegExp(`(?:^|;\\s*)${NETWORK_GATE_COOKIE}=([^;]*)`));
    if (!match?.[1]) return "";
    return decodeNetworkGateCookie(decodeURIComponent(match[1]))?.ip ?? "";
  } catch {
    return "";
  }
}

export async function evaluateNetworkAccess(
  req: Request,
  user: SessionUser | null,
  options?: { reportedPublicIp?: string | null },
): Promise<NetworkAccessDecision> {
  const clientIp = resolveClientIp(req, options?.reportedPublicIp, readGateCookieIp(req));

  if (!user) {
    return { allowed: false, reason: "unauthenticated", clientIp };
  }

  // HR / Super Admin always bypass so they can fix allowlists after IP changes.
  if (canManageEmployees(user.role)) {
    return { allowed: true, reason: "admin_bypass", clientIp };
  }

  try {
    // Settings first: when restriction is off, skip the other three reads.
    const settings = await getNetworkAccessSettings();
    if (!settings.restrictionEnabled) {
      return { allowed: true, reason: "restriction_disabled", clientIp };
    }

    const [remoteEmployees, networks, companyWfhToday] = await Promise.all([
      listRemoteAccessEmployees(),
      listOfficeNetworks(),
      isCompanyWfhDay(),
    ]);

    // Company-wide WFH day: every employee can punch from any network.
    if (companyWfhToday) {
      return { allowed: true, reason: "company_wfh_day", clientIp };
    }

    if (isEmployeeRemoteExempt(remoteEmployees, user.sheetRow, user.id)) {
      return { allowed: true, reason: "remote_exempt", clientIp };
    }

    if (networks.some((network) => ipsMatch(clientIp, network.ip))) {
      return { allowed: true, reason: "office_ip", clientIp };
    }

    console.info("[network-access] blocked", {
      userId: user.id,
      role: user.role,
      clientIp,
      allowedIps: networks.map((n) => n.ip),
    });
    return { allowed: false, reason: "blocked", clientIp };
  } catch (error) {
    console.error("[network-access] evaluation failed:", error);
    // Fail closed for non-admins when the check cannot be completed.
    return { allowed: false, reason: "blocked", clientIp };
  }
}
