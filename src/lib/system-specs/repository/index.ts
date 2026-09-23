import { isFirebaseDailyStorage } from "@/lib/storage/backend";
import type { SystemSpecsInput, SystemSpecsRecord } from "@/lib/system-specs/types";
import {
  getSystemSpecsBySheetRowFirestore,
  listSystemSpecsFirestore,
  upsertSystemSpecsFirestore,
} from "./firestore";
import {
  getSystemSpecsBySheetRowSheets,
  listSystemSpecsSheets,
  upsertSystemSpecsSheets,
} from "./sheets";

/**
 * System specs follow DAILY_DATA_STORAGE:
 * - firebase → Firestore collection `system_specs`
 * - sheets (default when set) → Google Sheet tab `System Specs`
 */

export async function listSystemSpecs(): Promise<SystemSpecsRecord[]> {
  if (isFirebaseDailyStorage()) {
    return listSystemSpecsFirestore();
  }
  return listSystemSpecsSheets();
}

export async function getSystemSpecsBySheetRow(
  sheetRow: number,
): Promise<SystemSpecsRecord | null> {
  if (isFirebaseDailyStorage()) {
    return getSystemSpecsBySheetRowFirestore(sheetRow);
  }
  return getSystemSpecsBySheetRowSheets(sheetRow);
}

export async function upsertSystemSpecs(
  input: SystemSpecsInput,
  updatedBy: string,
): Promise<SystemSpecsRecord> {
  if (isFirebaseDailyStorage()) {
    return upsertSystemSpecsFirestore(input, updatedBy);
  }
  return upsertSystemSpecsSheets(input, updatedBy);
}
