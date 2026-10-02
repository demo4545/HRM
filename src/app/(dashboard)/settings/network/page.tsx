"use client";

import { readResponseJson } from "@/lib/api/read-response-json";
import { Pencil, Plus, Trash2, Wifi } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { useAuth } from "@/contexts/auth-provider";
import { canManageEmployees } from "@/lib/auth/roles";
import { toUserFacingActionError, toUserFacingFetchError } from "@/lib/api/user-facing-error";
import { parseEmployeeListApiResponse } from "@/lib/employee";
import { fetchPublicIpv4FromBrowser } from "@/lib/network-access/ip";
import { localTodayIso } from "@/lib/attendance/manual-entry";
import type {
  CompanyWfhDay,
  OfficeNetwork,
  RemoteAccessEmployee,
} from "@/lib/network-access/types";

type EmployeeOption = {
  sheetRow: number;
  employeeId: string;
  name: string;
};

type PendingDelete =
  | { kind: "network"; network: OfficeNetwork }
  | { kind: "remote"; employee: RemoteAccessEmployee }
  | { kind: "wfh"; day: CompanyWfhDay };

function formatWfhDate(value: string): string {
  const raw = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return value;
  const date = new Date(`${raw}T12:00:00`);
  if (Number.isNaN(date.getTime())) return raw;
  return new Intl.DateTimeFormat("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

export default function NetworkAccessSettingsPage() {
  const { user } = useAuth();
  const canManage = user ? canManageEmployees(user.role) : false;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [restrictionEnabled, setRestrictionEnabled] = useState(false);
  const [networks, setNetworks] = useState<OfficeNetwork[]>([]);
  const [remoteEmployees, setRemoteEmployees] = useState<RemoteAccessEmployee[]>([]);
  const [companyWfhDays, setCompanyWfhDays] = useState<CompanyWfhDay[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [clientIp, setClientIp] = useState("");
  const [serverClientIp, setServerClientIp] = useState("");

  const [label, setLabel] = useState("");
  const [ip, setIp] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);

  const [remoteSheetRow, setRemoteSheetRow] = useState("");
  const [wfhDate, setWfhDate] = useState(localTodayIso());
  const [wfhNote, setWfhNote] = useState("");
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);

  const remoteSheetRows = useMemo(
    () => new Set(remoteEmployees.map((row) => row.employeeSheetRow)),
    [remoteEmployees],
  );

  const availableEmployees = useMemo(
    () => employees.filter((row) => !remoteSheetRows.has(row.sheetRow)),
    [employees, remoteSheetRows],
  );

  const loadAll = useCallback(async () => {
    if (!canManage) return;
    setLoading(true);
    setError(null);
    try {
      const [networksRes, settingsRes, wfhRes, employeesRes, publicIp] = await Promise.all([
        fetch("/api/network-access/office-networks", { credentials: "include", cache: "no-store" }),
        fetch("/api/network-access/settings", { credentials: "include", cache: "no-store" }),
        fetch("/api/network-access/company-wfh-days", { credentials: "include", cache: "no-store" }),
        fetch("/api/employee?pageSize=200&status=Active", {
          credentials: "include",
          cache: "no-store",
        }),
        fetchPublicIpv4FromBrowser().catch(() => ""),
      ]);

      const networksJson = await readResponseJson<{
        success: boolean;
        message?: string;
        networks?: OfficeNetwork[];
        clientIp?: string;
      }>(networksRes, "fetch");
      const settingsJson = await readResponseJson<{
        success: boolean;
        message?: string;
        settings?: { restrictionEnabled?: boolean };
        remoteEmployees?: RemoteAccessEmployee[];
      }>(settingsRes, "fetch");
      const wfhJson = await readResponseJson<{
        success: boolean;
        message?: string;
        companyWfhDays?: CompanyWfhDay[];
      }>(wfhRes, "fetch");
      const employeesJson = await readResponseJson<{
        success?: boolean;
        message?: string;
        data?: string[][];
        sheetRows?: number[];
      }>(employeesRes, "fetch");

      if (!networksJson.success) {
        throw new Error(networksJson.message ?? "Failed to load office networks");
      }
      if (!settingsJson.success) {
        throw new Error(settingsJson.message ?? "Failed to load network settings");
      }
      if (!wfhJson.success) {
        throw new Error(wfhJson.message ?? "Failed to load company WFH days");
      }

      setNetworks(networksJson.networks ?? []);
      setServerClientIp(networksJson.clientIp?.trim() ?? "");
      setClientIp(publicIp || networksJson.clientIp?.trim() || "");
      setRestrictionEnabled(Boolean(settingsJson.settings?.restrictionEnabled));
      setRemoteEmployees(settingsJson.remoteEmployees ?? []);
      setCompanyWfhDays(wfhJson.companyWfhDays ?? []);
      setEmployees(
        parseEmployeeListApiResponse(employeesJson)
          .map((row) => ({
            sheetRow: Number(row.sheetRow),
            employeeId: row.employeeId,
            name: row.name,
          }))
          .filter((row) => Number.isInteger(row.sheetRow) && row.sheetRow >= 2 && row.name.trim())
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
    } catch (err) {
      setError(toUserFacingFetchError(err));
    } finally {
      setLoading(false);
    }
  }, [canManage]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial / refresh load
    void loadAll();
  }, [loadAll]);

  const resetIpForm = () => {
    setEditingId(null);
    setLabel("");
    setIp("");
  };

  const startEdit = (network: OfficeNetwork) => {
    setEditingId(network.id);
    setLabel(network.label);
    setIp(network.ip);
    setMessage(null);
    setError(null);
  };

  const saveNetwork = async (opts?: { useCurrentIp?: boolean; labelOverride?: string }) => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const useCurrentIp = Boolean(opts?.useCurrentIp);
      const nextLabel = (opts?.labelOverride ?? label).trim();
      let nextIp = ip.trim();

      // Resolve public IP in the browser — localhost has no x-forwarded-for on the server.
      if (useCurrentIp && !editingId) {
        nextIp = clientIp || (await fetchPublicIpv4FromBrowser());
      }

      const payload = editingId
        ? { id: editingId, label: nextLabel, ip: nextIp }
        : {
            label: nextLabel || (useCurrentIp ? "Office Wi‑Fi" : ""),
            ip: nextIp,
          };

      const res = await fetch("/api/network-access/office-networks", {
        method: editingId ? "PATCH" : "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await readResponseJson<{ success: boolean; message?: string }>(res, "fetch");
      if (!json.success) throw new Error(json.message ?? "Failed to save network");

      resetIpForm();
      setMessage(editingId ? "Office IP updated." : "Office IP added.");
      await loadAll();
    } catch (err) {
      setError(toUserFacingActionError(err));
    } finally {
      setSaving(false);
    }
  };

  const deleteNetwork = async (network: OfficeNetwork) => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/network-access/office-networks", {
        method: "DELETE",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: network.id }),
      });
      const json = await readResponseJson<{ success: boolean; message?: string }>(res, "action");
      if (!json.success) throw new Error(json.message ?? "Failed to delete network");
      if (editingId === network.id) resetIpForm();
      setPendingDelete(null);
      setMessage("Office IP removed.");
      await loadAll();
    } catch (err) {
      setError(toUserFacingActionError(err));
    } finally {
      setSaving(false);
    }
  };

  const toggleRestriction = async (enabled: boolean) => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/network-access/settings", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ restrictionEnabled: enabled }),
      });
      const json = await readResponseJson<{ success: boolean; message?: string }>(res, "action");
      if (!json.success) throw new Error(json.message ?? "Failed to update setting");
      setRestrictionEnabled(enabled);
      setMessage(enabled ? "Office Wi‑Fi restriction enabled." : "Restriction disabled.");
    } catch (err) {
      setError(toUserFacingActionError(err));
    } finally {
      setSaving(false);
    }
  };

  const addRemoteEmployee = async () => {
    const sheetRow = Number(remoteSheetRow);
    const employee = employees.find((row) => row.sheetRow === sheetRow);
    if (!employee) {
      setError("Select an employee");
      return;
    }

    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/network-access/settings", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeSheetRow: employee.sheetRow,
          employeeId: employee.employeeId,
          employeeName: employee.name,
        }),
      });
      const json = await readResponseJson<{ success: boolean; message?: string }>(res, "action");
      if (!json.success) throw new Error(json.message ?? "Failed to add remote employee");
      setRemoteSheetRow("");
      setMessage(`${employee.name} can now access from any network.`);
      await loadAll();
    } catch (err) {
      setError(toUserFacingActionError(err));
    } finally {
      setSaving(false);
    }
  };

  const removeRemoteEmployee = async (row: RemoteAccessEmployee) => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/network-access/settings", {
        method: "DELETE",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: row.id }),
      });
      const json = await readResponseJson<{ success: boolean; message?: string }>(res, "action");
      if (!json.success) throw new Error(json.message ?? "Failed to remove remote employee");
      setPendingDelete(null);
      setMessage("Remote access removed.");
      await loadAll();
    } catch (err) {
      setError(toUserFacingActionError(err));
    } finally {
      setSaving(false);
    }
  };

  const addCompanyWfhDay = async () => {
    if (!wfhDate.trim()) {
      setError("Select a WFH date.");
      return;
    }

    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/network-access/company-wfh-days", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: wfhDate, note: wfhNote }),
      });
      const json = await readResponseJson<{ success: boolean; message?: string }>(res, "action");
      if (!json.success) throw new Error(json.message ?? "Failed to add company WFH day");
      setWfhNote("");
      setWfhDate(localTodayIso());
      setMessage(`Company WFH day added for ${formatWfhDate(wfhDate)}. Wi‑Fi restriction is off for everyone that day.`);
      await loadAll();
    } catch (err) {
      setError(toUserFacingActionError(err));
    } finally {
      setSaving(false);
    }
  };

  const removeCompanyWfhDay = async (day: CompanyWfhDay) => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/network-access/company-wfh-days", {
        method: "DELETE",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: day.id }),
      });
      const json = await readResponseJson<{ success: boolean; message?: string }>(res, "action");
      if (!json.success) throw new Error(json.message ?? "Failed to remove company WFH day");
      setPendingDelete(null);
      setMessage("Company WFH day removed.");
      await loadAll();
    } catch (err) {
      setError(toUserFacingActionError(err));
    } finally {
      setSaving(false);
    }
  };

  const confirmPendingDelete = () => {
    if (!pendingDelete) return;
    if (pendingDelete.kind === "network") {
      void deleteNetwork(pendingDelete.network);
      return;
    }
    if (pendingDelete.kind === "wfh") {
      void removeCompanyWfhDay(pendingDelete.day);
      return;
    }
    void removeRemoteEmployee(pendingDelete.employee);
  };

  if (!canManage) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="LAN / Wi‑Fi Restriction"
          description="Only HR can manage network access."
        />
        <p className="text-ex-muted text-sm">You do not have permission to view this page.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="LAN / Wi‑Fi Restriction"
        description="Allow the portal only from office router public IPs. Work-from-home employees can be exempted individually, or mark company WFH days to lift restriction for everyone. HR and Super Admin always bypass this check so you can update IPs after a power cut."
        actions={
          <Badge variant={restrictionEnabled ? "warning" : "accent"}>
            {restrictionEnabled ? "Restriction On" : "Restriction Off"}
          </Badge>
        }
      />

      {error ? (
        <p className="border-ex-banner-danger-border bg-ex-banner-danger-bg text-ex-banner-danger-fg rounded-lg border px-3 py-2 text-sm">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="border-ex-border bg-ex-elevated text-ex-primary rounded-lg border px-3 py-2 text-sm">
          {message}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Restriction</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <p className="text-ex-primary text-sm font-medium">Require Office WiFi</p>
            <p className="text-ex-muted text-xs">
              When enabled, employees must use an IP from the Office Wi‑Fi list below (unless they
              are on the remote access list). Your public IP:{" "}
              <span className="text-ex-primary font-mono">{clientIp || "detecting…"}</span>
              {serverClientIp && serverClientIp !== clientIp ? (
                <>
                  {" "}
                  (server headers: <span className="font-mono">{serverClientIp || "none"}</span>)
                </>
              ) : null}
              .
            </p>
          </div>
          <Button
            type="button"
            variant={restrictionEnabled ? "outline" : "primary"}
            disabled={loading || saving}
            onClick={() => void toggleRestriction(!restrictionEnabled)}
          >
            {restrictionEnabled ? "Disable Restriction" : "Enable Restriction"}
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Office Wi‑Fi IPs</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="network-label">Label</Label>
                <Input
                  id="network-label"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  disabled={saving}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="network-ip">Public IPv4</Label>
                <Input
                  id="network-ip"
                  value={ip}
                  onChange={(e) => setIp(e.target.value)}
                  disabled={saving}
                  className="font-mono"
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                disabled={saving || loading || !label.trim() || !ip.trim()}
                onClick={() => void saveNetwork()}
              >
                {editingId ? "Update IP" : "Add IP"}
              </Button>
              {!editingId ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={saving || loading || !clientIp}
                  onClick={() =>
                    void saveNetwork({
                      useCurrentIp: true,
                      labelOverride: label.trim() || "Office Wi‑Fi",
                    })
                  }
                >
                  <Wifi className="mr-1.5 size-4" />
                  Add My Current IP
                </Button>
              ) : (
                <Button type="button" variant="outline" disabled={saving} onClick={resetIpForm}>
                  Cancel Edit
                </Button>
              )}
            </div>

            <div className="space-y-2">
              {loading ? (
                <p className="text-ex-muted text-sm">Loading…</p>
              ) : networks.length === 0 ? (
                <p className="text-ex-muted text-sm">
                  No office IPs yet. Connect to each office Wi‑Fi and use “Add My Current IP”.
                </p>
              ) : (
                networks.map((network) => (
                  <div
                    key={network.id}
                    className="border-ex-border bg-ex-elevated flex items-center gap-3 rounded-xl border p-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-ex-primary truncate text-sm font-medium">
                        {network.label}
                      </p>
                      <p className="text-ex-muted mt-0.5 font-mono text-xs">{network.ip}</p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="size-8 p-0"
                      disabled={saving}
                      aria-label={`Edit ${network.label}`}
                      onClick={() => startEdit(network)}
                    >
                      <Pencil className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="size-8 p-0"
                      disabled={saving}
                      aria-label={`Delete ${network.label}`}
                      onClick={() => setPendingDelete({ kind: "network", network })}
                    >
                      <Trash2 className="size-4 text-red-600 dark:text-red-400" />
                    </Button>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Work From Home (Unrestricted)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-ex-muted text-xs">
              These employees can sign in from any network even when restriction is on.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="min-w-0 flex-1 space-y-2">
                <Label htmlFor="remote-employee">Employee</Label>
                <Select
                  id="remote-employee"
                  value={remoteSheetRow}
                  onChange={(e) => setRemoteSheetRow(e.target.value)}
                  disabled={saving || loading}
                >
                  <option value="">Select</option>
                  {availableEmployees.map((employee) => (
                    <option key={employee.sheetRow} value={String(employee.sheetRow)}>
                      {employee.name}
                    </option>
                  ))}
                </Select>
              </div>
              <Button
                type="button"
                disabled={saving || loading || !remoteSheetRow}
                onClick={() => void addRemoteEmployee()}
              >
                <Plus className="mr-1 size-4" />
                Add
              </Button>
            </div>

            <div className="space-y-2">
              {loading ? (
                <p className="text-ex-muted text-sm">Loading…</p>
              ) : remoteEmployees.length === 0 ? (
                <p className="text-ex-muted text-sm">No Remote Employees Yet.</p>
              ) : (
                remoteEmployees.map((row) => (
                  <div
                    key={row.id}
                    className="border-ex-border bg-ex-elevated flex items-center gap-3 rounded-xl border p-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-ex-primary truncate text-sm font-medium">
                        {row.employeeName}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="size-8 p-0"
                      disabled={saving}
                      aria-label={`Remove remote access for ${row.employeeName}`}
                      onClick={() => setPendingDelete({ kind: "remote", employee: row })}
                    >
                      <Trash2 className="size-4 text-red-600 dark:text-red-400" />
                    </Button>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Company WFH Days (No Wi‑Fi Restriction)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-ex-muted text-xs">
            On these dates, every employee can punch in / out from home — no need to add each
            person to the remote access list. Restriction turns back on the next day.
          </p>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_auto] sm:items-end">
            <div className="space-y-2">
              <Label htmlFor="wfh-date">WFH Date</Label>
              <Input
                id="wfh-date"
                type="date"
                value={wfhDate}
                onChange={(e) => setWfhDate(e.target.value)}
                disabled={saving || loading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="wfh-note">Note (Optional)</Label>
              <Input
                id="wfh-note"
                value={wfhNote}
                maxLength={120}
                onChange={(e) => setWfhNote(e.target.value)}
                disabled={saving || loading}
              />
            </div>
            <Button
              type="button"
              disabled={saving || loading || !wfhDate}
              onClick={() => void addCompanyWfhDay()}
            >
              <Plus className="mr-1 size-4" />
              Add Day
            </Button>
          </div>

          <div className="space-y-2">
            {loading ? (
              <p className="text-ex-muted text-sm">Loading…</p>
            ) : companyWfhDays.length === 0 ? (
              <p className="text-ex-muted text-sm">No Company WFH Days Scheduled.</p>
            ) : (
              companyWfhDays.map((day) => {
                const isToday = day.date === localTodayIso();
                return (
                  <div
                    key={day.id}
                    className="border-ex-border bg-ex-elevated flex items-center gap-3 rounded-xl border p-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-ex-primary text-sm font-medium">
                          {formatWfhDate(day.date)}
                        </p>
                        {isToday ? <Badge variant="accent">Today</Badge> : null}
                      </div>
                      <p className="text-ex-muted mt-0.5 text-xs">
                        {day.note || "All employees unrestricted"}
                        {day.createdByName ? ` · added by ${day.createdByName}` : ""}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="size-8 p-0"
                      disabled={saving}
                      aria-label={`Remove company WFH day ${day.date}`}
                      onClick={() => setPendingDelete({ kind: "wfh", day })}
                    >
                      <Trash2 className="size-4 text-red-600 dark:text-red-400" />
                    </Button>
                  </div>
                );
              })
            )}
          </div>
        </CardContent>
      </Card>

      {pendingDelete ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="network-delete-title"
        >
          <button
            type="button"
            className="absolute inset-0 cursor-default"
            aria-label="Close"
            disabled={saving}
            onClick={() => {
              if (!saving) setPendingDelete(null);
            }}
          />
          <div className="border-ex-border bg-ex-elevated relative z-10 w-full max-w-md rounded-2xl border p-5 shadow-xl sm:p-6">
            <div className="flex items-start gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-rose-600">
                <Trash2 className="size-5 text-white" aria-hidden />
              </div>
              <div className="min-w-0">
                <h2 id="network-delete-title" className="text-ex-primary text-lg font-semibold">
                  {pendingDelete.kind === "network"
                    ? "Remove office IP?"
                    : pendingDelete.kind === "wfh"
                      ? "Remove Company WFH Day?"
                      : "Remove Remote Access?"}
                </h2>
                <p className="text-ex-muted mt-1 text-sm">
                  {pendingDelete.kind === "network" ? (
                    <>
                      Remove{" "}
                      <span className="text-ex-primary font-medium">
                        “{pendingDelete.network.label}”
                      </span>{" "}
                      (<span className="font-mono text-xs">{pendingDelete.network.ip}</span>) from
                      the allowlist?
                    </>
                  ) : pendingDelete.kind === "wfh" ? (
                    <>
                      Remove company WFH for{" "}
                      <span className="text-ex-primary font-medium">
                        {formatWfhDate(pendingDelete.day.date)}
                      </span>
                      ? Wi‑Fi restriction will apply again that day.
                    </>
                  ) : (
                    <>
                      Remove remote access for{" "}
                      <span className="text-ex-primary font-medium">
                        {pendingDelete.employee.employeeName}
                      </span>
                      ?
                    </>
                  )}
                </p>
              </div>
            </div>

            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="outline"
                disabled={saving}
                onClick={() => setPendingDelete(null)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="danger"
                disabled={saving}
                onClick={confirmPendingDelete}
              >
                {saving ? "Removing…" : "Remove"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
