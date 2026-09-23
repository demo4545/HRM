import { getAdminFirestore } from "@/lib/firebase/admin";
import {
  EMPTY_DEVICE,
  type DeviceSpec,
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

function normalizeDevice(value: unknown): DeviceSpec {
  if (!value || typeof value !== "object") return { ...EMPTY_DEVICE };
  const raw = value as Record<string, unknown>;
  return {
    name: String(raw.name ?? "").trim(),
    serialNumber: String(raw.serialNumber ?? "").trim(),
  };
}

function docToRecord(id: string, data: Record<string, unknown>): SystemSpecsRecord | null {
  const employeeSheetRow = Number(data.employeeSheetRow ?? 0);
  if (!Number.isInteger(employeeSheetRow) || employeeSheetRow < 2) return null;

  return {
    id,
    employeeSheetRow,
    employeeId: String(data.employeeId ?? "").trim(),
    employeeName: String(data.employeeName ?? "").trim(),
    laptop: normalizeDevice(data.laptop),
    desktop: normalizeDevice(data.desktop),
    keyboard: normalizeDevice(data.keyboard),
    mouse: normalizeDevice(data.mouse),
    cpu: normalizeDevice(data.cpu),
    ramGb: String(data.ramGb ?? "").trim(),
    loginUsername: String(data.loginUsername ?? "").trim(),
    loginPassword: String(data.loginPassword ?? "").trim(),
    createdAt: String(data.createdAt ?? "").trim() || nowIso(),
    updatedAt: String(data.updatedAt ?? "").trim() || nowIso(),
    updatedBy: String(data.updatedBy ?? "").trim(),
  };
}

function docIdForSheetRow(sheetRow: number): string {
  return `row_${sheetRow}`;
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

  const record: SystemSpecsRecord = {
    id,
    employeeSheetRow: sheetRow,
    employeeId: String(input.employeeId ?? prev.employeeId ?? "").trim(),
    employeeName: String(input.employeeName ?? prev.employeeName ?? "").trim(),
    laptop: normalizeDevice(input.laptop ?? prev.laptop),
    desktop: normalizeDevice(input.desktop ?? prev.desktop),
    keyboard: normalizeDevice(input.keyboard ?? prev.keyboard),
    mouse: normalizeDevice(input.mouse ?? prev.mouse),
    cpu: normalizeDevice(input.cpu ?? prev.cpu),
    ramGb: String(input.ramGb ?? prev.ramGb ?? "").trim(),
    loginUsername: String(input.loginUsername ?? prev.loginUsername ?? "").trim(),
    loginPassword: String(input.loginPassword ?? prev.loginPassword ?? "").trim(),
    createdAt: String(prev.createdAt ?? "").trim() || timestamp,
    updatedAt: timestamp,
    updatedBy: updatedBy.trim(),
  };

  await ref.set(record, { merge: true });
  return record;
}
