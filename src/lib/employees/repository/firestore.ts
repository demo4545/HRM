import {
  employeeHeadersEqual,
  ensureRequiredEmployeeFormHeaders,
  getSheetHeaders,
  headerToFormKey,
  sheetRowToForm,
} from "@/lib/employee";
import { EMPLOYEE_SHEET_RANGE, readSheet } from "@/lib/google/sheets";
import { getAdminFirestore } from "@/lib/firebase/admin";

const EMPLOYEES_COLLECTION = "employees";
const META_DOC_ID = "meta";
/** Warm instances reuse headers across concurrent logins during rush hour. */
const HEADERS_CACHE_TTL_MS = 60_000;

export type EmployeeRowRecord = {
  sheetRow: number;
  headers: string[];
  row: string[];
};

let bootstrapPromise: Promise<void> | null = null;
let headersCache: { value: string[]; expiresAt: number } | null = null;
let headersInflight: Promise<string[]> | null = null;
let metaExistsCache = false;

function employeesCollection() {
  return getAdminFirestore().collection(EMPLOYEES_COLLECTION);
}

function loginIndexFields(
  headers: string[],
  row: string[],
): {
  emailLower: string;
  usernameLower: string;
} {
  const form = sheetRowToForm(headers, row);
  return {
    emailLower: form.email.trim().toLowerCase(),
    usernameLower: form.username.trim().toLowerCase(),
  };
}

async function ensureEmployeesBootstrapped(): Promise<void> {
  if (metaExistsCache) return;
  if (bootstrapPromise) return bootstrapPromise;

  bootstrapPromise = (async () => {
    const db = getAdminFirestore();
    const metaSnap = await db.collection(EMPLOYEES_COLLECTION).doc(META_DOC_ID).get();
    if (metaSnap.exists) {
      metaExistsCache = true;
      return;
    }

    const raw = await readSheet(EMPLOYEE_SHEET_RANGE);
    if (raw.length < 2) {
      await db
        .collection(EMPLOYEES_COLLECTION)
        .doc(META_DOC_ID)
        .set({ headers: ensureRequiredEmployeeFormHeaders(getSheetHeaders(raw)) });
      return;
    }

    const headers = ensureRequiredEmployeeFormHeaders(getSheetHeaders(raw));
    const batch = db.batch();
    batch.set(db.collection(EMPLOYEES_COLLECTION).doc(META_DOC_ID), { headers });

    for (let index = 1; index < raw.length; index++) {
      const sheetRow = index + 1;
      const row = raw[index] ?? [];
      batch.set(db.collection(EMPLOYEES_COLLECTION).doc(String(sheetRow)), {
        sheetRow,
        row,
        ...loginIndexFields(headers, row),
      });
    }

    await batch.commit();
    metaExistsCache = true;
    headersCache = null;
    console.info("[firebase] bootstrapped employees from Google Sheets");
  })().finally(() => {
    bootstrapPromise = null;
  });

  return bootstrapPromise;
}

async function persistHeadersIfNeeded(headers: string[]): Promise<string[]> {
  const ensured = ensureRequiredEmployeeFormHeaders(headers);
  if (employeeHeadersEqual(headers, ensured)) return headers;
  await employeesCollection().doc(META_DOC_ID).set({ headers: ensured }, { merge: true });
  headersCache = { value: ensured, expiresAt: Date.now() + HEADERS_CACHE_TTL_MS };
  return ensured;
}

async function getHeaders(): Promise<string[]> {
  if (headersCache && Date.now() < headersCache.expiresAt) {
    return headersCache.value;
  }
  if (headersInflight) return headersInflight;

  headersInflight = (async () => {
    await ensureEmployeesBootstrapped();
    const snap = await employeesCollection().doc(META_DOC_ID).get();
    let headers = (snap.data()?.headers as string[] | undefined) ?? [];
    if (headers.length > 0) {
      const ensured = await persistHeadersIfNeeded(headers);
      headersCache = { value: ensured, expiresAt: Date.now() + HEADERS_CACHE_TTL_MS };
      return ensured;
    }

    // Meta may exist without headers (empty bootstrap). Pull once from Sheets.
    try {
      const raw = await readSheet(EMPLOYEE_SHEET_RANGE);
      headers = getSheetHeaders(raw);
      if (headers.length > 0) {
        const ensured = await persistHeadersIfNeeded(headers);
        headersCache = { value: ensured, expiresAt: Date.now() + HEADERS_CACHE_TTL_MS };
        return ensured;
      }
    } catch (error) {
      console.error("[firebase] failed to refresh employee headers from Sheets:", error);
    }
    return headers;
  })().finally(() => {
    headersInflight = null;
  });

  return headersInflight;
}

export async function getEmployeeHeadersFirestore(): Promise<string[]> {
  return getHeaders();
}

export async function getEmployeeBySheetRow(sheetRow: number): Promise<EmployeeRowRecord | null> {
  if (sheetRow < 2) return null;
  await ensureEmployeesBootstrapped();
  const [snap, headers] = await Promise.all([
    employeesCollection().doc(String(sheetRow)).get(),
    getHeaders(),
  ]);
  if (!snap.exists) return null;
  const data = snap.data() as { row?: string[] };
  const row = (data.row as string[]) ?? [];
  return {
    sheetRow,
    headers,
    row: headers.map((_, index) => String(row[index] ?? "")),
  };
}

export async function findEmployeeByLogin(login: string): Promise<EmployeeRowRecord | null> {
  const loginNorm = login.trim().toLowerCase();
  if (!loginNorm) return null;

  const headers = await getHeaders();
  const looksLikeEmail = loginNorm.includes("@");

  const queryByEmail = () =>
    employeesCollection().where("emailLower", "==", loginNorm).limit(1).get().catch(() => null);
  const queryByUsername = () =>
    employeesCollection().where("usernameLower", "==", loginNorm).limit(1).get().catch(() => null);

  // One indexed read first (email or username), second only if needed.
  const primary = looksLikeEmail ? await queryByEmail() : await queryByUsername();
  const secondary =
    primary?.docs[0] && primary.docs[0].id !== META_DOC_ID
      ? null
      : looksLikeEmail
        ? await queryByUsername()
        : await queryByEmail();

  const indexedDoc = primary?.docs[0] ?? secondary?.docs[0];
  if (indexedDoc && indexedDoc.id !== META_DOC_ID) {
    const sheetRow = Number(indexedDoc.id);
    if (Number.isFinite(sheetRow) && sheetRow >= 2) {
      return {
        sheetRow,
        headers,
        row: headers.map((_, index) =>
          String(((indexedDoc.data().row as string[]) ?? [])[index] ?? ""),
        ),
      };
    }
  }

  // Fallback for older docs without emailLower / usernameLower.
  const snap = await employeesCollection().get();
  for (const doc of snap.docs) {
    if (doc.id === META_DOC_ID) continue;
    const sheetRow = Number(doc.id);
    if (!Number.isFinite(sheetRow) || sheetRow < 2) continue;
    const row = (doc.data().row as string[]) ?? [];
    const form = sheetRowToForm(headers, row);
    const email = form.email.trim().toLowerCase();
    const username = form.username.trim().toLowerCase();
    if (email === loginNorm || (username && username === loginNorm)) {
      // Lazily index this doc so the next login is a fast query.
      void employeesCollection()
        .doc(String(sheetRow))
        .set({ emailLower: email, usernameLower: username }, { merge: true })
        .catch(() => undefined);
      return {
        sheetRow,
        headers,
        row: headers.map((_, index) => String(row[index] ?? "")),
      };
    }
  }

  return null;
}

export async function updateEmployeeRow(sheetRow: number, row: string[]): Promise<void> {
  const headers = await getHeaders();
  const normalized = headers.map((_, index) => String(row[index] ?? ""));
  await employeesCollection()
    .doc(String(sheetRow))
    .set({ sheetRow, row: normalized, ...loginIndexFields(headers, normalized) }, { merge: true });
}

export async function listAllEmployeeRows(): Promise<EmployeeRowRecord[]> {
  await ensureEmployeesBootstrapped();
  const headers = await getHeaders();
  const snap = await employeesCollection().get();
  const records: EmployeeRowRecord[] = [];

  for (const doc of snap.docs) {
    if (doc.id === META_DOC_ID) continue;
    const sheetRow = Number(doc.id);
    if (!Number.isFinite(sheetRow) || sheetRow < 2) continue;
    records.push({
      sheetRow,
      headers,
      row: headers.map((_, index) => String(((doc.data().row as string[]) ?? [])[index] ?? "")),
    });
  }

  return records.sort((a, b) => a.sheetRow - b.sheetRow);
}

/** Sheet-shaped matrix: `[headers, ...dataRows]` for existing list/process helpers. */
export async function readEmployeeSheetDataFirestore(): Promise<{
  data: string[][];
  sheetRowNumbers: number[];
}> {
  const records = await listAllEmployeeRows();
  const headers = await getHeaders();
  return {
    data: [headers, ...records.map((record) => record.row)],
    sheetRowNumbers: records.map((record) => record.sheetRow),
  };
}

export async function getEmployeeCountFirestore(): Promise<number> {
  const records = await listAllEmployeeRows();
  return records.length;
}

export async function getExistingEmployeeIdsFirestore(): Promise<string[]> {
  const records = await listAllEmployeeRows();
  if (records.length === 0) return [];
  const headers = records[0]?.headers ?? (await getHeaders());
  const idIndex = headers.findIndex((header) => headerToFormKey(header) === "employeeId");
  if (idIndex < 0) return [];
  return records.map((record) => String(record.row[idIndex] ?? "").trim()).filter(Boolean);
}

export async function createEmployeeRowFirestore(row: string[]): Promise<number> {
  await ensureEmployeesBootstrapped();
  const headers = await getHeaders();
  if (headers.length === 0) {
    throw new Error("Employee sheet headers are missing in Firebase. Re-bootstrap from Sheets.");
  }

  const snap = await employeesCollection().get();
  let maxSheetRow = 1;
  for (const doc of snap.docs) {
    if (doc.id === META_DOC_ID) continue;
    const sheetRow = Number(doc.id);
    if (Number.isFinite(sheetRow) && sheetRow > maxSheetRow) {
      maxSheetRow = sheetRow;
    }
  }

  const sheetRow = maxSheetRow + 1;
  const normalized = headers.map((_, index) => String(row[index] ?? ""));
  await employeesCollection()
    .doc(String(sheetRow))
    .set({ sheetRow, row: normalized, ...loginIndexFields(headers, normalized) });
  return sheetRow;
}

export async function deleteEmployeeRowFirestore(sheetRow: number): Promise<boolean> {
  if (sheetRow < 2) return false;
  const ref = employeesCollection().doc(String(sheetRow));
  const snap = await ref.get();
  if (!snap.exists) return false;
  await ref.delete();
  return true;
}
