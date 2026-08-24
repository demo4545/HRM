import { getAdminFirestore } from "@/lib/firebase/admin";

import {
  BRANDING_ASSET_URLS,
  EMPTY_COMPANY_BRANDING,
  type BrandingAssetKind,
  type CompanyBranding,
  type CompanyBrandingUpdate,
} from "./types";

const COLLECTION = "app_settings";
const DOC = "branding";
const LOGO_DOC = "branding_logo";
const BACKGROUND_DOC = "branding_background";

const CACHE_TTL_MS = 15_000;

type CacheEntry<T> = { value: T; expiresAt: number };

let brandingCache: CacheEntry<CompanyBranding> | null = null;
let brandingInflight: Promise<CompanyBranding> | null = null;

function nowIso(): string {
  return new Date().toISOString();
}

function assetDocId(kind: BrandingAssetKind): string {
  return kind === "logo" ? LOGO_DOC : BACKGROUND_DOC;
}

function normalizeText(value: unknown): string {
  return String(value ?? "").trim();
}

function toPublicBranding(raw: Record<string, unknown>): CompanyBranding {
  const hasLogo = Boolean(raw.hasLogo);
  const hasBackground = Boolean(raw.hasBackground);
  const updatedAt = normalizeText(raw.updatedAt);
  const bust = updatedAt ? `?v=${encodeURIComponent(updatedAt)}` : "";
  return {
    companyName: normalizeText(raw.companyName),
    companyAddress: normalizeText(raw.companyAddress),
    signatoryName: normalizeText(raw.signatoryName) || EMPTY_COMPANY_BRANDING.signatoryName,
    hrTitle: normalizeText(raw.hrTitle) || EMPTY_COMPANY_BRANDING.hrTitle,
    supportEmail: normalizeText(raw.supportEmail),
    websiteUrl: normalizeText(raw.websiteUrl),
    hasLogo,
    hasBackground,
    logoUrl: hasLogo ? `/api/branding/public/logo${bust}` : null,
    backgroundUrl: hasBackground ? `${BRANDING_ASSET_URLS.background}${bust}` : null,
    updatedAt,
    updatedBy: normalizeText(raw.updatedBy),
  };
}

function scheduleCompanyBrandingSheetSync(): void {
  void import("./sync-to-sheets")
    .then(({ syncCompanyBrandingToSheets }) => syncCompanyBrandingToSheets())
    .catch((error) => {
      console.error("[sync-company-branding-to-sheets]", error);
    });
}

export function clearCompanyBrandingCache(): void {
  brandingCache = null;
  brandingInflight = null;
}

export async function getCompanyBranding(): Promise<CompanyBranding> {
  const now = Date.now();
  if (brandingCache && brandingCache.expiresAt > now) {
    return brandingCache.value;
  }
  if (brandingInflight) return brandingInflight;

  brandingInflight = (async () => {
    try {
      const snap = await getAdminFirestore().collection(COLLECTION).doc(DOC).get();
      const value = snap.exists
        ? toPublicBranding(snap.data() as Record<string, unknown>)
        : { ...EMPTY_COMPANY_BRANDING };
      brandingCache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
      return value;
    } finally {
      brandingInflight = null;
    }
  })();

  return brandingInflight;
}

export async function updateCompanyBranding(
  patch: CompanyBrandingUpdate,
  updatedBy: string,
): Promise<CompanyBranding> {
  const db = getAdminFirestore();
  const ref = db.collection(COLLECTION).doc(DOC);
  const existing = await getCompanyBranding();

  const next = {
    companyName:
      patch.companyName !== undefined ? normalizeText(patch.companyName) : existing.companyName,
    companyAddress:
      patch.companyAddress !== undefined
        ? normalizeText(patch.companyAddress)
        : existing.companyAddress,
    signatoryName:
      patch.signatoryName !== undefined
        ? normalizeText(patch.signatoryName) || EMPTY_COMPANY_BRANDING.signatoryName
        : existing.signatoryName,
    hrTitle:
      patch.hrTitle !== undefined
        ? normalizeText(patch.hrTitle) || EMPTY_COMPANY_BRANDING.hrTitle
        : existing.hrTitle,
    supportEmail:
      patch.supportEmail !== undefined ? normalizeText(patch.supportEmail) : existing.supportEmail,
    websiteUrl:
      patch.websiteUrl !== undefined ? normalizeText(patch.websiteUrl) : existing.websiteUrl,
    hasLogo: existing.hasLogo,
    hasBackground: existing.hasBackground,
    updatedAt: nowIso(),
    updatedBy: normalizeText(updatedBy),
  };

  await ref.set(next, { merge: true });
  clearCompanyBrandingCache();
  scheduleCompanyBrandingSheetSync();
  return getCompanyBranding();
}

export async function saveBrandingAsset(
  kind: BrandingAssetKind,
  buffer: Buffer,
  mimeType: string,
  updatedBy: string,
): Promise<CompanyBranding> {
  const db = getAdminFirestore();
  const batch = db.batch();
  batch.set(db.collection(COLLECTION).doc(assetDocId(kind)), {
    data: buffer.toString("base64"),
    mimeType,
    updatedAt: nowIso(),
    updatedBy: normalizeText(updatedBy),
  });
  batch.set(
    db.collection(COLLECTION).doc(DOC),
    {
      [kind === "logo" ? "hasLogo" : "hasBackground"]: true,
      updatedAt: nowIso(),
      updatedBy: normalizeText(updatedBy),
    },
    { merge: true },
  );
  await batch.commit();
  clearCompanyBrandingCache();
  scheduleCompanyBrandingSheetSync();
  return getCompanyBranding();
}

export async function clearBrandingAsset(
  kind: BrandingAssetKind,
  updatedBy: string,
): Promise<CompanyBranding> {
  const db = getAdminFirestore();
  const batch = db.batch();
  batch.delete(db.collection(COLLECTION).doc(assetDocId(kind)));
  batch.set(
    db.collection(COLLECTION).doc(DOC),
    {
      [kind === "logo" ? "hasLogo" : "hasBackground"]: false,
      updatedAt: nowIso(),
      updatedBy: normalizeText(updatedBy),
    },
    { merge: true },
  );
  await batch.commit();
  clearCompanyBrandingCache();
  scheduleCompanyBrandingSheetSync();
  return getCompanyBranding();
}

export async function getBrandingAssetBytes(
  kind: BrandingAssetKind,
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  const snap = await getAdminFirestore().collection(COLLECTION).doc(assetDocId(kind)).get();
  if (!snap.exists) return null;
  const data = snap.data() as { data?: string; mimeType?: string };
  const b64 = String(data.data ?? "").trim();
  if (!b64) return null;
  return {
    buffer: Buffer.from(b64, "base64"),
    mimeType: String(data.mimeType ?? "image/png").trim() || "image/png",
  };
}
