import { NextResponse } from "next/server";

import { getCompanyBranding } from "@/lib/branding";
import { toApiErrorMessage } from "@/lib/api/user-facing-error";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Public branding snapshot for browser tab title / favicon (no auth).
 * Exposes only non-sensitive display fields.
 */
export async function GET() {
  try {
    const branding = await getCompanyBranding();
    const bust = branding.updatedAt ? `?v=${encodeURIComponent(branding.updatedAt)}` : "";
    return NextResponse.json({
      success: true,
      branding: {
        companyName: branding.companyName,
        hasLogo: branding.hasLogo,
        logoUrl: branding.hasLogo ? `/api/branding/public/logo${bust}` : null,
        updatedAt: branding.updatedAt,
      },
    });
  } catch (error) {
    console.error("GET Public Branding Error:", error);
    return NextResponse.json(
      {
        success: false,
        message: toApiErrorMessage(error, "Failed to load branding"),
      },
      { status: 500 },
    );
  }
}
