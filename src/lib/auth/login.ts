import { ROLES } from "@/app/consts/common";
import {
  headerToFormKey,
  isEmployeeStatusActive,
  sheetRowToForm,
  sheetRowToRange,
} from "@/lib/employee";
import { findEmployeeByLogin, updateEmployeeRow } from "@/lib/employees/repository";
import type { SessionUser, UserRole } from "@/types/auth";

import { upgradePlainPasswordInSheet } from "./credentials-setup";
import { isBcryptHash, verifyPassword } from "./password";

export type AuthenticateResult =
  | { ok: true; user: SessionUser }
  | { ok: false; reason: "invalid_credentials" | "account_inactive" };

function normalizeUserRole(value: string): UserRole | null {
  const role = value.trim().toLowerCase();
  if (role === ROLES.SUPER_ADMIN) return ROLES.SUPER_ADMIN;
  if (role === ROLES.HR_MANAGER) return ROLES.HR_MANAGER;
  if (role === ROLES.EMPLOYEE) return ROLES.EMPLOYEE;
  if (role === ROLES.INTERN) return ROLES.INTERN;
  return null;
}

/**
 * Authenticate against employee records (Firebase when configured, else Google Sheets).
 * Login identifier may be work email or username (case-insensitive).
 */
export async function authenticateFromSheet(
  login: string,
  password: string,
): Promise<AuthenticateResult> {
  const loginNorm = login.trim().toLowerCase();
  if (!loginNorm || !password) {
    return { ok: false, reason: "invalid_credentials" };
  }

  const record = await findEmployeeByLogin(login);
  if (!record) {
    return { ok: false, reason: "invalid_credentials" };
  }

  const { headers, row, sheetRow } = record;
  const form = sheetRowToForm(headers, row);

  const email = form.email.trim().toLowerCase();
  const username = form.username.trim().toLowerCase();
  const matchesLogin = (email && email === loginNorm) || (username && username === loginNorm);
  if (!matchesLogin) {
    return { ok: false, reason: "invalid_credentials" };
  }

  const storedPassword = form.password.trim();
  if (!storedPassword) {
    return { ok: false, reason: "invalid_credentials" };
  }

  const valid = await verifyPassword(password, storedPassword);
  if (!valid) {
    return { ok: false, reason: "invalid_credentials" };
  }

  const statusIndex = headers.findIndex((h) => headerToFormKey(h) === "status");
  const rawStatus = statusIndex >= 0 ? String(row[statusIndex] ?? "") : "";
  if (!isEmployeeStatusActive(rawStatus)) {
    return { ok: false, reason: "account_inactive" };
  }

  if (!isBcryptHash(storedPassword)) {
    try {
      await upgradePlainPasswordInSheet(
        headers,
        row,
        sheetRow,
        password,
        async (range, values) => {
          await updateEmployeeRow(sheetRow, values[0] ?? row);
        },
        sheetRowToRange,
      );
    } catch (error) {
      console.error("Failed to upgrade plain password to bcrypt:", error);
    }
  }

  const role = normalizeUserRole(form.role);
  if (!role) {
    return { ok: false, reason: "invalid_credentials" };
  }

  const name = form.name.trim() || username || email;
  const id = form.employeeId.trim() || (email ? email : username) || `row-${sheetRow}`;

  return {
    ok: true,
    user: {
      id,
      email: form.email.trim() || email || username,
      name,
      role,
      department: form.position.trim() || undefined,
      sheetRow,
    },
  };
}
