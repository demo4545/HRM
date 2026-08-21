import { NextRequest } from "next/server";

import { parseFaviconScheme, renderSchemeFavicon } from "@/lib/branding/tab-favicon";

export const dynamic = "force-dynamic";
/** Sharp logo processing requires the Node.js runtime on Vercel. */
export const runtime = "nodejs";

/**
 * Dual-theme tab favicon.
 *   /api/branding/public/favicon?scheme=light  → original logo
 *   /api/branding/public/favicon?scheme=dark   → inverted (light) logo
 */
export async function GET(req: NextRequest) {
  try {
    const scheme = parseFaviconScheme(req.nextUrl.searchParams.get("scheme"));
    return await renderSchemeFavicon(scheme);
  } catch (error) {
    console.error("GET Public Branding Favicon Error:", error);
    return new Response(null, { status: 204 });
  }
}
