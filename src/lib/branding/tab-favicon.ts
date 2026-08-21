import { getBrandingAssetBytes, getCompanyBranding } from "@/lib/branding";

export type FaviconScheme = "light" | "dark";

const SIZE = 64;
/** Logo drawn smaller than the canvas so the tab mark has breathing room. */
const LOGO_SIZE = 60;

/** 1×1 transparent PNG — avoids Sharp when no logo is configured. */
const EMPTY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5X2ZkAAAAASUVORK5CYII=",
  "base64",
);

/**
 * Tab favicon: company logo only (same rule as /login).
 * No letter / "H" fallback — empty transparent mark when logo is unset.
 * Light chrome → original logo; dark chrome → inverted logo when Sharp works.
 */
export async function renderSchemeFavicon(scheme: FaviconScheme): Promise<Response> {
  try {
    const branding = await getCompanyBranding().catch(() => null);
    const asset = branding?.hasLogo ? await getBrandingAssetBytes("logo").catch(() => null) : null;

    if (asset?.buffer?.length) {
      try {
        return await renderLogoFavicon(scheme, asset.buffer);
      } catch (error) {
        console.error("Favicon logo render failed; serving original logo bytes:", error);
        return pngOrImageResponse(asset.buffer, asset.mimeType || "image/png");
      }
    }

    return pngOrImageResponse(EMPTY_PNG, "image/png");
  } catch (error) {
    console.error("Favicon render failed:", error);
    return pngOrImageResponse(EMPTY_PNG, "image/png");
  }
}

async function renderLogoFavicon(scheme: FaviconScheme, buffer: Buffer): Promise<Response> {
  // Dynamic import so a missing/broken Sharp binary does not crash the route module.
  const sharp = (await import("sharp")).default;

  let logo = sharp(buffer).resize(LOGO_SIZE, LOGO_SIZE, {
    fit: "contain",
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  });

  if (scheme === "dark") {
    logo = logo.negate({ alpha: false });
  }

  const logoPng = await logo.png().toBuffer();
  const offset = Math.round((SIZE - LOGO_SIZE) / 2);
  const png = await sharp({
    create: {
      width: SIZE,
      height: SIZE,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: logoPng, left: offset, top: offset }])
    .png()
    .toBuffer();

  return pngOrImageResponse(png, "image/png");
}

function pngOrImageResponse(buffer: Buffer, contentType: string): Response {
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=60",
    },
  });
}

export function parseFaviconScheme(raw: string | null): FaviconScheme {
  return raw === "dark" ? "dark" : "light";
}
