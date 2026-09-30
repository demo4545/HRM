import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { toApiErrorMessage } from "@/lib/api/user-facing-error";
import { primeServerHotPath } from "@/lib/warmup/prime";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

function isLocalhostRequest(req: NextRequest): boolean {
  const host = req.headers.get("host") ?? "";
  return host.includes("localhost") || host.includes("127.0.0.1");
}

function isAuthorized(req: NextRequest): boolean {
  if (isLocalhostRequest(req)) return true;

  const cronSecret = process.env.CRON_SECRET?.trim();
  const authHeader = req.headers.get("authorization")?.trim() ?? "";
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) return true;

  const headerSecret = req.headers.get("x-cron-secret")?.trim() ?? "";
  if (cronSecret && headerSecret === cronSecret) return true;

  // Vercel Cron injects Authorization when CRON_SECRET is set; without it,
  // accept the platform user-agent only (same pattern as attendance sync).
  const userAgent = req.headers.get("user-agent") ?? "";
  if (/vercel.*cron/i.test(userAgent) && !cronSecret) return true;

  return false;
}

/**
 * Cheap keep-alive (2 Firestore reads, 0 writes).
 * Vercel Hobby cannot run frequent crons — call from UptimeRobot (or similar)
 * only around rush windows, e.g. every 10–15 min during IST 09:15–10:30,
 * 12:45–13:30, and 18:45–19:30.
 */
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await primeServerHotPath();
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("[cron/warmup]", error);
    return NextResponse.json(
      {
        success: false,
        message: toApiErrorMessage(error, "Warmup failed"),
      },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  return GET(req);
}
