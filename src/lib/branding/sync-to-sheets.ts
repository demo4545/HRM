import { sheets } from "@/lib/google/auth";
import { applySheetHeaderFormatByTitle } from "@/lib/google/sheet-format";

import { getCompanyBranding } from "./repository";
import type { CompanyBranding } from "./types";

const BRANDING_SHEET = "Company Branding";
const BRANDING_RANGE = `'${BRANDING_SHEET}'`;
const BRANDING_HEADERS = ["key", "value"] as const;

const BRANDING_ROWS: ReadonlyArray<{
  key: string;
  value: (branding: CompanyBranding) => string;
}> = [
  { key: "company_name", value: (b) => b.companyName },
  { key: "company_address", value: (b) => b.companyAddress },
  { key: "signatory_name", value: (b) => b.signatoryName },
  { key: "hr_title", value: (b) => b.hrTitle },
  { key: "support_email", value: (b) => b.supportEmail },
  { key: "website_url", value: (b) => b.websiteUrl },
  { key: "has_logo", value: (b) => (b.hasLogo ? "true" : "false") },
  { key: "has_background", value: (b) => (b.hasBackground ? "true" : "false") },
  { key: "updated_at", value: (b) => b.updatedAt },
  { key: "updated_by", value: (b) => b.updatedBy },
];

let sheetReady = false;
let sheetRequest: Promise<void> | null = null;

async function ensureBrandingSheet(): Promise<void> {
  if (sheetReady) return;
  if (sheetRequest) return sheetRequest;

  const spreadsheetId = process.env.GOOGLE_SHEET_ID?.trim();
  if (!spreadsheetId) {
    throw new Error("GOOGLE_SHEET_ID is not configured");
  }

  sheetRequest = (async () => {
    const metadata = await sheets.spreadsheets.get({
      spreadsheetId,
      fields: "sheets.properties",
    });
    const exists = metadata.data.sheets?.some(
      (sheet) => sheet.properties?.title === BRANDING_SHEET,
    );

    if (!exists) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [{ addSheet: { properties: { title: BRANDING_SHEET } } }],
        },
      });
    }

    const headerResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${BRANDING_RANGE}!1:1`,
    });
    const headerRow = (headerResponse.data.values?.[0] as string[] | undefined) ?? [];
    const headersMatch = BRANDING_HEADERS.every(
      (header, index) => String(headerRow[index] ?? "").trim() === header,
    );

    if (!headersMatch) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${BRANDING_RANGE}!A1`,
        valueInputOption: "RAW",
        requestBody: { values: [[...BRANDING_HEADERS]] },
      });
      await applySheetHeaderFormatByTitle(spreadsheetId, BRANDING_SHEET, BRANDING_HEADERS.length);
    }

    sheetReady = true;
  })().finally(() => {
    sheetRequest = null;
  });

  return sheetRequest;
}

export type SyncCompanyBrandingToSheetsResult = {
  updated: boolean;
  skipped?: boolean;
  reason?: string;
  updatedAt?: string;
};

/** Mirror Firebase company branding into the main Google Sheet (key/value rows). */
export async function syncCompanyBrandingToSheets(): Promise<SyncCompanyBrandingToSheetsResult> {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID?.trim();
  if (!spreadsheetId) {
    return { updated: false, skipped: true, reason: "missing_google_sheet_id" };
  }

  const branding = await getCompanyBranding();
  await ensureBrandingSheet();

  const values = BRANDING_ROWS.map(({ key, value }) => [key, value(branding)]);

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${BRANDING_RANGE}!A2:B${values.length + 1}`,
    valueInputOption: "RAW",
    requestBody: { values },
  });

  return { updated: true, updatedAt: branding.updatedAt || undefined };
}
