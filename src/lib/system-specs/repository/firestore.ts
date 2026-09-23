import { getAdminFirestore } from "@/lib/firebase/admin";
import {
  compactDeviceList,
  compactLoginList,
  normalizeDeviceList,
  normalizeLoginList,
  type SystemSpecsInput,
  type SystemSpecsRecord,
} from "@/lib/system-specs/types";

const COLLECTION = "system_specs";

function nowIso(): string {
  return new Date().toISOString();
}

function specsCollection() {
  return getAdminFirestore().collection(COLLECTION);
}

function docToRecord(id: string, data: Record<string, unknown>): SystemSpecsRecord | null {
  const employeeSheetRow = Number(data.employeeSheetRow ?? 0);
  if (!Number.isInteger(employeeSheetRow) || employeeSheetRow < 2) return null;

  return {
    id,
    employeeSheetRow,
    employeeId: String(data.employeeId ?? "").trim(),
    employeeName: String(data.employeeName ?? "").trim(),
    laptop: normalizeDeviceList(data.laptop),
    desktop: normalizeDeviceList(data.desktop),
    screen: normalizeDeviceList(data.screen),
    keyboard: normalizeDeviceList(data.keyboard),
    mouse: normalizeDeviceList(data.mouse),
    cpu: normalizeDeviceList(data.cpu),
    ramGb: String(data.ramGb ?? "").trim(),
    logins: normalizeLoginList(data.logins, data.loginUsername, data.loginPassword),
    createdAt: String(data.createdAt ?? "").trim() || nowIso(),
    updatedAt: String(data.updatedAt ?? "").trim() || nowIso(),
    updatedBy: String(data.updatedBy ?? "").trim(),
  };
}

function docIdForSheetRow(sheetRow: number): string {
  return `row_${sheetRow}`;
}

function pickDevices(
  input: SystemSpecsInput,
  prev: Record<string, unknown>,
  key: keyof Pick<
    SystemSpecsInput,
    "laptop" | "desktop" | "screen" | "keyboard" | "mouse" | "cpu"
  >,
) {
  if (input[key] !== undefined) return compactDeviceList(input[key]);
  return compactDeviceList(normalizeDeviceList(prev[key]));
}

export async function listSystemSpecsFirestore(): Promise<SystemSpecsRecord[]> {
  const snap = await specsCollection().get();
  const records: SystemSpecsRecord[] = [];
  for (const doc of snap.docs) {
    const record = docToRecord(doc.id, doc.data() as Record<string, unknown>);
    if (record) records.push(record);
  }
  return records.sort((a, b) => a.employeeName.localeCompare(b.employeeName));
}

export async function getSystemSpecsBySheetRowFirestore(
  sheetRow: number,
): Promise<SystemSpecsRecord | null> {
  if (!Number.isInteger(sheetRow) || sheetRow < 2) return null;
  const doc = await specsCollection().doc(docIdForSheetRow(sheetRow)).get();
  if (!doc.exists) return null;
  return docToRecord(doc.id, (doc.data() ?? {}) as Record<string, unknown>);
}

export async function upsertSystemSpecsFirestore(
  input: SystemSpecsInput,
  updatedBy: string,
): Promise<SystemSpecsRecord> {
  const sheetRow = Number(input.employeeSheetRow);
  if (!Number.isInteger(sheetRow) || sheetRow < 2) {
    throw new Error("Valid employeeSheetRow is required");
  }

  const id = docIdForSheetRow(sheetRow);
  const ref = specsCollection().doc(id);
  const existing = await ref.get();
  const timestamp = nowIso();
  const prev = existing.exists
    ? ((existing.data() ?? {}) as Record<string, unknown>)
    : ({} as Record<string, unknown>);

  const logins =
    input.logins !== undefined
      ? compactLoginList(input.logins)
      : compactLoginList(normalizeLoginList(prev.logins, prev.loginUsername, prev.loginPassword));

  const record: SystemSpecsRecord = {
    id,
    employeeSheetRow: sheetRow,
    employeeId: String(input.employeeId ?? prev.employeeId ?? "").trim(),
    employeeName: String(input.employeeName ?? prev.employeeName ?? "").trim(),
    laptop: pickDevices(input, prev, "laptop"),
    desktop: pickDevices(input, prev, "desktop"),
    screen: pickDevices(input, prev, "screen"),
    keyboard: pickDevices(input, prev, "keyboard"),
    mouse: pickDevices(input, prev, "mouse"),
    cpu: pickDevices(input, prev, "cpu"),
    ramGb: String(input.ramGb ?? prev.ramGb ?? "").trim(),
    logins,
    createdAt: String(prev.createdAt ?? "").trim() || timestamp,
    updatedAt: timestamp,
    updatedBy: updatedBy.trim(),
  };

  await ref.set(record, { merge: true });
  return record;
}
