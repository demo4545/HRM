import { randomUUID } from "node:crypto";

import { localTodayIso } from "@/lib/attendance/manual-entry";
import { sheets } from "@/lib/google/auth";
import { applySheetHeaderFormatByTitle } from "@/lib/google/sheet-format";

export type AnnouncementCategory = "general" | "office_leave" | "important";

export type AnnouncementRecord = {
  id: string;
  title: string;
  message: string;
  category: AnnouncementCategory;
  authorSheetRow: number;
  authorName: string;
  recipientCount: number;
  createdAt: string;
  /** Inclusive end date (YYYY-MM-DD). Shown on dashboard through this day. */
  expiresAt: string;
};

const spreadsheetId = process.env.GOOGLE_SHEET_ID as string;
const SHEET_NAME = "Announcements";
const SHEET_RANGE = `'${SHEET_NAME}'`;
const HEADERS = [
  "id",
  "title",
  "message",
  "category",
  "authorSheetRow",
  "authorName",
  "recipientCount",
  "createdAt",
  "expiresAt",
] as const;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

let sheetReady = false;
let sheetRequest: Promise<void> | null = null;

async function ensureSheet(): Promise<void> {
  if (sheetReady) return;
  if (sheetRequest) return sheetRequest;

  sheetRequest = (async () => {
    const metadata = await sheets.spreadsheets.get({
      spreadsheetId,
      fields: "sheets.properties",
    });
    const exists = metadata.data.sheets?.some((sheet) => sheet.properties?.title === SHEET_NAME);

    if (!exists) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [{ addSheet: { properties: { title: SHEET_NAME } } }],
        },
      });
    }

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${SHEET_RANGE}!1:1`,
    });
    const current = (response.data.values?.[0] as string[] | undefined) ?? [];
    const matches = HEADERS.every(
      (header, index) => String(current[index] ?? "").trim() === header,
    );

    if (!matches) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${SHEET_RANGE}!A1`,
        valueInputOption: "RAW",
        requestBody: { values: [[...HEADERS]] },
      });
      await applySheetHeaderFormatByTitle(spreadsheetId, SHEET_NAME, HEADERS.length);
    }

    sheetReady = true;
  })().finally(() => {
    sheetRequest = null;
  });

  return sheetRequest;
}

function normalizeExpiresAt(value: string): string {
  const raw = value.trim().slice(0, 10);
  return ISO_DATE.test(raw) ? raw : "";
}

/** Visible on dashboard through the end of `expiresAt` (inclusive). */
export function isAnnouncementActive(
  expiresAt: string,
  today: string = localTodayIso(),
): boolean {
  const end = normalizeExpiresAt(expiresAt);
  if (!end) return false;
  return end >= today.slice(0, 10);
}

function rowToAnnouncement(row: string[]): AnnouncementRecord | null {
  const id = String(row[0] ?? "").trim();
  const title = String(row[1] ?? "").trim();
  const message = String(row[2] ?? "").trim();
  const category = String(row[3] ?? "").trim() as AnnouncementCategory;
  if (!id || !title || !message) return null;
  if (category !== "general" && category !== "office_leave" && category !== "important") {
    return null;
  }

  return {
    id,
    title,
    message,
    category,
    authorSheetRow: Number(row[4]) || 0,
    authorName: String(row[5] ?? "").trim(),
    recipientCount: Number(row[6]) || 0,
    createdAt: String(row[7] ?? "").trim(),
    expiresAt: normalizeExpiresAt(String(row[8] ?? "")),
  };
}

export async function listAnnouncements(options?: {
  activeOnly?: boolean;
}): Promise<AnnouncementRecord[]> {
  await ensureSheet();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_RANGE}!A2:I`,
  });

  const records = ((response.data.values as string[][] | undefined) ?? [])
    .map(rowToAnnouncement)
    .filter((record): record is AnnouncementRecord => Boolean(record))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  if (options?.activeOnly) {
    return records.filter((record) => isAnnouncementActive(record.expiresAt));
  }
  return records;
}

export async function createAnnouncement(input: {
  title: string;
  message: string;
  category: AnnouncementCategory;
  authorSheetRow: number;
  authorName: string;
  recipientCount: number;
  expiresAt: string;
}): Promise<AnnouncementRecord> {
  await ensureSheet();
  const expiresAt = normalizeExpiresAt(input.expiresAt);
  if (!expiresAt) {
    throw new Error("A valid expiry date (YYYY-MM-DD) is required");
  }

  const record: AnnouncementRecord = {
    id: randomUUID(),
    title: input.title,
    message: input.message,
    category: input.category,
    authorSheetRow: input.authorSheetRow,
    authorName: input.authorName,
    recipientCount: input.recipientCount,
    createdAt: new Date().toISOString(),
    expiresAt,
  };

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${SHEET_RANGE}!A:I`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [
        [
          record.id,
          record.title,
          record.message,
          record.category,
          record.authorSheetRow,
          record.authorName,
          record.recipientCount,
          record.createdAt,
          record.expiresAt,
        ],
      ],
    },
  });

  return record;
}

async function getAnnouncementsSheetId(): Promise<number> {
  const metadata = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties",
  });
  const sheet = metadata.data.sheets?.find((entry) => entry.properties?.title === SHEET_NAME);
  const sheetId = sheet?.properties?.sheetId;
  if (sheetId == null) {
    throw new Error(`Sheet "${SHEET_NAME}" not found`);
  }
  return sheetId;
}

/** 1-based sheet row for an announcement id, or null when missing. */
async function findAnnouncementSheetRow(id: string): Promise<{
  sheetRow: number;
  record: AnnouncementRecord;
} | null> {
  await ensureSheet();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_RANGE}!A2:I`,
  });
  const rows = (response.data.values as string[][] | undefined) ?? [];
  for (let index = 0; index < rows.length; index += 1) {
    const record = rowToAnnouncement(rows[index] ?? []);
    if (!record || record.id !== id) continue;
    return { sheetRow: index + 2, record };
  }
  return null;
}

export async function updateAnnouncement(
  id: string,
  input: {
    title: string;
    message: string;
    category: AnnouncementCategory;
    expiresAt: string;
  },
): Promise<AnnouncementRecord> {
  const found = await findAnnouncementSheetRow(id);
  if (!found) {
    throw new Error("Announcement not found");
  }

  const expiresAt = normalizeExpiresAt(input.expiresAt);
  if (!expiresAt) {
    throw new Error("A valid expiry date (YYYY-MM-DD) is required");
  }

  const updated: AnnouncementRecord = {
    ...found.record,
    title: input.title,
    message: input.message,
    category: input.category,
    expiresAt,
  };

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${SHEET_RANGE}!A${found.sheetRow}:I${found.sheetRow}`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [
        [
          updated.id,
          updated.title,
          updated.message,
          updated.category,
          updated.authorSheetRow,
          updated.authorName,
          updated.recipientCount,
          updated.createdAt,
          updated.expiresAt,
        ],
      ],
    },
  });

  return updated;
}

export async function deleteAnnouncement(id: string): Promise<boolean> {
  const found = await findAnnouncementSheetRow(id);
  if (!found) return false;

  const sheetId = await getAnnouncementsSheetId();
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId,
              dimension: "ROWS",
              startIndex: found.sheetRow - 1,
              endIndex: found.sheetRow,
            },
          },
        },
      ],
    },
  });

  return true;
}
