import { ROLES } from "@/app/consts/common";
import {
  getEmployeeIdFromRow,
  isEmployeeStatusActive,
  sheetRowToForm,
} from "@/lib/employee";
import { listAllEmployeeRows } from "@/lib/employees/repository";

export type NotificationRecipient = {
  sheetRow: number;
  employeeId: string;
  name: string;
  role: string;
  birthdayDate: string;
  joiningDate: string;
  lastIncrementDate: string;
};

const ACTIVE_EMPLOYEES_CACHE_MS = 60 * 1000;
let activeEmployeesCache: {
  value: NotificationRecipient[];
  loadedAt: number;
} | null = null;
let activeEmployeesRequest: Promise<NotificationRecipient[]> | null = null;

/**
 * Active employees for notifications / announcements.
 * Uses the same employee source as All Employees (`DAILY_DATA_STORAGE`).
 */
export async function listActiveEmployees(): Promise<NotificationRecipient[]> {
  if (
    activeEmployeesCache &&
    Date.now() - activeEmployeesCache.loadedAt < ACTIVE_EMPLOYEES_CACHE_MS
  ) {
    return activeEmployeesCache.value;
  }
  if (activeEmployeesRequest) return activeEmployeesRequest;

  activeEmployeesRequest = (async () => {
    const records = await listAllEmployeeRows();
    const recipients: NotificationRecipient[] = [];

    for (const record of records) {
      const form = sheetRowToForm(record.headers, record.row);
      if (!isEmployeeStatusActive(form.status)) continue;

      recipients.push({
        sheetRow: record.sheetRow,
        employeeId: getEmployeeIdFromRow(record.headers, record.row, record.sheetRow),
        name: form.name.trim() || "Employee",
        role: form.role.trim().toLowerCase(),
        birthdayDate: form.birthdayDate.trim(),
        joiningDate: form.joiningDate.trim(),
        lastIncrementDate: form.lastIncrementDate.trim(),
      });
    }

    activeEmployeesCache = { value: recipients, loadedAt: Date.now() };
    return recipients;
  })().finally(() => {
    activeEmployeesRequest = null;
  });

  return activeEmployeesRequest;
}

export async function listHrAndSuperAdminRecipients(): Promise<NotificationRecipient[]> {
  const employees = await listActiveEmployees();
  return employees.filter(
    (employee) => employee.role === ROLES.HR_MANAGER || employee.role === ROLES.SUPER_ADMIN,
  );
}

/** Call after employee roster changes so announcement recipients stay fresh. */
export function clearActiveEmployeesCache(): void {
  activeEmployeesCache = null;
}
