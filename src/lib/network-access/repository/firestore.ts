import { randomUUID } from "node:crypto";

import { getAdminFirestore } from "@/lib/firebase/admin";
import { sheets } from "@/lib/google/auth";
import { isValidIpv4, normalizeIp } from "@/lib/network-access/ip";
import { localTodayIso } from "@/lib/attendance/manual-entry";
import type {
  CompanyWfhDay,
  NetworkAccessSettings,
  OfficeNetwork,
  RemoteAccessEmployee,
} from "@/lib/network-access/types";

const SETTINGS_COLLECTION = "network_access";
const SETTINGS_DOC = "settings";
const META_DOC = "meta";
const OFFICE_COLLECTION = "network_office_networks";
const REMOTE_COLLECTION = "network_remote_access";
const COMPANY_WFH_COLLECTION = "network_company_wfh_days";

const OFFICE_SHEET = "Office Networks";
const SETTINGS_SHEET = "Network Settings";
const REMOTE_SHEET = "Remote Access";
const RESTRICTION_KEY = "restriction_enabled";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Short TTL + write invalidation: concurrent login/punch calls share one read,
 * but allowlist updates still appear within ~15s (and immediately after writes).
 * A multi-minute cache previously left login blocked after adding an IP.
 */
const NETWORK_CACHE_TTL_MS = 15_000;

type CacheEntry<T> = { value: T; expiresAt: number };

let settingsCache: CacheEntry<NetworkAccessSettings> | null = null;
let officeNetworksCache: CacheEntry<OfficeNetwork[]> | null = null;
let remoteAccessCache: CacheEntry<RemoteAccessEmployee[]> | null = null;
let companyWfhCache: CacheEntry<CompanyWfhDay[]> | null = null;

let settingsInflight: Promise<NetworkAccessSettings> | null = null;
let officeNetworksInflight: Promise<OfficeNetwork[]> | null = null;
let remoteAccessInflight: Promise<RemoteAccessEmployee[]> | null = null;
let companyWfhInflight: Promise<CompanyWfhDay[]> | null = null;

let bootstrapPromise: Promise<void> | null = null;

function nowIso(): string {
  return new Date().toISOString();
}

function parseEnabled(value: string): boolean {
  const v = value.trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

function normalizeDateOnly(value: string): string {
  const raw = value.trim().slice(0, 10);
  return ISO_DATE.test(raw) ? raw : "";
}

function rowToNetwork(row: string[]): OfficeNetwork | null {
  const id = String(row[0] ?? "").trim();
  const label = String(row[1] ?? "").trim();
  const ip = normalizeIp(String(row[2] ?? ""));
  const createdAt = String(row[3] ?? "").trim();
  const updatedAt = String(row[4] ?? "").trim();
  if (!id || !label || !isValidIpv4(ip)) return null;
  return { id, label, ip, createdAt, updatedAt };
}

function rowToRemote(row: string[]): RemoteAccessEmployee | null {
  const id = String(row[0] ?? "").trim();
  const employeeSheetRow = Number(row[1] ?? 0);
  const employeeId = String(row[2] ?? "").trim();
  const employeeName = String(row[3] ?? "").trim();
  const createdAt = String(row[4] ?? "").trim();
  if (!id || !Number.isInteger(employeeSheetRow) || employeeSheetRow < 2 || !employeeName) {
    return null;
  }
  return { id, employeeSheetRow, employeeId, employeeName, createdAt };
}

async function ensureNetworkAccessBootstrapped(): Promise<void> {
  if (bootstrapPromise) return bootstrapPromise;

  bootstrapPromise = (async () => {
    const db = getAdminFirestore();
    const metaSnap = await db.collection(SETTINGS_COLLECTION).doc(META_DOC).get();
    if (metaSnap.exists) return;

    const spreadsheetId = process.env.GOOGLE_SHEET_ID?.trim();
    if (!spreadsheetId) {
      await db.collection(SETTINGS_COLLECTION).doc(META_DOC).set({
        bootstrapped: true,
        source: "empty",
        at: nowIso(),
      });
      await db.collection(SETTINGS_COLLECTION).doc(SETTINGS_DOC).set({
        restrictionEnabled: false,
        updatedAt: nowIso(),
      });
      return;
    }

    try {
      const batch = db.batch();
      batch.set(db.collection(SETTINGS_COLLECTION).doc(META_DOC), {
        bootstrapped: true,
        source: "sheets",
        at: nowIso(),
      });

      let restrictionEnabled = false;
      try {
        const settingsRes = await sheets.spreadsheets.values.get({
          spreadsheetId,
          range: `'${SETTINGS_SHEET}'!A2:B`,
        });
        const settingsRows = (settingsRes.data.values as string[][] | undefined) ?? [];
        const enabledRow = settingsRows.find(
          (row) => String(row[0] ?? "").trim() === RESTRICTION_KEY,
        );
        restrictionEnabled = parseEnabled(String(enabledRow?.[1] ?? "false"));
      } catch {
        restrictionEnabled = false;
      }

      batch.set(db.collection(SETTINGS_COLLECTION).doc(SETTINGS_DOC), {
        restrictionEnabled,
        updatedAt: nowIso(),
      });

      try {
        const officeRes = await sheets.spreadsheets.values.get({
          spreadsheetId,
          range: `'${OFFICE_SHEET}'!A2:E`,
        });
        const officeRows = (officeRes.data.values as string[][] | undefined) ?? [];
        for (const row of officeRows) {
          const network = rowToNetwork(row);
          if (!network) continue;
          batch.set(db.collection(OFFICE_COLLECTION).doc(network.id), network);
        }
      } catch {
        // Sheet may not exist yet.
      }

      try {
        const remoteRes = await sheets.spreadsheets.values.get({
          spreadsheetId,
          range: `'${REMOTE_SHEET}'!A2:E`,
        });
        const remoteRows = (remoteRes.data.values as string[][] | undefined) ?? [];
        for (const row of remoteRows) {
          const employee = rowToRemote(row);
          if (!employee) continue;
          batch.set(db.collection(REMOTE_COLLECTION).doc(employee.id), employee);
        }
      } catch {
        // Sheet may not exist yet.
      }

      await batch.commit();
      console.info("[firebase] bootstrapped network access from Google Sheets");
    } catch (error) {
      console.error("[firebase] network access bootstrap failed:", error);
      await db.collection(SETTINGS_COLLECTION).doc(META_DOC).set({
        bootstrapped: true,
        source: "failed",
        at: nowIso(),
      });
      await db.collection(SETTINGS_COLLECTION).doc(SETTINGS_DOC).set(
        {
          restrictionEnabled: false,
          updatedAt: nowIso(),
        },
        { merge: true },
      );
    }
  })().finally(() => {
    bootstrapPromise = null;
  });

  return bootstrapPromise;
}

export function clearNetworkAccessCachesFirestore(): void {
  settingsCache = null;
  officeNetworksCache = null;
  remoteAccessCache = null;
  companyWfhCache = null;
  settingsInflight = null;
  officeNetworksInflight = null;
  remoteAccessInflight = null;
  companyWfhInflight = null;
}

export async function getNetworkAccessSettingsFirestore(): Promise<NetworkAccessSettings> {
  if (settingsCache && Date.now() < settingsCache.expiresAt) {
    return settingsCache.value;
  }
  if (settingsInflight) return settingsInflight;

  settingsInflight = (async () => {
    await ensureNetworkAccessBootstrapped();
    const snap = await getAdminFirestore().collection(SETTINGS_COLLECTION).doc(SETTINGS_DOC).get();
    const data = snap.data() as { restrictionEnabled?: boolean } | undefined;
    const value: NetworkAccessSettings = {
      restrictionEnabled: Boolean(data?.restrictionEnabled),
    };
    settingsCache = { value, expiresAt: Date.now() + NETWORK_CACHE_TTL_MS };
    return value;
  })().finally(() => {
    settingsInflight = null;
  });

  return settingsInflight;
}

export async function setNetworkRestrictionEnabledFirestore(
  enabled: boolean,
): Promise<NetworkAccessSettings> {
  await ensureNetworkAccessBootstrapped();
  const settings: NetworkAccessSettings = { restrictionEnabled: enabled };
  await getAdminFirestore().collection(SETTINGS_COLLECTION).doc(SETTINGS_DOC).set(
    {
      restrictionEnabled: enabled,
      updatedAt: nowIso(),
    },
    { merge: true },
  );
  clearNetworkAccessCachesFirestore();
  return settings;
}

export async function listOfficeNetworksFirestore(): Promise<OfficeNetwork[]> {
  if (officeNetworksCache && Date.now() < officeNetworksCache.expiresAt) {
    return officeNetworksCache.value;
  }
  if (officeNetworksInflight) return officeNetworksInflight;

  officeNetworksInflight = (async () => {
    await ensureNetworkAccessBootstrapped();
    const snap = await getAdminFirestore().collection(OFFICE_COLLECTION).get();
    const value = snap.docs
      .map((doc) => {
        const data = doc.data() as Partial<OfficeNetwork>;
        const ip = normalizeIp(String(data.ip ?? ""));
        const label = String(data.label ?? "").trim();
        if (!label || !isValidIpv4(ip)) return null;
        return {
          id: String(data.id ?? doc.id),
          label,
          ip,
          createdAt: String(data.createdAt ?? ""),
          updatedAt: String(data.updatedAt ?? ""),
        } satisfies OfficeNetwork;
      })
      .filter((row): row is OfficeNetwork => Boolean(row))
      .sort((a, b) => a.label.localeCompare(b.label));
    officeNetworksCache = { value, expiresAt: Date.now() + NETWORK_CACHE_TTL_MS };
    return value;
  })().finally(() => {
    officeNetworksInflight = null;
  });

  return officeNetworksInflight;
}

export async function createOfficeNetworkFirestore(input: {
  label: string;
  ip: string;
}): Promise<OfficeNetwork> {
  await ensureNetworkAccessBootstrapped();
  const label = input.label.trim();
  const ip = normalizeIp(input.ip);
  if (!label || label.length > 80) {
    throw new Error("Label is required (max 80 characters)");
  }
  if (!isValidIpv4(ip)) {
    throw new Error("A valid IPv4 address is required");
  }

  const existing = await listOfficeNetworksFirestore();
  if (existing.some((row) => row.ip === ip)) {
    throw new Error("This IP is already in the allowlist");
  }

  const timestamp = nowIso();
  const network: OfficeNetwork = {
    id: randomUUID(),
    label,
    ip,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  await getAdminFirestore().collection(OFFICE_COLLECTION).doc(network.id).set(network);
  clearNetworkAccessCachesFirestore();
  return network;
}

export async function updateOfficeNetworkFirestore(input: {
  id: string;
  label: string;
  ip: string;
}): Promise<OfficeNetwork | null> {
  await ensureNetworkAccessBootstrapped();
  const db = getAdminFirestore();
  const ref = db.collection(OFFICE_COLLECTION).doc(input.id);
  const snap = await ref.get();
  if (!snap.exists) return null;

  const label = input.label.trim();
  const ip = normalizeIp(input.ip);
  if (!label || label.length > 80) {
    throw new Error("Label is required (max 80 characters)");
  }
  if (!isValidIpv4(ip)) {
    throw new Error("A valid IPv4 address is required");
  }

  const existing = await listOfficeNetworksFirestore();
  if (existing.some((row) => row.ip === ip && row.id !== input.id)) {
    throw new Error("This IP is already in the allowlist");
  }

  const previous = snap.data() as Partial<OfficeNetwork>;
  const updated: OfficeNetwork = {
    id: input.id,
    label,
    ip,
    createdAt: String(previous.createdAt ?? "").trim() || nowIso(),
    updatedAt: nowIso(),
  };

  await ref.set(updated);
  clearNetworkAccessCachesFirestore();
  return updated;
}

export async function deleteOfficeNetworkFirestore(id: string): Promise<boolean> {
  await ensureNetworkAccessBootstrapped();
  const ref = getAdminFirestore().collection(OFFICE_COLLECTION).doc(id);
  const snap = await ref.get();
  if (!snap.exists) return false;
  await ref.delete();
  clearNetworkAccessCachesFirestore();
  return true;
}

export async function listRemoteAccessEmployeesFirestore(): Promise<RemoteAccessEmployee[]> {
  if (remoteAccessCache && Date.now() < remoteAccessCache.expiresAt) {
    return remoteAccessCache.value;
  }
  if (remoteAccessInflight) return remoteAccessInflight;

  remoteAccessInflight = (async () => {
    await ensureNetworkAccessBootstrapped();
    const snap = await getAdminFirestore().collection(REMOTE_COLLECTION).get();
    const value = snap.docs
      .map((doc) => {
        const data = doc.data() as Partial<RemoteAccessEmployee>;
        const employeeSheetRow = Number(data.employeeSheetRow ?? 0);
        const employeeName = String(data.employeeName ?? "").trim();
        if (!Number.isInteger(employeeSheetRow) || employeeSheetRow < 2 || !employeeName) {
          return null;
        }
        return {
          id: String(data.id ?? doc.id),
          employeeSheetRow,
          employeeId: String(data.employeeId ?? "").trim(),
          employeeName,
          createdAt: String(data.createdAt ?? ""),
        } satisfies RemoteAccessEmployee;
      })
      .filter((row): row is RemoteAccessEmployee => Boolean(row))
      .sort((a, b) => a.employeeName.localeCompare(b.employeeName));
    remoteAccessCache = { value, expiresAt: Date.now() + NETWORK_CACHE_TTL_MS };
    return value;
  })().finally(() => {
    remoteAccessInflight = null;
  });

  return remoteAccessInflight;
}

export async function addRemoteAccessEmployeeFirestore(input: {
  employeeSheetRow: number;
  employeeId: string;
  employeeName: string;
}): Promise<RemoteAccessEmployee> {
  await ensureNetworkAccessBootstrapped();
  const existing = await listRemoteAccessEmployeesFirestore();
  if (existing.some((row) => row.employeeSheetRow === input.employeeSheetRow)) {
    throw new Error("This employee is already allowed remote access");
  }

  const record: RemoteAccessEmployee = {
    id: randomUUID(),
    employeeSheetRow: input.employeeSheetRow,
    employeeId: input.employeeId.trim(),
    employeeName: input.employeeName.trim(),
    createdAt: nowIso(),
  };

  await getAdminFirestore().collection(REMOTE_COLLECTION).doc(record.id).set(record);
  clearNetworkAccessCachesFirestore();
  return record;
}

export async function removeRemoteAccessEmployeeFirestore(id: string): Promise<boolean> {
  await ensureNetworkAccessBootstrapped();
  const ref = getAdminFirestore().collection(REMOTE_COLLECTION).doc(id);
  const snap = await ref.get();
  if (!snap.exists) return false;
  await ref.delete();
  clearNetworkAccessCachesFirestore();
  return true;
}

export async function listCompanyWfhDaysFirestore(): Promise<CompanyWfhDay[]> {
  if (companyWfhCache && Date.now() < companyWfhCache.expiresAt) {
    return companyWfhCache.value;
  }
  if (companyWfhInflight) return companyWfhInflight;

  companyWfhInflight = (async () => {
    await ensureNetworkAccessBootstrapped();
    const snap = await getAdminFirestore().collection(COMPANY_WFH_COLLECTION).get();
    const value = snap.docs
      .map((doc) => {
        const data = doc.data() as Partial<CompanyWfhDay>;
        const date = normalizeDateOnly(String(data.date ?? doc.id));
        if (!date) return null;
        return {
          id: String(data.id ?? doc.id),
          date,
          note: String(data.note ?? "").trim(),
          createdAt: String(data.createdAt ?? ""),
          createdByName: String(data.createdByName ?? "").trim(),
        } satisfies CompanyWfhDay;
      })
      .filter((row): row is CompanyWfhDay => Boolean(row))
      .sort((a, b) => b.date.localeCompare(a.date));
    companyWfhCache = { value, expiresAt: Date.now() + NETWORK_CACHE_TTL_MS };
    return value;
  })().finally(() => {
    companyWfhInflight = null;
  });

  return companyWfhInflight;
}

export async function addCompanyWfhDayFirestore(input: {
  date: string;
  note?: string;
  createdByName?: string;
}): Promise<CompanyWfhDay> {
  await ensureNetworkAccessBootstrapped();
  const date = normalizeDateOnly(input.date);
  if (!date) {
    throw new Error("A valid WFH date (YYYY-MM-DD) is required");
  }

  const existing = await listCompanyWfhDaysFirestore();
  if (existing.some((row) => row.date === date)) {
    throw new Error("This date is already marked as a company WFH day");
  }

  const record: CompanyWfhDay = {
    id: date,
    date,
    note: String(input.note ?? "")
      .trim()
      .slice(0, 120),
    createdAt: nowIso(),
    createdByName: String(input.createdByName ?? "").trim(),
  };

  await getAdminFirestore().collection(COMPANY_WFH_COLLECTION).doc(date).set(record);
  clearNetworkAccessCachesFirestore();
  return record;
}

export async function removeCompanyWfhDayFirestore(id: string): Promise<boolean> {
  await ensureNetworkAccessBootstrapped();
  const key = normalizeDateOnly(id) || id.trim();
  if (!key) return false;
  const ref = getAdminFirestore().collection(COMPANY_WFH_COLLECTION).doc(key);
  const snap = await ref.get();
  if (!snap.exists) return false;
  await ref.delete();
  clearNetworkAccessCachesFirestore();
  return true;
}

/** True when restriction should be skipped for everyone on this calendar day. */
export async function isCompanyWfhDayFirestore(dateIso?: string): Promise<boolean> {
  const date = normalizeDateOnly(dateIso ?? localTodayIso());
  if (!date) return false;

  if (companyWfhCache && Date.now() < companyWfhCache.expiresAt) {
    return companyWfhCache.value.some((row) => row.date === date);
  }

  await ensureNetworkAccessBootstrapped();
  const snap = await getAdminFirestore().collection(COMPANY_WFH_COLLECTION).doc(date).get();
  return snap.exists;
}
