import { sheets } from "@/lib/google/auth";
import { applySheetHeaderFormatByTitle } from "@/lib/google/sheet-format";
import {
  compactDeviceList,
  compactLoginList,
  normalizeDeviceList,
  normalizeLoginList,
  type DeviceSpec,
  type LoginCredential,
  type SystemSpecsInput,
  type SystemSpecsRecord,
} from "@/lib/system-specs/types";

const spreadsheetId = process.env.GOOGLE_SHEET_ID as string;
const SHEET_NAME = "System Specs";
const SHEET_RANGE = `'${SHEET_NAME}'`;

/** Current schema — device + login lists stored as JSON. */
const HEADERS = [
  "id",
  "employeeSheetRow",
  "employeeId",
  "employeeName",
  "laptopJson",
  "desktopJson",
  "screenJson",
  "keyboardJson",
  "mouseJson",
  "cpuJson",
  "ramGb",
  "loginsJson",
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

function devicesToJson(list: DeviceSpec[]): string {
  return JSON.stringify(compactDeviceList(list));
}

function loginsToJson(list: LoginCredential[]): string {
  return JSON.stringify(compactLoginList(list));
}

function parseDevicesJson(raw: string): DeviceSpec[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  try {
    return compactDeviceList(normalizeDeviceList(JSON.parse(trimmed)));
  } catch {
    return [];
  }
}

function parseLoginsJson(raw: string): LoginCredential[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  try {
    return compactLoginList(normalizeLoginList(JSON.parse(trimmed)));
  } catch {
    return [];
  }
}

function singleDevice(name: string, serial: string): DeviceSpec[] {
  return compactDeviceList([{ name, serialNumber: serial }]);
}

function headerKind(headerRow: string[]): "legacy-flat" | "devices-single-login" | "current" {
  const col4 = String(headerRow[4] ?? "").trim();
  const col11 = String(headerRow[11] ?? "").trim();
  if (col4 === "laptopName") return "legacy-flat";
  if (col11 === "loginUsername") return "devices-single-login";
  return "current";
}

function rowToRecordLegacyFlat(row: string[]): SystemSpecsRecord | null {
  const id = String(row[0] ?? "").trim();
  const employeeSheetRow = Number(row[1] ?? 0);
  if (!id || !Number.isInteger(employeeSheetRow) || employeeSheetRow < 2) return null;

  return {
    id,
    employeeSheetRow,
    employeeId: String(row[2] ?? "").trim(),
    employeeName: String(row[3] ?? "").trim(),
    laptop: singleDevice(String(row[4] ?? ""), String(row[5] ?? "")),
    desktop: singleDevice(String(row[6] ?? ""), String(row[7] ?? "")),
    screen: [],
    keyboard: singleDevice(String(row[8] ?? ""), String(row[9] ?? "")),
    mouse: singleDevice(String(row[10] ?? ""), String(row[11] ?? "")),
    cpu: singleDevice(String(row[12] ?? ""), String(row[13] ?? "")),
    ramGb: String(row[14] ?? "").trim(),
    logins: compactLoginList(
      normalizeLoginList(undefined, String(row[15] ?? ""), String(row[16] ?? "")),
    ),
    createdAt: String(row[17] ?? "").trim() || nowIso(),
    updatedAt: String(row[18] ?? "").trim() || nowIso(),
    updatedBy: String(row[19] ?? "").trim(),
  };
}

function rowToRecordDevicesSingleLogin(row: string[]): SystemSpecsRecord | null {
  const id = String(row[0] ?? "").trim();
  const employeeSheetRow = Number(row[1] ?? 0);
  if (!id || !Number.isInteger(employeeSheetRow) || employeeSheetRow < 2) return null;

  return {
    id,
    employeeSheetRow,
    employeeId: String(row[2] ?? "").trim(),
    employeeName: String(row[3] ?? "").trim(),
    laptop: parseDevicesJson(String(row[4] ?? "")),
    desktop: parseDevicesJson(String(row[5] ?? "")),
    screen: parseDevicesJson(String(row[6] ?? "")),
    keyboard: parseDevicesJson(String(row[7] ?? "")),
    mouse: parseDevicesJson(String(row[8] ?? "")),
    cpu: parseDevicesJson(String(row[9] ?? "")),
    ramGb: String(row[10] ?? "").trim(),
    logins: compactLoginList(
      normalizeLoginList(undefined, String(row[11] ?? ""), String(row[12] ?? "")),
    ),
    createdAt: String(row[13] ?? "").trim() || nowIso(),
    updatedAt: String(row[14] ?? "").trim() || nowIso(),
    updatedBy: String(row[15] ?? "").trim(),
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
    laptop: parseDevicesJson(String(row[4] ?? "")),
    desktop: parseDevicesJson(String(row[5] ?? "")),
    screen: parseDevicesJson(String(row[6] ?? "")),
    keyboard: parseDevicesJson(String(row[7] ?? "")),
    mouse: parseDevicesJson(String(row[8] ?? "")),
    cpu: parseDevicesJson(String(row[9] ?? "")),
    ramGb: String(row[10] ?? "").trim(),
    logins: parseLoginsJson(String(row[11] ?? "")),
    createdAt: String(row[12] ?? "").trim() || nowIso(),
    updatedAt: String(row[13] ?? "").trim() || nowIso(),
    updatedBy: String(row[14] ?? "").trim(),
  };
}

function recordToRow(record: SystemSpecsRecord): string[] {
  return [
    record.id,
    String(record.employeeSheetRow),
    record.employeeId,
    record.employeeName,
    devicesToJson(record.laptop),
    devicesToJson(record.desktop),
    devicesToJson(record.screen),
    devicesToJson(record.keyboard),
    devicesToJson(record.mouse),
    devicesToJson(record.cpu),
    record.ramGb,
    loginsToJson(record.logins),
    record.createdAt,
    record.updatedAt,
    record.updatedBy,
  ];
}

async function rewriteSheet(records: SystemSpecsRecord[]): Promise<void> {
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: SHEET_RANGE,
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${SHEET_RANGE}!A1`,
    valueInputOption: "RAW",
    requestBody: {
      values: [[...HEADERS], ...records.map(recordToRow)],
    },
  });
  await applySheetHeaderFormatByTitle(spreadsheetId, SHEET_NAME, HEADERS.length);
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
    const kind = headerKind(headerRow);

    if (kind === "legacy-flat") {
      const dataResponse = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${SHEET_RANGE}!A2:T`,
      });
      const rows = (dataResponse.data.values as string[][] | undefined) ?? [];
      const records = rows
        .map((row) => rowToRecordLegacyFlat(row))
        .filter((row): row is SystemSpecsRecord => row != null);
      await rewriteSheet(records);
    } else if (kind === "devices-single-login") {
      const dataResponse = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${SHEET_RANGE}!A2:P`,
      });
      const rows = (dataResponse.data.values as string[][] | undefined) ?? [];
      const records = rows
        .map((row) => rowToRecordDevicesSingleLogin(row))
        .filter((row): row is SystemSpecsRecord => row != null);
      await rewriteSheet(records);
    } else {
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
    range: `${SHEET_RANGE}!A2:O`,
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

function pickDevices(
  input: SystemSpecsInput,
  existing: SystemSpecsRecord | null,
  key: keyof Pick<
    SystemSpecsInput,
    "laptop" | "desktop" | "screen" | "keyboard" | "mouse" | "cpu"
  >,
) {
  if (input[key] !== undefined) return compactDeviceList(input[key]);
  return compactDeviceList(existing?.[key]);
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
    laptop: pickDevices(input, existing, "laptop"),
    desktop: pickDevices(input, existing, "desktop"),
    screen: pickDevices(input, existing, "screen"),
    keyboard: pickDevices(input, existing, "keyboard"),
    mouse: pickDevices(input, existing, "mouse"),
    cpu: pickDevices(input, existing, "cpu"),
    ramGb: String(input.ramGb ?? existing?.ramGb ?? "").trim(),
    logins:
      input.logins !== undefined
        ? compactLoginList(input.logins)
        : compactLoginList(existing?.logins),
    createdAt: existing?.createdAt || timestamp,
    updatedAt: timestamp,
    updatedBy: updatedBy.trim(),
  };

  const values = [recordToRow(record)];

  if (existingIndex >= 0) {
    const targetRow = sheetRows[existingIndex];
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${SHEET_RANGE}!A${targetRow}:O${targetRow}`,
      valueInputOption: "RAW",
      requestBody: { values },
    });
  } else {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${SHEET_RANGE}!A:O`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values },
    });
  }

  return record;
}
