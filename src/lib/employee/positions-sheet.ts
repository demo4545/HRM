import { sheets } from "@/lib/google/auth";
import { appendSheetRows, readSheet } from "@/lib/google/sheets";
import { normalizePositionLabel } from "@/lib/employee/positions";

const spreadsheetId = process.env.GOOGLE_SHEET_ID as string;
export const POSITIONS_SHEET_NAME = "Positions";
const POSITIONS_SHEET_RANGE = `'${POSITIONS_SHEET_NAME}'!A:A`;
const POSITIONS_HEADER = "Position";
const HEADER_TITLES = new Set(["position", "positions", "job title", "designation", "title"]);

let sheetReady = false;
let sheetRequest: Promise<void> | null = null;

function extractPositionLabels(rows: string[][]): string[] {
  const raw = rows
    .map((row) => String(row[0] ?? "").trim())
    .filter(Boolean)
    .filter((value, index) => {
      if (index === 0 && HEADER_TITLES.has(value.toLowerCase())) return false;
      return true;
    });

  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of raw) {
    const label = normalizePositionLabel(entry);
    const key = label.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(label);
  }

  out.sort((a, b) => a.localeCompare(b));
  return out;
}

async function ensurePositionsSheet(): Promise<void> {
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
    const exists = metadata.data.sheets?.some(
      (sheet) => sheet.properties?.title === POSITIONS_SHEET_NAME,
    );

    if (!exists) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [{ addSheet: { properties: { title: POSITIONS_SHEET_NAME } } }],
        },
      });
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${POSITIONS_SHEET_RANGE}!A1`,
        valueInputOption: "RAW",
        requestBody: { values: [[POSITIONS_HEADER]] },
      });
    } else {
      const headerResponse = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'${POSITIONS_SHEET_NAME}'!1:1`,
      });
      const headerRow = (headerResponse.data.values?.[0] as string[] | undefined) ?? [];
      if (!String(headerRow[0] ?? "").trim()) {
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `'${POSITIONS_SHEET_NAME}'!A1`,
          valueInputOption: "RAW",
          requestBody: { values: [[POSITIONS_HEADER]] },
        });
      }
    }

    sheetReady = true;
  })().finally(() => {
    sheetRequest = null;
  });

  return sheetRequest;
}

export async function listCustomPositionLabels(): Promise<string[]> {
  await ensurePositionsSheet();
  const rows = await readSheet(POSITIONS_SHEET_RANGE);
  return extractPositionLabels(rows);
}

export async function addCustomPositionLabel(label: string): Promise<{
  added: boolean;
  label: string;
}> {
  const normalized = normalizePositionLabel(label);
  if (!normalized) {
    throw new Error("Position name is required");
  }

  await ensurePositionsSheet();
  const existing = await listCustomPositionLabels();
  const exists = existing.some((entry) => entry.toLowerCase() === normalized.toLowerCase());
  if (exists) {
    return { added: false, label: normalized };
  }

  await appendSheetRows(POSITIONS_SHEET_RANGE, [[normalized]]);
  return { added: true, label: normalized };
}
