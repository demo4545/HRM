import { randomUUID } from "node:crypto";

import { sheets } from "@/lib/google/auth";
import { applySheetHeaderFormatByTitle } from "@/lib/google/sheet-format";
import { addDaysToDateIso, notificationDateIso } from "@/lib/notifications/automation-date";

import {
  NOTIFICATIONS_SHEET_NAME,
  type NotificationDto,
  type NotificationRecord,
  type NotificationType,
} from "./types";

const spreadsheetId = process.env.GOOGLE_SHEET_ID as string;

const NOTIFICATION_HEADERS = [
  "id",
  "recipientSheetRow",
  "recipientEmployeeId",
  "type",
  "title",
  "body",
  "href",
  "read",
  "createdAt",
  "dedupeKey",
  "expiresAt",
] as const;

function nowIso(): string {
  return new Date().toISOString();
}

function columnIndexToLetter(columnCount: number): string {
  let letter = "";
  let n = Math.max(1, columnCount);

  while (n > 0) {
    const remainder = (n - 1) % 26;
    letter = String.fromCharCode(65 + remainder) + letter;
    n = Math.floor((n - 1) / 26);
  }

  return letter;
}

function sheetRowRange(row: number, colCount: number): string {
  const end = columnIndexToLetter(colCount);
  return `${NOTIFICATIONS_SHEET_NAME}!A${row}:${end}${row}`;
}

async function getSheetMeta() {
  const response = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties",
  });
  return response.data.sheets ?? [];
}

async function ensureSheetExists(title: string): Promise<void> {
  const all = await getSheetMeta();
  const exists = all.some((s) => s.properties?.title === title);
  if (exists) return;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{ addSheet: { properties: { title } } }],
    },
  });
}

let headersReady = false;
let headersRequest: Promise<void> | null = null;

async function ensureHeaders(): Promise<void> {
  if (headersReady) return;
  if (headersRequest) return headersRequest;

  headersRequest = (async () => {
    await ensureSheetExists(NOTIFICATIONS_SHEET_NAME);
    const range = `${NOTIFICATIONS_SHEET_NAME}!1:1`;
    const current = await sheets.spreadsheets.values.get({ spreadsheetId, range });
    const headerRow = (current.data.values?.[0] as string[] | undefined) ?? [];
    const same =
      headerRow.length >= NOTIFICATION_HEADERS.length &&
      NOTIFICATION_HEADERS.every((h, i) => String(headerRow[i] ?? "").trim() === h);

    if (!same) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${NOTIFICATIONS_SHEET_NAME}!A1`,
        valueInputOption: "RAW",
        requestBody: { values: [[...NOTIFICATION_HEADERS]] },
      });

      await applySheetHeaderFormatByTitle(
        spreadsheetId,
        NOTIFICATIONS_SHEET_NAME,
        NOTIFICATION_HEADERS.length,
      );
    }

    headersReady = true;
  })().finally(() => {
    headersRequest = null;
  });

  return headersRequest;
}

async function readNotificationRows(): Promise<string[][]> {
  await ensureHeaders();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${NOTIFICATIONS_SHEET_NAME}!A2:K10000`,
  });
  return (response.data.values as string[][]) ?? [];
}

function rowToRecord(row: string[]): NotificationRecord | null {
  const id = String(row[0] ?? "").trim();
  if (!id) return null;

  const recipientSheetRow = Number(row[1]);
  if (!Number.isFinite(recipientSheetRow) || recipientSheetRow < 2) return null;

  return {
    id,
    recipientSheetRow,
    recipientEmployeeId: String(row[2] ?? "").trim(),
    type: String(row[3] ?? "").trim() as NotificationType,
    title: String(row[4] ?? "").trim(),
    body: String(row[5] ?? "").trim(),
    href: String(row[6] ?? "").trim(),
    read:
      String(row[7] ?? "")
        .trim()
        .toLowerCase() === "true",
    createdAt: String(row[8] ?? "").trim(),
    dedupeKey: String(row[9] ?? "").trim(),
    expiresAt: String(row[10] ?? "").trim(),
  };
}

function dateFromDayMonthYear(value: string): string {
  const match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return "";
  return `${match[3]}-${String(Number(match[2])).padStart(2, "0")}-${String(
    Number(match[1]),
  ).padStart(2, "0")}`;
}

function effectiveExpiresAt(record: NotificationRecord): string {
  if (record.expiresAt) return record.expiresAt;

  if (record.type === "employee_birthday") {
    const birthdayDate = record.dedupeKey.match(/:(\d{4}-\d{2}-\d{2}):/)?.[1] ?? "";
    return birthdayDate ? addDaysToDateIso(birthdayDate, 1) : "";
  }

  if (record.type === "employee_increment_upcoming") {
    const incrementDate = record.dedupeKey.match(/:(\d{4}-\d{2}-\d{2}):/)?.[1] ?? "";
    return incrementDate ? addDaysToDateIso(incrementDate, 1) : "";
  }

  if (
    record.type === "leave_submitted" ||
    record.type === "leave_submitted_employee" ||
    record.type === "leave_approved" ||
    record.type === "leave_rejected" ||
    record.type === "leave_upcoming"
  ) {
    const dates = record.body.match(/\d{1,2}\/\d{1,2}\/\d{4}/g) ?? [];
    const endDate = dateFromDayMonthYear(dates.at(-1) ?? "");
    return endDate ? addDaysToDateIso(endDate, 1) : "";
  }

  if (record.type === "expense_payment_due") {
    const reminderDate = record.dedupeKey.match(/:(\d{4}-\d{2}-\d{2}):/)?.[1] ?? "";
    return reminderDate ? addDaysToDateIso(reminderDate, 1) : "";
  }

  return "";
}

function isExpired(record: NotificationRecord, todayIso: string): boolean {
  const expiresAt = effectiveExpiresAt(record);
  return Boolean(expiresAt && expiresAt <= todayIso);
}

async function clearExpiredNotificationRows(
  rows: string[][],
  todayIso: string,
): Promise<Set<number>> {
  const expiredRows = new Set<number>();

  for (let index = 0; index < rows.length; index++) {
    const record = rowToRecord(rows[index] ?? []);
    if (record && isExpired(record, todayIso)) {
      expiredRows.add(index + 2);
    }
  }

  if (expiredRows.size > 0) {
    await sheets.spreadsheets.values.batchClear({
      spreadsheetId,
      requestBody: {
        ranges: [...expiredRows].map(
          (sheetRow) => `${NOTIFICATIONS_SHEET_NAME}!A${sheetRow}:K${sheetRow}`,
        ),
      },
    });
  }

  return expiredRows;
}

function recordToRow(record: NotificationRecord): string[] {
  return [
    record.id,
    String(record.recipientSheetRow),
    record.recipientEmployeeId,
    record.type,
    record.title,
    record.body,
    record.href,
    record.read ? "true" : "false",
    record.createdAt,
    record.dedupeKey,
    record.expiresAt,
  ];
}

export type CreateNotificationInput = {
  recipientSheetRow: number;
  recipientEmployeeId: string;
  type: NotificationType;
  title: string;
  body: string;
  href?: string;
  dedupeKey?: string;
  expiresAt?: string;
};

export async function createNotification(
  input: CreateNotificationInput,
): Promise<NotificationRecord | null> {
  await ensureHeaders();

  const dedupeKey = String(input.dedupeKey ?? "").trim();
  if (dedupeKey) {
    const existing = await readNotificationRows();
    for (let i = 0; i < existing.length; i++) {
      const record = rowToRecord(existing[i] ?? []);
      if (!record) continue;
      if (record.dedupeKey === dedupeKey && record.recipientSheetRow === input.recipientSheetRow) {
        return null;
      }
    }
  }

  const record: NotificationRecord = {
    id: randomUUID(),
    recipientSheetRow: input.recipientSheetRow,
    recipientEmployeeId: input.recipientEmployeeId,
    type: input.type,
    title: input.title,
    body: input.body,
    href: input.href ?? "",
    read: false,
    createdAt: nowIso(),
    dedupeKey,
    expiresAt: String(input.expiresAt ?? "").trim(),
  };

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${NOTIFICATIONS_SHEET_NAME}!A:K`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [recordToRow(record)] },
  });

  return record;
}

export async function createNotifications(inputs: CreateNotificationInput[]): Promise<number> {
  if (inputs.length === 0) return 0;

  await ensureHeaders();
  const existingKeys = new Set<string>();
  if (inputs.some((input) => String(input.dedupeKey ?? "").trim())) {
    const existingRows = await readNotificationRows();
    for (const row of existingRows) {
      const record = rowToRecord(row);
      if (!record?.dedupeKey) continue;
      existingKeys.add(`${record.recipientSheetRow}:${record.dedupeKey}`);
    }
  }

  const records: NotificationRecord[] = [];
  for (const input of inputs) {
    const dedupeKey = String(input.dedupeKey ?? "").trim();
    const uniqueKey = `${input.recipientSheetRow}:${dedupeKey}`;
    if (dedupeKey && existingKeys.has(uniqueKey)) continue;

    records.push({
      id: randomUUID(),
      recipientSheetRow: input.recipientSheetRow,
      recipientEmployeeId: input.recipientEmployeeId,
      type: input.type,
      title: input.title,
      body: input.body,
      href: input.href ?? "",
      read: false,
      createdAt: nowIso(),
      dedupeKey,
      expiresAt: String(input.expiresAt ?? "").trim(),
    });
    if (dedupeKey) existingKeys.add(uniqueKey);
  }

  if (records.length === 0) return 0;

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${NOTIFICATIONS_SHEET_NAME}!A:K`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: records.map(recordToRow) },
  });

  return records.length;
}

export async function listNotificationsForRecipient(
  recipientSheetRow: number,
): Promise<NotificationDto[]> {
  const rows = await readNotificationRows();
  const expiredRows = await clearExpiredNotificationRows(rows, notificationDateIso());
  const notifications: NotificationDto[] = [];

  for (let i = 0; i < rows.length; i++) {
    if (expiredRows.has(i + 2)) continue;
    const record = rowToRecord(rows[i] ?? []);
    if (!record) continue;
    if (record.recipientSheetRow !== recipientSheetRow) continue;

    notifications.push({
      ...record,
      expiresAt: effectiveExpiresAt(record),
      sheetRow: i + 2,
    });
  }

  return notifications.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

export async function markNotificationRead(params: {
  notificationId: string;
  recipientSheetRow: number;
}): Promise<boolean> {
  const rows = await readNotificationRows();

  for (let i = 0; i < rows.length; i++) {
    const record = rowToRecord(rows[i] ?? []);
    if (!record) continue;
    if (record.id !== params.notificationId) continue;
    if (record.recipientSheetRow !== params.recipientSheetRow) continue;

    const sheetRow = i + 2;
    const updated: NotificationRecord = { ...record, read: true };

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: sheetRowRange(sheetRow, NOTIFICATION_HEADERS.length),
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [recordToRow(updated)] },
    });

    return true;
  }

  return false;
}

export async function countUnreadNotifications(recipientSheetRow: number): Promise<number> {
  const notifications = await listNotificationsForRecipient(recipientSheetRow);
  return notifications.filter((n) => !n.read).length;
}

export async function updateNotificationsByDedupePrefix(params: {
  dedupePrefix: string;
  title: string;
  body: string;
  markUnread?: boolean;
}): Promise<number> {
  const prefix = params.dedupePrefix.trim();
  if (!prefix) return 0;

  const rows = await readNotificationRows();
  const updates: Array<{ sheetRow: number; record: NotificationRecord }> = [];

  for (let i = 0; i < rows.length; i++) {
    const record = rowToRecord(rows[i] ?? []);
    if (!record?.dedupeKey?.startsWith(prefix)) continue;
    updates.push({
      sheetRow: i + 2,
      record: {
        ...record,
        title: params.title,
        body: params.body,
        read: params.markUnread === false ? record.read : false,
      },
    });
  }

  if (updates.length === 0) return 0;

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data: updates.map((entry) => ({
        range: sheetRowRange(entry.sheetRow, NOTIFICATION_HEADERS.length),
        values: [recordToRow(entry.record)],
      })),
    },
  });

  return updates.length;
}

export async function deleteNotificationsByDedupePrefix(dedupePrefix: string): Promise<number> {
  const prefix = dedupePrefix.trim();
  if (!prefix) return 0;

  const rows = await readNotificationRows();
  const sheetRows: number[] = [];

  for (let i = 0; i < rows.length; i++) {
    const record = rowToRecord(rows[i] ?? []);
    if (!record?.dedupeKey?.startsWith(prefix)) continue;
    sheetRows.push(i + 2);
  }

  if (sheetRows.length === 0) return 0;

  await sheets.spreadsheets.values.batchClear({
    spreadsheetId,
    requestBody: {
      ranges: sheetRows.map(
        (sheetRow) => `${NOTIFICATIONS_SHEET_NAME}!A${sheetRow}:K${sheetRow}`,
      ),
    },
  });

  return sheetRows.length;
}
