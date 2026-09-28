import type {
  CompanyWfhDay,
  NetworkAccessSettings,
  OfficeNetwork,
  RemoteAccessEmployee,
} from "@/lib/network-access/types";
import {
  addCompanyWfhDayFirestore,
  addRemoteAccessEmployeeFirestore,
  clearNetworkAccessCachesFirestore,
  createOfficeNetworkFirestore,
  deleteOfficeNetworkFirestore,
  getNetworkAccessSettingsFirestore,
  isCompanyWfhDayFirestore,
  listCompanyWfhDaysFirestore,
  listOfficeNetworksFirestore,
  listRemoteAccessEmployeesFirestore,
  removeCompanyWfhDayFirestore,
  removeRemoteAccessEmployeeFirestore,
  setNetworkRestrictionEnabledFirestore,
  updateOfficeNetworkFirestore,
} from "./firestore";

/**
 * Network access (office Wi‑Fi allowlist, restriction toggle, WFH exemptions)
 * is stored in Firestore so HR / Super Admin can manage it without Sheets latency.
 * Login and `/api/auth/network-access` also read from this repository.
 */

export async function getNetworkAccessSettings(): Promise<NetworkAccessSettings> {
  return getNetworkAccessSettingsFirestore();
}

export async function setNetworkRestrictionEnabled(
  enabled: boolean,
): Promise<NetworkAccessSettings> {
  return setNetworkRestrictionEnabledFirestore(enabled);
}

export async function listOfficeNetworks(): Promise<OfficeNetwork[]> {
  return listOfficeNetworksFirestore();
}

export async function createOfficeNetwork(input: {
  label: string;
  ip: string;
}): Promise<OfficeNetwork> {
  return createOfficeNetworkFirestore(input);
}

export async function updateOfficeNetwork(input: {
  id: string;
  label: string;
  ip: string;
}): Promise<OfficeNetwork | null> {
  return updateOfficeNetworkFirestore(input);
}

export async function deleteOfficeNetwork(id: string): Promise<boolean> {
  return deleteOfficeNetworkFirestore(id);
}

export async function listRemoteAccessEmployees(): Promise<RemoteAccessEmployee[]> {
  return listRemoteAccessEmployeesFirestore();
}

export async function addRemoteAccessEmployee(input: {
  employeeSheetRow: number;
  employeeId: string;
  employeeName: string;
}): Promise<RemoteAccessEmployee> {
  return addRemoteAccessEmployeeFirestore(input);
}

export async function removeRemoteAccessEmployee(id: string): Promise<boolean> {
  return removeRemoteAccessEmployeeFirestore(id);
}

export function isEmployeeRemoteExempt(
  employees: RemoteAccessEmployee[],
  sheetRow: number | undefined,
  employeeId: string | undefined,
): boolean {
  if (sheetRow != null && employees.some((row) => row.employeeSheetRow === sheetRow)) {
    return true;
  }
  const id = employeeId?.trim();
  if (id && employees.some((row) => row.employeeId && row.employeeId === id)) {
    return true;
  }
  return false;
}

export async function listCompanyWfhDays(): Promise<CompanyWfhDay[]> {
  return listCompanyWfhDaysFirestore();
}

export async function addCompanyWfhDay(input: {
  date: string;
  note?: string;
  createdByName?: string;
}): Promise<CompanyWfhDay> {
  return addCompanyWfhDayFirestore(input);
}

export async function removeCompanyWfhDay(id: string): Promise<boolean> {
  return removeCompanyWfhDayFirestore(id);
}

export async function isCompanyWfhDay(dateIso?: string): Promise<boolean> {
  return isCompanyWfhDayFirestore(dateIso);
}

export function clearNetworkAccessCaches(): void {
  clearNetworkAccessCachesFirestore();
}
