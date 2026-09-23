"use client";

import { MonitorSmartphone, Pencil, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";

import { SystemSpecsForm } from "@/components/system-specs/system-specs-form";
import { AccessDenied } from "@/components/ui/access-denied";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { useAuth } from "@/contexts/auth-provider";
import { useNotifications } from "@/contexts/notifications-provider";
import { readResponseJson } from "@/lib/api/read-response-json";
import { toUserFacingActionError, toUserFacingFetchError } from "@/lib/api/user-facing-error";
import { canManageEmployees } from "@/lib/auth/roles";
import { parseEmployeeListApiResponse } from "@/lib/employee";
import { ROLES } from "@/app/consts/common";
import {
  emptySystemSpecsForm,
  recordToFormState,
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
  keyboard: string;
  mouse: string;
  cpu: string;
  ramGb: string;
  username: string;
  password: string;
  status: "Submitted" | "Missing";
};

function deviceSummary(name: string, serial: string): string {
  const n = name.trim();
  const s = serial.trim();
  if (!n && !s) return "—";
  if (n && s) return `${n} (${s})`;
  return n || s;
}

export default function SystemSpecsAdminPage() {
  const { user, loading: authLoading } = useAuth();
  const { pushToast } = useNotifications();
  const canManage = user ? canManageEmployees(user.role) : false;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [specsByRow, setSpecsByRow] = useState<Map<number, SystemSpecsRecord>>(new Map());
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<EmployeeOption | null>(null);
  const [form, setForm] = useState<SystemSpecsFormState>(emptySystemSpecsForm());

  const loadAll = useCallback(async () => {
    if (!canManage) return;
    setLoading(true);
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
      setLoading(false);
    }
  }, [canManage]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load
    void loadAll();
  }, [loadAll]);

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
          laptop: specs
            ? deviceSummary(specs.laptop.name, specs.laptop.serialNumber)
            : "—",
          desktop: specs
            ? deviceSummary(specs.desktop.name, specs.desktop.serialNumber)
            : "—",
          keyboard: specs
            ? deviceSummary(specs.keyboard.name, specs.keyboard.serialNumber)
            : "—",
          mouse: specs
            ? deviceSummary(specs.mouse.name, specs.mouse.serialNumber)
            : "—",
          cpu: specs ? deviceSummary(specs.cpu.name, specs.cpu.serialNumber) : "—",
          ramGb: specs?.ramGb?.trim() || "—",
          username: specs?.loginUsername?.trim() || "—",
          password: specs?.loginPassword?.trim() || "—",
          status: specs ? "Submitted" : "Missing",
        };
      });
  }, [employees, specsByRow, query]);

  const columns = useMemo<Column<TableRow>[]>(
    () => [
      {
        key: "employeeName",
        header: "Employee",
        render: (row) => (
          <div>
            <p className="text-ex-primary font-medium">{row.employeeName}</p>
            <p className="text-ex-muted text-xs">{row.employeeId}</p>
          </div>
        ),
      },
      { key: "laptop", header: "Laptop" },
      { key: "desktop", header: "Desktop" },
      { key: "keyboard", header: "Keyboard" },
      { key: "mouse", header: "Mouse" },
      { key: "cpu", header: "CPU" },
      { key: "ramGb", header: "RAM (GB)" },
      { key: "username", header: "Login user" },
      { key: "password", header: "Password" },
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
              setForm(recordToFormState(specsByRow.get(emp.sheetRow) ?? null));
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

  const onSubmit = async (event: FormEvent) => {
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
          ...form,
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
      setEditing(null);
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

  if (!canManage) {
    return (
      <div className="space-y-6">
        <PageHeader title="System Specifications" />
        <AccessDenied description="Only HR and Super Admin can view all employee system specifications." />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="System Specifications"
        description="View and edit hardware and system login details for every employee."
      />

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      {editing ? (
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
            <div>
              <CardTitle>Edit — {editing.name}</CardTitle>
              <p className="text-ex-muted mt-1 text-sm">
                Update device names, serial numbers, and system login details.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setEditing(null);
                setForm(emptySystemSpecsForm());
              }}
            >
              Back to list
            </Button>
          </CardHeader>
          <CardContent>
            <SystemSpecsForm
              value={form}
              onChange={setForm}
              onSubmit={onSubmit}
              saving={saving}
              submitLabel="Save specifications"
            />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="flex flex-col gap-4 space-y-0 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <MonitorSmartphone className="text-ex-secondary size-5" />
              <CardTitle>All employees</CardTitle>
            </div>
            <div className="relative w-full sm:max-w-xs">
              <Search className="text-ex-muted pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
              <Input
                className="pl-9"
                placeholder="Search employee…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          </CardHeader>
          <CardContent>
            <DataTable
              columns={columns}
              rows={tableRows}
              loading={loading}
              emptyTitle="No employees found"
              emptyDescription="Active employees will appear here once loaded."
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
