"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ExternalLink, Monitor, Pencil, User } from "lucide-react";
import Image from "next/image";

import { ROLES } from "@/app/consts/common";
import { parseSkillsValue } from "@/app/consts/tech-skills";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { normalizeDateValue } from "@/components/ui/date-input";
import { Skeleton } from "@/components/ui/skeleton";
import { ProfileAccountSettings } from "@/components/employee/profile-account-settings";
import { useAuth } from "@/contexts/auth-provider";
import { canManageEmployees } from "@/lib/auth/roles";
import { readResponseJson } from "@/lib/api/read-response-json";
import {
  getDocumentDisplayName,
  getDocumentHref,
  hidesEmploymentFields,
  maskAadhar,
  maskPan,
  isEmployeeStatusActive,
  resolveProfileImageSrc,
  formatEmployeePositionLabel,
  formatEmployeeRoleLabel,
  formatParentRelationshipLabel,
  type EmployeeDocumentField,
  type EmployeeFormState,
} from "@/lib/employee";
import {
  DEVICE_FIELDS,
  compactDeviceList,
  compactLoginList,
  type SystemSpecsRecord,
} from "@/lib/system-specs/types";

function formatDate(value: string): string {
  const iso = normalizeDateValue(value);
  if (!iso) return "—";
  const [year, month, day] = iso.split("-");
  return `${day}/${month}/${year}`;
}

function formatPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 10) {
    return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
  }
  return value || "—";
}

function DocumentFileRow({
  label,
  field,
  storedValue,
}: {
  label: string;
  field: EmployeeDocumentField;
  storedValue: string;
}) {
  const title = getDocumentDisplayName(field, storedValue) || "—";
  const href = getDocumentHref(storedValue);

  return (
    <p className="flex justify-between gap-2">
      <span className="text-ex-muted">{label}</span>
      {href && title !== "—" ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-ex-secondary inline-flex items-center gap-1 hover:underline"
        >
          {title}
          <ExternalLink className="size-3.5 shrink-0 opacity-80" aria-hidden />
        </a>
      ) : (
        <span className="text-ex-primary">{title}</span>
      )}
    </p>
  );
}

function ReadOnlyField({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={className ?? "space-y-2"}>
      <Label>{label}</Label>
      <Input value={value} readOnly disabled className="disabled:opacity-100" />
    </div>
  );
}

function formatDeviceLine(device: { name: string; serialNumber: string }): string {
  const name = device.name.trim();
  const serial = device.serialNumber.trim();
  if (name && serial) return `${name} · ${serial}`;
  return name || serial;
}

function SpecSection({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="border-ex-border space-y-1 border-b py-2 last:border-b-0 last:pb-0 first:pt-0">
      <p className="text-ex-muted text-xs font-medium">{label}</p>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function SystemSpecsCard({
  employeeSheetRow,
  loadOwnSpecs = false,
}: {
  employeeSheetRow?: number | null;
  loadOwnSpecs?: boolean;
}) {
  const [loading, setLoading] = useState(true);
  const [specs, setSpecs] = useState<SystemSpecsRecord | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const url = loadOwnSpecs
          ? "/api/system-specs?me=1"
          : `/api/system-specs?sheetRow=${employeeSheetRow}`;
        const res = await fetch(url, { credentials: "include", cache: "no-store" });
        const json = await readResponseJson<{
          success?: boolean;
          specs?: SystemSpecsRecord | null;
        }>(res, "fetch");
        if (cancelled) return;
        setSpecs(json.success ? (json.specs ?? null) : null);
      } catch {
        if (!cancelled) setSpecs(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [employeeSheetRow, loadOwnSpecs]);

  const deviceSections = specs
    ? [
        ...DEVICE_FIELDS.map((device) => ({
          key: device.key,
          label: device.label,
          items: compactDeviceList(specs[device.key]),
        })),
        { key: "screen", label: "Screen", items: compactDeviceList(specs.screen) },
      ].filter((section) => section.items.length > 0)
    : [];

  const ramValue = specs?.ramGb?.trim() ? `${specs.ramGb.trim()} GB` : "";
  const logins = specs ? compactLoginList(specs.logins) : [];
  const noteValue = specs?.note?.trim() || "";
  const hasContent =
    deviceSections.length > 0 || Boolean(ramValue) || logins.length > 0 || Boolean(noteValue);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Monitor className="text-ex-secondary size-4" aria-hidden />
          <CardTitle>System Specifications</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-3" aria-busy aria-label="Loading system specifications">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="space-y-1.5">
                <Skeleton className="h-3 w-16 rounded-md" />
                <Skeleton className="h-4 w-full rounded-md" />
              </div>
            ))}
          </div>
        ) : !specs || !hasContent ? (
          <p className="text-ex-muted text-sm">No system specifications submitted yet.</p>
        ) : (
          <div>
            {deviceSections.map((section) => (
              <SpecSection key={section.key} label={section.label}>
                {section.items.map((item, index) => (
                  <p key={`${section.key}-${index}`} className="text-ex-primary text-sm leading-snug wrap-break-word">
                    {section.items.length > 1 ? (
                      <span className="text-ex-muted mr-1.5">{index + 1}.</span>
                    ) : null}
                    {formatDeviceLine(item)}
                  </p>
                ))}
              </SpecSection>
            ))}

            {(ramValue || logins.length > 0) && (
              <div
                className={
                  deviceSections.length > 0
                    ? "border-ex-border space-y-1.5 border-t pt-2"
                    : "space-y-1.5"
                }
              >
                {ramValue ? (
                  <div className="flex items-baseline gap-2">
                    <span className="text-ex-muted w-14 shrink-0 text-xs font-medium">RAM</span>
                    <span className="text-ex-primary text-sm">{ramValue}</span>
                  </div>
                ) : null}

                {logins.map((login, index) => {
                  const user = login.username.trim() || "—";
                  const pass = login.password.trim() || "—";
                  const label = logins.length > 1 ? `Login ${index + 1}` : "Login";
                  return (
                    <div key={`login-${index}`} className="flex items-baseline gap-2">
                      <span className="text-ex-muted w-14 shrink-0 text-xs font-medium">
                        {label}
                      </span>
                      <span className="text-ex-primary min-w-0 text-sm leading-snug break-all">
                        {user}
                        <span className="text-ex-muted mx-1.5">·</span>
                        {pass}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            {noteValue ? (
              <SpecSection label="Note">
                <p className="text-ex-primary text-sm leading-relaxed whitespace-pre-wrap wrap-break-word">
                  {noteValue}
                </p>
              </SpecSection>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export type EmployeeProfileViewProps = {
  form: EmployeeFormState;
  /** Sheet row used to load this employee&apos;s system specs (HR/admin view). */
  employeeSheetRow?: number | null;
  /** Load specs for the signed-in employee via /api/system-specs?me=1. */
  loadOwnSpecs?: boolean;
  /** Show sign-in username and password settings (own profile only). */
  showAccountSettings?: boolean;
  hasPassword?: boolean;
  onEdit?: () => void;
  onPasswordUpdated?: () => void;
};

export function EmployeeProfileView({
  form,
  employeeSheetRow = null,
  loadOwnSpecs = false,
  showAccountSettings = false,
  hasPassword: initialHasPassword = false,
  onEdit,
  onPasswordUpdated,
}: EmployeeProfileViewProps) {
  const { user } = useAuth();
  const profileSrc = resolveProfileImageSrc(form.profileImage);
  const skills = parseSkillsValue(form.skills);
  const showDocuments = user?.role === ROLES.HR_MANAGER || user?.role === ROLES.SUPER_ADMIN;
  const canManage = user ? canManageEmployees(user.role) : false;
  const isInactive = !isEmployeeStatusActive(form.status);
  const hideEmploymentFields = hidesEmploymentFields({
    position: form.position,
    role: form.role,
  });
  const showSystemSpecs =
    loadOwnSpecs || (employeeSheetRow != null && employeeSheetRow >= 2 && canManage);

  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <div className="space-y-4 xl:col-span-2">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <CardTitle>Core Details</CardTitle>
              {onEdit ? (
                <Button variant="outline" size="sm" type="button" onClick={onEdit}>
                  <Pencil className="size-4" />
                  Edit Profile
                </Button>
              ) : null}
            </div>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col items-center gap-3 sm:col-span-2">
              {profileSrc ? (
                <Image
                  src={profileSrc}
                  alt="Profile"
                  width={96}
                  height={96}
                  unoptimized
                  className="border-ex-border size-24 rounded-full border object-cover"
                />
              ) : (
                <span
                  className="border-ex-border bg-ex-surface text-ex-muted inline-flex size-24 items-center justify-center rounded-full border"
                  aria-hidden
                >
                  <User className="size-10" />
                </span>
              )}
              <div className="text-center">
                <p className="text-ex-primary text-lg font-semibold">{form.name || "—"}</p>
              </div>
            </div>

            <ReadOnlyField label="Email" value={form.email || "—"} />
            <ReadOnlyField label="Username" value={form.username || "—"} />
            <ReadOnlyField label="Contact" value={formatPhone(form.contactNumber)} />
            <ReadOnlyField label="Role" value={formatEmployeeRoleLabel(form.role) || "—"} />
            <ReadOnlyField
              label="Position"
              value={formatEmployeePositionLabel(form.position) || "—"}
            />
            <ReadOnlyField label="Birthday" value={formatDate(form.birthdayDate)} />

            {isInactive ? (
              <>
                <ReadOnlyField label="Last Working Day" value={formatDate(form.lastWorkingDay)} />
                <div className="space-y-2 sm:col-span-2">
                  <Label>Offboard Reason</Label>
                  <Textarea
                    value={form.offboardReason || "—"}
                    readOnly
                    disabled
                    rows={3}
                    className="disabled:opacity-100"
                  />
                </div>
              </>
            ) : null}

            <div className="space-y-2 sm:col-span-2">
              <Label>Address</Label>
              <Textarea
                value={form.address || "—"}
                readOnly
                disabled
                rows={3}
                className="disabled:opacity-100"
              />
            </div>

            {!hideEmploymentFields ? (
              <>
                <ReadOnlyField label="Joining Date" value={formatDate(form.joiningDate)} />
                <ReadOnlyField label="Last Increment" value={formatDate(form.lastIncrementDate)} />
                <ReadOnlyField label="Experience (Years)" value={form.experience || "—"} />
                {canManage ? (
                  <ReadOnlyField
                    label="Salary (Monthly)"
                    value={form.salary?.trim() ? form.salary : "—"}
                  />
                ) : null}
              </>
            ) : null}

            <ReadOnlyField label="PAN" value={maskPan(form.panNumber)} />
            <ReadOnlyField label="Aadhaar" value={maskAadhar(form.aadharNumber)} />
            <ReadOnlyField label="Bank Account" value={form.bankAccountNumber || "—"} />
            <ReadOnlyField label="IFSC Code" value={form.ifscCode || "—"} />
          </CardContent>
        </Card>

        {showAccountSettings ? (
          <ProfileAccountSettings
            username={form.username}
            hasPassword={initialHasPassword}
            onPasswordUpdated={onPasswordUpdated}
          />
        ) : null}
      </div>

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Emergency Contact</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <ReadOnlyField label="Contact Name" value={form.parentName || "—"} />
            <ReadOnlyField label="Contact Number" value={formatPhone(form.parentContact)} />
            <ReadOnlyField
              label="Relationship"
              value={formatParentRelationshipLabel(form.parentDetails) || "—"}
            />
          </CardContent>
        </Card>

        {!hideEmploymentFields ? (
          <Card>
            <CardHeader>
              <CardTitle>Skills</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Tech skills</Label>
                <Textarea
                  value={skills.length ? skills.join(", ") : "—"}
                  readOnly
                  disabled
                  rows={4}
                  className="disabled:opacity-100"
                />
              </div>
            </CardContent>
          </Card>
        ) : null}

        {showSystemSpecs ? (
          <SystemSpecsCard employeeSheetRow={employeeSheetRow} loadOwnSpecs={loadOwnSpecs} />
        ) : null}

        {showDocuments ? (
          <Card>
            <CardHeader>
              <CardTitle>Documents</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <DocumentFileRow label="PAN Card" field="pancard" storedValue={form.pancard} />
              <DocumentFileRow
                label="Aadhaar Card"
                field="aadharCard"
                storedValue={form.aadharCard}
              />
              <DocumentFileRow label="Marksheet" field="marksheet" storedValue={form.marksheet} />
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
