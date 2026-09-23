import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { canManageEmployees } from "@/lib/auth/roles";
import { evaluateNetworkAccess } from "@/lib/network-access/gate";
import { setNetworkGateCookie } from "@/lib/network-access/network-gate-cookie";
import type { SessionUser } from "@/types/auth";

export const NETWORK_RESTRICTED_MESSAGE = "Access is limited to the office Wi‑Fi network.";

export function networkRestrictedResponse() {
  return NextResponse.json(
    {
      success: false,
      message: NETWORK_RESTRICTED_MESSAGE,
      code: "NETWORK_RESTRICTED",
    },
    { status: 403 },
  );
}

export type NetworkAccessOk = {
  ok: true;
  /** When set, attach to the API response so middleware trusts the next requests. */
  gate?: { allowed: boolean; clientIp: string };
};

/**
 * Enforce office-network restriction for API handlers (Node runtime).
 * HR / Super Admin always pass.
 */
export async function assertNetworkAccess(
  req: Request | NextRequest,
  user: SessionUser,
): Promise<NetworkAccessOk | { ok: false; response: NextResponse }> {
  if (canManageEmployees(user.role)) {
    return { ok: true };
  }

  const decision = await evaluateNetworkAccess(req, user);
  if (decision.allowed) {
    return { ok: true, gate: { allowed: true, clientIp: decision.clientIp } };
  }

  const response = networkRestrictedResponse();
  setNetworkGateCookie(response, false, decision.clientIp);
  return { ok: false, response };
}

/** Apply a refreshed network-gate cookie onto a successful API response. */
export function applyNetworkGateCookie(
  response: Response,
  gate: { allowed: boolean; clientIp: string } | undefined,
): Response {
  if (!gate) return response;
  const next =
    response instanceof NextResponse
      ? response
      : new NextResponse(response.body, response);
  setNetworkGateCookie(next, gate.allowed, gate.clientIp);
  return next;
}
