import { sheets } from "@/lib/google/auth";
import { applySheetHeaderFormatByTitle } from "@/lib/google/sheet-format";
import {
  EMPTY_DEVICE,
  type DeviceSpec,
  type SystemSpecsInput,
  type SystemSpecsRecord,
} from "@/lib/system-specs/types";

const spreadsheetId = process.env.GOOGLE_SHEET_ID as string;
const SHEET_NAME = "System Specs";
const SHEET_RANGE = `'${SHEET_NAME}'`;

const HEADERS = [
  "id",
  "employeeSheetRow",
  "employeeId",
  "employeeName",
  "laptopName",
  "laptopSerial",
  "desktopName",
  "desktopSerial",
  "keyboardName",
  "keyboardSerial",
  "mouseName",
  "mouseSerial",
  "cpuName",
  "cpuSerial",
  "ramGb",
  "loginUsername",
  "loginPassword",
  "createdAt",
  "updatedAt",
  "updatedBy",
] as const;

let sheetReady = false;
let sheetRequest: Promise<void> | null = null;

function nowIso(): string {
  return new Date().toISOString();
}

function docIdForSheetRow(sheetRow: number): string {
  return `row_${sheetRow}`;
}

function device(name: string, serial: string): DeviceSpec {
  return {
    name: name.trim(),
    serialNumber: serial.trim(),
  };
}

function normalizeDevice(value: unknown): DeviceSpec {
  if (!value || typeof value !== "object") return { ...EMPTY_DEVICE };
  const raw = value as Record<string, unknown>;
  return {
    name: String(raw.name ?? "").trim(),
    serialNumber: String(raw.serialNumber ?? "").trim(),
  };
}

function rowToRecord(row: string[]): SystemSpecsRecord | null {
  const id = String(row[0] ?? "").trim();
  const employeeSheetRow = Number(row[1] ?? 0);
  if (!id || !Number.isInteger(employeeSheetRow) || employeeSheetRow < 2) return null;

  return {
    id,
    employeeSheetRow,
    employeeId: String(row[2] ?? "").trim(),
    employeeName: String(row[3] ?? "").trim(),
    laptop: device(String(row[4] ?? ""), String(row[5] ?? "")),
    desktop: device(String(row[6] ?? ""), String(row[7] ?? "")),
    keyboard: device(String(row[8] ?? ""), String(row[9] ?? "")),
    mouse: device(String(row[10] ?? ""), String(row[11] ?? "")),
    cpu: device(String(row[12] ?? ""), String(row[13] ?? "")),
    ramGb: String(row[14] ?? "").trim(),
    loginUsername: String(row[15] ?? "").trim(),
    loginPassword: String(row[16] ?? "").trim(),
    createdAt: String(row[17] ?? "").trim() || nowIso(),
    updatedAt: String(row[18] ?? "").trim() || nowIso(),
    updatedBy: String(row[19] ?? "").trim(),
  };
}

function recordToRow(record: SystemSpecsRecord): string[] {
  return [
    record.id,
    String(record.employeeSheetRow),
    record.employeeId,
    record.employeeName,
    record.laptop.name,
    record.laptop.serialNumber,
    record.desktop.name,
    record.desktop.serialNumber,
    record.keyboard.name,
    record.keyboard.serialNumber,
    record.mouse.name,
    record.mouse.serialNumber,
    record.cpu.name,
    record.cpu.serialNumber,
    record.ramGb,
    record.loginUsername,
    record.loginPassword,
    record.createdAt,
    record.updatedAt,
    record.updatedBy,
  ];
}

async function ensureSheet(): Promise<void> {
  if (sheetReady) return;
  if (sheetRequest) return sheetRequest;

  sheetRequest = (async () => {
    if (!spreadsheetId?.trim()) {
      throw new Error("GOOGLE_SHEET_ID is not configured");
    }

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

    const headerResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${SHEET_RANGE}!1:1`,
    });
    const headerRow = (headerResponse.data.values?.[0] as string[] | undefined) ?? [];
    const headersMatch = HEADERS.every(
      (header, index) => String(headerRow[index] ?? "").trim() === header,
    );

    if (!headersMatch) {
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

async function readAllRows(): Promise<{ records: SystemSpecsRecord[]; sheetRows: number[] }> {
  await ensureSheet();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_RANGE}!A2:T`,
  });
  const rows = (response.data.values as string[][] | undefined) ?? [];
  const records: SystemSpecsRecord[] = [];
  const sheetRows: number[] = [];

  rows.forEach((row, index) => {
    const record = rowToRecord(row);
    if (!record) return;
    records.push(record);
    sheetRows.push(index + 2);
  });

  return { records, sheetRows };
}

export async function listSystemSpecsSheets(): Promise<SystemSpecsRecord[]> {
  const { records } = await readAllRows();
  return records.sort((a, b) => a.employeeName.localeCompare(b.employeeName));
}

export async function getSystemSpecsBySheetRowSheets(
  sheetRow: number,
): Promise<SystemSpecsRecord | null> {
  if (!Number.isInteger(sheetRow) || sheetRow < 2) return null;
  const { records } = await readAllRows();
  return records.find((row) => row.employeeSheetRow === sheetRow) ?? null;
}

export async function upsertSystemSpecsSheets(
  input: SystemSpecsInput,
  updatedBy: string,
): Promise<SystemSpecsRecord> {
  const sheetRow = Number(input.employeeSheetRow);
  if (!Number.isInteger(sheetRow) || sheetRow < 2) {
    throw new Error("Valid employeeSheetRow is required");
  }

  await ensureSheet();
  const { records, sheetRows } = await readAllRows();
  const existingIndex = records.findIndex((row) => row.employeeSheetRow === sheetRow);
  const existing = existingIndex >= 0 ? records[existingIndex] : null;
  const timestamp = nowIso();

  const record: SystemSpecsRecord = {
    id: existing?.id || docIdForSheetRow(sheetRow),
    employeeSheetRow: sheetRow,
    employeeId: String(input.employeeId ?? existing?.employeeId ?? "").trim(),
    employeeName: String(input.employeeName ?? existing?.employeeName ?? "").trim(),
    laptop: normalizeDevice(input.laptop ?? existing?.laptop),
    desktop: normalizeDevice(input.desktop ?? existing?.desktop),
    keyboard: normalizeDevice(input.keyboard ?? existing?.keyboard),
    mouse: normalizeDevice(input.mouse ?? existing?.mouse),
    cpu: normalizeDevice(input.cpu ?? existing?.cpu),
    ramGb: String(input.ramGb ?? existing?.ramGb ?? "").trim(),
    loginUsername: String(input.loginUsername ?? existing?.loginUsername ?? "").trim(),
    loginPassword: String(input.loginPassword ?? existing?.loginPassword ?? "").trim(),
    createdAt: existing?.createdAt || timestamp,
    updatedAt: timestamp,
    updatedBy: updatedBy.trim(),
  };

  const values = [recordToRow(record)];

  if (existingIndex >= 0) {
    const targetRow = sheetRows[existingIndex];
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${SHEET_RANGE}!A${targetRow}:T${targetRow}`,
      valueInputOption: "RAW",
      requestBody: { values },
    });
  } else {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${SHEET_RANGE}!A:T`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values },
    });
  }

  return record;
}
