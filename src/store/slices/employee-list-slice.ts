import { createAsyncThunk, createSlice, type PayloadAction } from "@reduxjs/toolkit";

import { ROLES, STATUS } from "@/app/consts/common";
import { readResponseJson } from "@/lib/api/read-response-json";
import { toUserFacingFetchError } from "@/lib/api/user-facing-error";
import {
  isAccountInactiveRedirectError,
  isAccountInactiveRedirectPending,
} from "@/lib/account-inactive-client";
import { parseEmployeeListApiResponse } from "@/lib/employee";
import type { UserRole } from "@/types/auth";
import type { Employee, EmployeeStatus } from "@/types/employee";

type EmployeeListState = {
  items: Employee[];
  loading: boolean;
  offboarding: boolean;
  error: string | null;
};

const initialState: EmployeeListState = {
  items: [],
  loading: false,
  offboarding: false,
  error: null,
};

type EmployeeListRootState = { employeeList: EmployeeListState };

async function fetchEmployeeListPage(page: number, pageSize: number) {
  const params = new URLSearchParams({
    sortBy: "name",
    order: "asc",
    page: String(page),
    pageSize: String(pageSize),
  });
  const response = await fetch(`/api/employee?${params}`);
  const result = await readResponseJson<{
    success?: boolean;
    message?: string;
    data?: string[][];
    sheetRows?: number[];
    pagination?: { page?: number; pageSize?: number; total?: number; totalPages?: number };
  }>(response, "fetch");

  if (!response.ok || !result.success) {
    throw new Error(result.message ?? "Failed to load employees");
  }

  return {
    items: parseEmployeeListApiResponse({
      success: result.success,
      data: result.data,
      sheetRows: result.sheetRows,
    }),
    totalPages: result.pagination?.totalPages ?? 1,
  };
}

export type OffboardEmployeePayload = {
  sheetRow: string;
  lastWorkingDay: string;
  reason: string;
};

export const offboardEmployee = createAsyncThunk(
  "employeeList/offboard",
  async (payload: OffboardEmployeePayload) => {
    const response = await fetch("/api/employee/offboard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sheetRow: Number(payload.sheetRow),
        lastWorkingDay: payload.lastWorkingDay,
        reason: payload.reason,
      }),
    });
    const result = await readResponseJson<{ success?: boolean; message?: string }>(
      response,
      "action",
    );

    if (!response.ok || !result.success) {
      throw new Error(result.message ?? "Failed to offboard employee");
    }

    return payload.sheetRow;
  },
);

export const fetchEmployeeList = createAsyncThunk("employeeList/fetchAll", async () => {
  const pageSize = 100;
  const first = await fetchEmployeeListPage(1, pageSize);
  const allItems = [...first.items];

  for (let page = 2; page <= first.totalPages; page++) {
    const next = await fetchEmployeeListPage(page, pageSize);
    allItems.push(...next.items);
  }

  return allItems;
});

function canViewInactiveEmployees(role: UserRole | null | undefined): boolean {
  return role === ROLES.HR_MANAGER || role === ROLES.SUPER_ADMIN;
}

export function selectEmployeeListItems(state: EmployeeListRootState): Employee[] {
  return state.employeeList.items;
}

export function selectEmployeeListLoading(state: EmployeeListRootState): boolean {
  return state.employeeList.loading;
}

export function selectEmployeeOffboarding(state: EmployeeListRootState): boolean {
  return state.employeeList.offboarding;
}

export function selectEmployeeListError(state: EmployeeListRootState): string | null {
  return state.employeeList.error;
}

/** Employees visible in offboarding picker for the current viewer role. */
export function selectOffboardingEmployeeOptions(
  state: EmployeeListRootState,
  viewerRole: UserRole | null | undefined,
): Employee[] {
  const items = state.employeeList.items;
  if (canViewInactiveEmployees(viewerRole)) return items;
  return items.filter((item) => item.status === STATUS.ACTIVE);
}

export function isEmployeeInactive(status: string): boolean {
  return status === STATUS.INACTIVE;
}

export function formatEmployeeRole(role: string): string {
  if (!role) return "";
  return role.split("_").join(" ");
}

const employeeListSlice = createSlice({
  name: "employeeList",
  initialState,
  reducers: {
    clearEmployeeListError(state) {
      state.error = null;
    },
    resetEmployeeList() {
      return initialState;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchEmployeeList.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchEmployeeList.fulfilled, (state, action: PayloadAction<Employee[]>) => {
        state.loading = false;
        state.items = action.payload;
      })
      .addCase(fetchEmployeeList.rejected, (state, action) => {
        state.loading = false;
        if (isAccountInactiveRedirectPending() || isAccountInactiveRedirectError(action.error)) {
          return;
        }
        state.error = toUserFacingFetchError(action.error.message);
      })
      .addCase(offboardEmployee.pending, (state) => {
        state.offboarding = true;
        state.error = null;
      })
      .addCase(offboardEmployee.fulfilled, (state, action) => {
        state.offboarding = false;
        const sheetRow = action.payload;
        const employee = state.items.find((item) => item.sheetRow === sheetRow);
        if (employee) {
          employee.status = STATUS.INACTIVE as EmployeeStatus;
        }
      })
      .addCase(offboardEmployee.rejected, (state) => {
        state.offboarding = false;
        // Errors are shown via toast on the offboarding page — do not set helper text.
      });
  },
});

export const { clearEmployeeListError, resetEmployeeList } = employeeListSlice.actions;
export default employeeListSlice.reducer;
