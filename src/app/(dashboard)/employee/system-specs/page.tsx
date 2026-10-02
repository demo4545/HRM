"use client";

import { ArrowLeft, MonitorSmartphone, Pencil, Search, UserRound } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";

import { SystemSpecsForm } from "@/components/system-specs/system-specs-form";
import { AccessDenied } from "@/components/ui/access-denied";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { DEFAULT_PAGE_SIZE, Pagination } from "@/components/ui/pagination";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/auth-provider";
import { useNotifications } from "@/contexts/notifications-provider";
import { ROLES } from "@/app/consts/common";
import { readResponseJson } from "@/lib/api/read-response-json";
import { toUserFacingActionError, toUserFacingFetchError } from "@/lib/api/user-facing-error";
import { canManageEmployees } from "@/lib/auth/roles";
import { parseEmployeeListApiResponse } from "@/lib/employee";
import {
  emptySystemSpecsForm,
  recordToFormState,
  summarizeDevices,
  summarizeLogins,
  type SystemSpecsFormState,
  type SystemSpecsRecord,
} from "@/lib/system-specs/types";
import type { Column } from "@/types/table";

type EmployeeOption = {
  sheetRow: number;
  employeeId: string;
  name: string;
  role: string;
};

type TableRow = {
  id: string;
  employeeName: string;
  employeeId: string;
  sheetRow: number;
  laptop: string;
  desktop: string;
  screen: string;
  keyboard: string;
  mouse: string;
  cpu: string;
  ramGb: string;
  username: string;
  password: string;
  status: "Submitted" | "Missing";
};

type ManagerPanel = "table" | "own-form" | "edit-employee";

function SystemSpecsFormSkeleton() {
  return (
    <div className="space-y-6" aria-busy aria-live="polite" aria-label="Loading specifications">
      <div className="grid gap-5 sm:grid-cols-2">
        {Array.from({ length: 5 }).map((_, index) => (
          <div key={index} className="border-ex-border space-y-3 rounded-xl border p-4">
            <div className="flex items-center justify-between gap-2">
              <Skeleton className="h-4 w-24 rounded-md" />
              <Skeleton className="h-8 w-16 rounded-lg" />
            </div>
            <div className="border-ex-border space-y-3 rounded-lg border border-dashed p-3">
              <Skeleton className="h-3 w-20 rounded-md" />
              <div className="space-y-1.5">
                <Skeleton className="h-3 w-12 rounded-md" />
                <Skeleton className="h-10 w-full rounded-lg" />
              </div>
              <div className="space-y-1.5">
                <Skeleton className="h-3 w-24 rounded-md" />
                <Skeleton className="h-10 w-full rounded-lg" />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="border-ex-border space-y-4 rounded-xl border p-4">
        <div className="flex items-center justify-between gap-2">
          <Skeleton className="h-4 w-36 rounded-md" />
          <Skeleton className="h-8 w-16 rounded-lg" />
        </div>
        <div className="border-ex-border space-y-3 rounded-lg border border-dashed p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Skeleton className="h-3 w-16 rounded-md" />
              <Skeleton className="h-10 w-full rounded-lg" />
            </div>
            <div className="space-y-1.5">
              <Skeleton className="h-3 w-20 rounded-md" />
              <Skeleton className="h-10 w-full rounded-lg" />
            </div>
          </div>
        </div>
      </div>

      <Skeleton className="h-10 w-44 rounded-lg" />
    </div>
  );
}

export default function SystemSpecsPage() {
  const { user, loading: authLoading } = useAuth();
  const { pushToast } = useNotifications();

  const canManage = user ? canManageEmployees(user.role) : false;
  const isSuperAdmin = user?.role === ROLES.SUPER_ADMIN;
  const isHr = user?.role === ROLES.HR_MANAGER;
  const isStaff = Boolean(user && !canManage);

  const [panel, setPanel] = useState<ManagerPanel>("table");
  const [tableLoading, setTableLoading] = useState(false);
  const [ownLoading, setOwnLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [specsByRow, setSpecsByRow] = useState<Map<number, SystemSpecsRecord>>(new Map());
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<EmployeeOption | null>(null);

  const [ownForm, setOwnForm] = useState<SystemSpecsFormState>(emptySystemSpecsForm());
  const [editForm, setEditForm] = useState<SystemSpecsFormState>(emptySystemSpecsForm());
  const [hasOwnExisting, setHasOwnExisting] = useState(false);
  const [ownLoaded, setOwnLoaded] = useState(false);

  const loadTable = useCallback(async () => {
    if (!canManage) return;
    setTableLoading(true);
    setError(null);
    try {
      const [specsRes, employeesRes] = await Promise.all([
        fetch("/api/system-specs", { credentials: "include", cache: "no-store" }),
        fetch("/api/employee?pageSize=200&status=Active", {
          credentials: "include",
          cache: "no-store",
        }),
      ]);

      const specsJson = await readResponseJson<{
        success?: boolean;
        message?: string;
        specs?: SystemSpecsRecord[];
      }>(specsRes, "fetch");
      const employeesJson = await readResponseJson<{
        success?: boolean;
        message?: string;
        data?: string[][];
        sheetRows?: number[];
      }>(employeesRes, "fetch");

      if (!specsJson.success) {
        throw new Error(specsJson.message ?? "Failed to load system specifications");
      }

      const map = new Map<number, SystemSpecsRecord>();
      for (const row of specsJson.specs ?? []) {
        map.set(row.employeeSheetRow, row);
      }
      setSpecsByRow(map);
      setEmployees(
        parseEmployeeListApiResponse(employeesJson)
          .map((row) => ({
            sheetRow: Number(row.sheetRow),
            employeeId: row.employeeId,
            name: row.name,
            role: row.role,
          }))
          .filter(
            (row) =>
              Number.isInteger(row.sheetRow) &&
              row.sheetRow >= 2 &&
              row.name.trim() &&
              row.role !== ROLES.SUPER_ADMIN,
          )
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
    } catch (err) {
      setError(toUserFacingFetchError(err));
    } finally {
      setTableLoading(false);
    }
  }, [canManage]);

  const loadOwn = useCallback(async () => {
    if (!user || isSuperAdmin) return;
    setOwnLoading(true);
    try {
      const res = await fetch("/api/system-specs?me=1", {
        credentials: "include",
        cache: "no-store",
      });
      const json = await readResponseJson<{
        success?: boolean;
        message?: string;
        specs?: SystemSpecsRecord | null;
      }>(res, "fetch");

      if (!json.success) {
        throw new Error(json.message ?? "Failed to load your system specifications");
      }

      setOwnForm(recordToFormState(json.specs ?? null));
      setHasOwnExisting(Boolean(json.specs));
      setOwnLoaded(true);
    } catch (err) {
      pushToast({
        title: "Could Not Load Specifications",
        body: toUserFacingFetchError(err),
        variant: "error",
      });
    } finally {
      setOwnLoading(false);
    }
  }, [user, isSuperAdmin, pushToast]);

  useEffect(() => {
    if (authLoading || !user) return;
    if (canManage) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- role-based initial load
      void loadTable();
      return;
    }
    void loadOwn();
  }, [authLoading, user, canManage, loadTable, loadOwn]);

  const openOwnForm = async () => {
    setPanel("own-form");
    setError(null);
    if (!ownLoaded) {
      await loadOwn();
    }
  };

  const backToTable = () => {
    setPanel("table");
    setEditing(null);
    setEditForm(emptySystemSpecsForm());
    setError(null);
  };

  const tableRows = useMemo<TableRow[]>(() => {
    const q = query.trim().toLowerCase();
    return employees
      .filter((emp) => {
        if (!q) return true;
        return (
          emp.name.toLowerCase().includes(q) ||
          emp.employeeId.toLowerCase().includes(q) ||
          String(emp.sheetRow).includes(q)
        );
      })
      .map((emp) => {
        const specs = specsByRow.get(emp.sheetRow);
        return {
          id: String(emp.sheetRow),
          employeeName: emp.name,
          employeeId: emp.employeeId || "—",
          sheetRow: emp.sheetRow,
          laptop: specs ? summarizeDevices(specs.laptop) : "—",
          desktop: specs ? summarizeDevices(specs.desktop) : "—",
          screen: specs ? summarizeDevices(specs.screen) : "—",
          keyboard: specs ? summarizeDevices(specs.keyboard) : "—",
          mouse: specs ? summarizeDevices(specs.mouse) : "—",
          cpu: specs ? summarizeDevices(specs.cpu) : "—",
          ramGb: specs?.ramGb?.trim() || "—",
          username: specs ? summarizeLogins(specs.logins, "username") : "—",
          password: specs ? summarizeLogins(specs.logins, "password") : "—",
          status: specs ? "Submitted" : "Missing",
        };
      });
  }, [employees, specsByRow, query]);

  const totalPages = Math.max(1, Math.ceil(tableRows.length / DEFAULT_PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paginatedRows = useMemo(
    () =>
      tableRows.slice((currentPage - 1) * DEFAULT_PAGE_SIZE, currentPage * DEFAULT_PAGE_SIZE),
    [tableRows, currentPage],
  );

  const columns = useMemo<Column<TableRow>[]>(
    () => [
      {
        key: "employeeName",
        header: "Employee",
        render: (row) => (
          <div>
            <p className="text-ex-primary font-medium">{row.employeeName}</p>
          </div>
        ),
      },
      {
        key: "laptop",
        header: "Laptop",
        render: (row) => <span className="whitespace-pre-wrap">{row.laptop}</span>,
      },
      {
        key: "desktop",
        header: "Monitor",
        render: (row) => <span className="whitespace-pre-wrap">{row.desktop}</span>,
      },
      {
        key: "keyboard",
        header: "Keyboard",
        render: (row) => <span className="whitespace-pre-wrap">{row.keyboard}</span>,
      },
      {
        key: "mouse",
        header: "Mouse",
        render: (row) => <span className="whitespace-pre-wrap">{row.mouse}</span>,
      },
      {
        key: "cpu",
        header: "CPU",
        render: (row) => <span className="whitespace-pre-wrap">{row.cpu}</span>,
      },
      { key: "ramGb", header: "RAM (GB)" },
      {
        key: "username",
        header: "Login user",
        render: (row) => <span className="whitespace-pre-wrap">{row.username}</span>,
      },
      {
        key: "password",
        header: "Password",
        render: (row) => <span className="whitespace-pre-wrap">{row.password}</span>,
      },
      {
        key: "status",
        header: "Status",
        render: (row) => (
          <Badge variant={row.status === "Submitted" ? "success" : "warning"}>{row.status}</Badge>
        ),
      },
      {
        key: "actions",
        header: "Actions",
        sticky: "right",
        render: (row) => (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              const emp = employees.find((e) => e.sheetRow === row.sheetRow);
              if (!emp) return;
              setEditing(emp);
              setEditForm(recordToFormState(specsByRow.get(emp.sheetRow) ?? null));
              setPanel("edit-employee");
              setError(null);
            }}
          >
            <Pencil className="size-3.5" />
            Edit
          </Button>
        ),
      },
    ],
    [employees, specsByRow],
  );

  const onSubmitOwn = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const res = await fetch("/api/system-specs", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ me: true, ...ownForm }),
      });
      const json = await readResponseJson<{
        success?: boolean;
        message?: string;
        specs?: SystemSpecsRecord;
      }>(res, "action");
      if (!json.success || !json.specs) {
        throw new Error(json.message ?? "Failed to save");
      }
      setOwnForm(recordToFormState(json.specs));
      setHasOwnExisting(true);
      setSpecsByRow((prev) => {
        const next = new Map(prev);
        next.set(json.specs!.employeeSheetRow, json.specs!);
        return next;
      });
      pushToast({
        title: "Specifications Saved",
        body: "Your system specifications were saved successfully.",
        variant: "success",
      });
      window.scrollTo({ top: 0, behavior: "smooth" });
      if (isHr) {
        setPanel("table");
      }
    } catch (err) {
      pushToast({
        title: "Save Failed",
        body: toUserFacingActionError(err),
        variant: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  const onSubmitEdit = async (event: FormEvent) => {
    event.preventDefault();
    if (!editing) return;
    const employeeName = editing.name;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/system-specs", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeSheetRow: editing.sheetRow,
          employeeId: editing.employeeId,
          employeeName: editing.name,
          ...editForm,
        }),
      });
      const json = await readResponseJson<{
        success?: boolean;
        message?: string;
        specs?: SystemSpecsRecord;
      }>(res, "action");
      if (!json.success || !json.specs) {
        throw new Error(json.message ?? "Failed to save");
      }
      setSpecsByRow((prev) => {
        const next = new Map(prev);
        next.set(json.specs!.employeeSheetRow, json.specs!);
        return next;
      });
      backToTable();
      pushToast({
        title: "Specifications saved",
        body: `System specifications for ${employeeName} were saved successfully.`,
        variant: "success",
      });
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      pushToast({
        title: "Save failed",
        body: toUserFacingActionError(err),
        variant: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  if (authLoading) return null;

  if (!user) {
    return (
      <div className="space-y-6">
        <PageHeader title="System Specifications" />
        <AccessDenied />
      </div>
    );
  }

  // Employees / interns: own form only (unchanged experience).
  if (isStaff) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="System Specifications"
          description="Add or update your workstation hardware details and system login credentials."
        />

        <Card>
          <CardHeader>
            <CardTitle>
              {hasOwnExisting ? "Edit Your Specifications" : "Add Your Specifications"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {ownLoading || !ownLoaded ? (
              <SystemSpecsFormSkeleton />
            ) : (
              <SystemSpecsForm
                value={ownForm}
                onChange={setOwnForm}
                onSubmit={onSubmitOwn}
                saving={saving}
                submitLabel={hasOwnExisting ? "Update Specifications" : "Save Specifications"}
              />
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  // HR + Super Admin share the employee table. Only HR can open their own form.
  return (
    <div className="space-y-6">
      <PageHeader
        title="System Specifications"
        description={
          isHr
            ? "Review employee workstation details, or add your own specifications."
            : "View and edit hardware and system login details for every employee."
        }
        actions={
          isHr && panel === "table" ? (
            <Button type="button" variant="outline" onClick={() => void openOwnForm()}>
              <UserRound className="size-4" />
              My Specifications
            </Button>
          ) : undefined
        }
      />

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      {panel === "own-form" && isHr ? (
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
            <div>
              <CardTitle>
                {hasOwnExisting ? "Edit Your Specifications" : "Add Your Specifications"}
              </CardTitle>
              <p className="text-ex-muted mt-1 text-sm">
                Add or update your own workstation hardware and login details.
              </p>
            </div>
            <Button type="button" variant="outline" onClick={backToTable}>
              <ArrowLeft className="size-4" />
              Back to List
            </Button>
          </CardHeader>
          <CardContent>
            {ownLoading || !ownLoaded ? (
              <SystemSpecsFormSkeleton />
            ) : (
              <SystemSpecsForm
                value={ownForm}
                onChange={setOwnForm}
                onSubmit={onSubmitOwn}
                saving={saving}
                submitLabel={hasOwnExisting ? "Update Specifications" : "Save Specifications"}
              />
            )}
          </CardContent>
        </Card>
      ) : null}

      {panel === "edit-employee" && editing ? (
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
            <div>
              <CardTitle>Edit — {editing.name}</CardTitle>
              <p className="text-ex-muted mt-1 text-sm">
                Update device names, serial numbers, and system login details.
              </p>
            </div>
            <Button type="button" variant="outline" onClick={backToTable}>
              <ArrowLeft className="size-4" />
              Back to List
            </Button>
          </CardHeader>
          <CardContent>
            <SystemSpecsForm
              value={editForm}
              onChange={setEditForm}
              onSubmit={onSubmitEdit}
              saving={saving}
              submitLabel="Save Specifications"
            />
          </CardContent>
        </Card>
      ) : null}

      {panel === "table" ? (
        <Card>
          <CardHeader className="flex flex-col gap-4 space-y-0 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <MonitorSmartphone className="text-ex-secondary size-5" />
              <CardTitle>All Employees</CardTitle>
            </div>
            <div className="relative w-full sm:max-w-xs">
              <Search className="text-ex-muted pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
              <Input
                className="pl-9"
                placeholder="Search Employee…"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(1);
                }}
              />
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <DataTable
              columns={columns}
              rows={paginatedRows}
              loading={tableLoading}
              emptyTitle="No Employees Found"
              emptyDescription="Active Employees Will Appear Here Once Loaded."
            />
            {!tableLoading && tableRows.length > DEFAULT_PAGE_SIZE ? (
              <Pagination
                pagination={{
                  page: currentPage,
                  totalPages,
                  total: tableRows.length,
                  pageSize: DEFAULT_PAGE_SIZE,
                }}
                onPageChange={setPage}
                itemLabel="employees"
              />
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
