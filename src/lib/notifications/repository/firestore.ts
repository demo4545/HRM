import { randomUUID } from "node:crypto";

import { getAdminFirestore } from "@/lib/firebase/admin";
import { sheets } from "@/lib/google/auth";
import { NOTIFICATIONS_SHEET_NAME } from "@/lib/notifications/types";

import {
  effectiveNotificationExpiresAt,
  isNotificationExpired,
  notificationTodayIso,
  rowToNotificationRecord,
} from "../record-utils";
import type { CreateNotificationInput } from "../sheets";
import type { NotificationDto, NotificationRecord } from "../types";

const COLLECTION = "notifications";
const META_DOC = "meta";

let bootstrapPromise: Promise<void> | null = null;

async function ensureNotificationsBootstrapped(): Promise<void> {
  if (bootstrapPromise) return bootstrapPromise;

  bootstrapPromise = (async () => {
    const db = getAdminFirestore();
    const metaSnap = await db.collection(COLLECTION).doc(META_DOC).get();
    if (metaSnap.exists) return;

    const spreadsheetId = process.env.GOOGLE_SHEET_ID;
    if (!spreadsheetId) {
      await db.collection(COLLECTION).doc(META_DOC).set({ bootstrapped: true, source: "empty" });
      return;
    }

    try {
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${NOTIFICATIONS_SHEET_NAME}!A2:K10000`,
      });
      const rows = (response.data.values as string[][]) ?? [];
      if (rows.length === 0) {
        await db.collection(COLLECTION).doc(META_DOC).set({ bootstrapped: true, source: "empty" });
        return;
      }

      const batch = db.batch();
      batch.set(db.collection(COLLECTION).doc(META_DOC), { bootstrapped: true, source: "sheets" });

      for (const row of rows) {
        const record = rowToNotificationRecord(row);
        if (!record) continue;
        batch.set(db.collection(COLLECTION).doc(record.id), { ...record });
      }

      await batch.commit();
      console.info("[firebase] bootstrapped notifications from Google Sheets");
    } catch (error) {
      console.error("[firebase] notifications bootstrap failed:", error);
      await db.collection(COLLECTION).doc(META_DOC).set({ bootstrapped: true, source: "failed" });
    }
  })().finally(() => {
    bootstrapPromise = null;
  });

  return bootstrapPromise;
}

async function listRecordsForRecipient(recipientSheetRow: number): Promise<NotificationRecord[]> {
  await ensureNotificationsBootstrapped();
  const snap = await getAdminFirestore()
    .collection(COLLECTION)
    .where("recipientSheetRow", "==", recipientSheetRow)
    .get();

  return snap.docs
    .filter((doc) => doc.id !== META_DOC)
    .map((doc) => doc.data() as NotificationRecord);
}

async function deleteExpiredRecords(records: NotificationRecord[]): Promise<void> {
  const todayIso = notificationTodayIso();
  const expired = records.filter((record) => isNotificationExpired(record, todayIso));
  if (expired.length === 0) return;

  const db = getAdminFirestore();
  const batch = db.batch();
  for (const record of expired) {
    batch.delete(db.collection(COLLECTION).doc(record.id));
  }
  await batch.commit();
}

function nowIso(): string {
  return new Date().toISOString();
}

async function hasExistingDedupe(params: {
  recipientSheetRow: number;
  dedupeKey: string;
}): Promise<boolean> {
  const snap = await getAdminFirestore()
    .collection(COLLECTION)
    .where("recipientSheetRow", "==", params.recipientSheetRow)
    .where("dedupeKey", "==", params.dedupeKey)
    .limit(1)
    .get();
  return !snap.empty;
}

export async function createNotificationFirestore(
  input: CreateNotificationInput,
): Promise<NotificationRecord | null> {
  await ensureNotificationsBootstrapped();

  const dedupeKey = String(input.dedupeKey ?? "").trim();
  if (dedupeKey) {
    const exists = await hasExistingDedupe({
      recipientSheetRow: input.recipientSheetRow,
      dedupeKey,
    });
    if (exists) return null;
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

  await getAdminFirestore().collection(COLLECTION).doc(record.id).set(record);
  return record;
}

export async function createNotificationsFirestore(
  inputs: CreateNotificationInput[],
): Promise<number> {
  if (inputs.length === 0) return 0;

  await ensureNotificationsBootstrapped();
  const existingKeys = new Set<string>();

  if (inputs.some((input) => String(input.dedupeKey ?? "").trim())) {
    const recipientRows = [
      ...new Set(
        inputs.map((input) => input.recipientSheetRow).filter((row) => Number.isFinite(row)),
      ),
    ];
    for (const recipientSheetRow of recipientRows) {
      const existing = await listRecordsForRecipient(recipientSheetRow);
      for (const record of existing) {
        if (!record.dedupeKey) continue;
        existingKeys.add(`${record.recipientSheetRow}:${record.dedupeKey}`);
      }
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

  const db = getAdminFirestore();
  const batch = db.batch();
  for (const record of records) {
    batch.set(db.collection(COLLECTION).doc(record.id), record);
  }
  await batch.commit();

  return records.length;
}

export async function listNotificationsForRecipientFirestore(
  recipientSheetRow: number,
): Promise<NotificationDto[]> {
  const records = await listRecordsForRecipient(recipientSheetRow);
  await deleteExpiredRecords(records);

  const fresh = records.filter((record) => !isNotificationExpired(record, notificationTodayIso()));
  const notifications: NotificationDto[] = [];

  for (const record of fresh) {
    notifications.push({
      ...record,
      expiresAt: effectiveNotificationExpiresAt(record),
      sheetRow: 0,
    });
  }

  return notifications.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

export async function markNotificationReadFirestore(params: {
  notificationId: string;
  recipientSheetRow: number;
}): Promise<boolean> {
  const docRef = getAdminFirestore().collection(COLLECTION).doc(params.notificationId);
  const snap = await docRef.get();
  if (!snap.exists) return false;

  const record = snap.data() as NotificationRecord;
  if (record.recipientSheetRow !== params.recipientSheetRow) return false;

  await docRef.set({ ...record, read: true }, { merge: true });
  return true;
}

export async function countUnreadNotificationsFirestore(
  recipientSheetRow: number,
): Promise<number> {
  const notifications = await listNotificationsForRecipientFirestore(recipientSheetRow);
  return notifications.filter((n) => !n.read).length;
}

/** Update title/body for all notifications whose dedupeKey starts with the prefix. */
export async function updateNotificationsByDedupePrefixFirestore(params: {
  dedupePrefix: string;
  title: string;
  body: string;
  markUnread?: boolean;
}): Promise<number> {
  const prefix = params.dedupePrefix.trim();
  if (!prefix) return 0;

  await ensureNotificationsBootstrapped();
  const snap = await getAdminFirestore()
    .collection(COLLECTION)
    .where("dedupeKey", ">=", prefix)
    .where("dedupeKey", "<", `${prefix}\uf8ff`)
    .get();

  if (snap.empty) return 0;

  const db = getAdminFirestore();
  const batch = db.batch();
  let updated = 0;
  for (const doc of snap.docs) {
    if (doc.id === META_DOC) continue;
    const record = doc.data() as NotificationRecord;
    if (!String(record.dedupeKey ?? "").startsWith(prefix)) continue;
    batch.set(
      doc.ref,
      {
        ...record,
        title: params.title,
        body: params.body,
        read: params.markUnread === false ? record.read : false,
      },
      { merge: true },
    );
    updated += 1;
  }
  if (updated === 0) return 0;
  await batch.commit();
  return updated;
}

/** Delete all notifications whose dedupeKey starts with the prefix. */
export async function deleteNotificationsByDedupePrefixFirestore(
  dedupePrefix: string,
): Promise<number> {
  const prefix = dedupePrefix.trim();
  if (!prefix) return 0;

  await ensureNotificationsBootstrapped();
  const snap = await getAdminFirestore()
    .collection(COLLECTION)
    .where("dedupeKey", ">=", prefix)
    .where("dedupeKey", "<", `${prefix}\uf8ff`)
    .get();

  if (snap.empty) return 0;

  const db = getAdminFirestore();
  const batch = db.batch();
  let deleted = 0;
  for (const doc of snap.docs) {
    if (doc.id === META_DOC) continue;
    const record = doc.data() as NotificationRecord;
    if (!String(record.dedupeKey ?? "").startsWith(prefix)) continue;
    batch.delete(doc.ref);
    deleted += 1;
  }
  if (deleted === 0) return 0;
  await batch.commit();
  return deleted;
}
