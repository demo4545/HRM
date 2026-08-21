import { NextResponse } from "next/server";

import { getBrandingAssetBytes } from "@/lib/branding";
import { toApiErrorMessage } from "@/lib/api/user-facing-error";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Public company logo stream for favicon (no auth). */
export async function GET() {
  try {
    const asset = await getBrandingAssetBytes("logo");
    if (!asset) {
      return NextResponse.json({ success: false, message: "Logo not set" }, { status: 404 });
    }

    return new NextResponse(new Uint8Array(asset.buffer), {
      status: 200,
      headers: {
        "Content-Type": asset.mimeType,
        "Cache-Control": "public, max-age=300",
      },
    });
  } catch (error) {
    console.error("GET Public Branding Logo Error:", error);
    return NextResponse.json(
      {
        success: false,
        message: toApiErrorMessage(error, "Failed to load logo"),
      },
      { status: 500 },
    );
  }
}
