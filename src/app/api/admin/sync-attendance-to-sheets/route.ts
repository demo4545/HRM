import { NextResponse } from "next/server";

import { processForgottenPunchOuts } from "@/lib/attendance/auto-punch-out";
import { syncAttendanceToSheets } from "@/lib/attendance/sync-attendance-to-sheets";
import { syncCompanyBrandingToSheets } from "@/lib/branding/sync-to-sheets";

export const dynamic = "force-dynamic";
/** Allow enough time for per-employee Sheets writes (throttled). */
export const maxDuration = 300;

function isLocalhostRequest(req: Request): boolean {
  const host = req.headers.get("host") ?? "";
  return host.includes("localhost") || host.includes("127.0.0.1");
}

function isAuthorized(req: Request): boolean {
  if (isLocalhostRequest(req)) return true;

  const cronSecret = process.env.CRON_SECRET?.trim();
  const authHeader = req.headers.get("authorization")?.trim() ?? "";
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) return true;

  const headerCronSecret = req.headers.get("x-cron-secret")?.trim() ?? "";
  if (cronSecret && headerCronSecret === cronSecret) return true;

  const expected = process.env.ATTENDANCE_SYNC_TOKEN?.trim();
  const url = new URL(req.url);
  const token = req.headers.get("x-sync-token") ?? url.searchParams.get("token") ?? undefined;
  if (expected && token === expected) return true;

  const userAgent = req.headers.get("user-agent") ?? "";
  const isVercelCron = /vercel.*cron/i.test(userAgent);
  if (isVercelCron && !cronSecret && !expected) return true;

  return false;
}

export async function POST(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(req.url);
    const body = (await req.json().catch(() => ({}))) as { fromIso?: string; toIso?: string };

    const forgottenPunchOuts = await processForgottenPunchOuts();
    const [attendance, branding] = await Promise.all([
      syncAttendanceToSheets({
        fromIso: body.fromIso ?? url.searchParams.get("from") ?? undefined,
        toIso: body.toIso ?? url.searchParams.get("to") ?? undefined,
      }),
      syncCompanyBrandingToSheets(),
    ]);

    return NextResponse.json({
      success: true,
      forgottenPunchOuts,
      attendance,
      branding,
    });
  } catch (error) {
    console.error("[sync-attendance-to-sheets]", error);
    return NextResponse.json(
      { success: false, message: "Sync failed. Check server logs." },
      { status: 500 },
    );
  }
}

// Vercel Cron typically performs a GET request.
export async function GET(req: Request) {
  return POST(req);
}
