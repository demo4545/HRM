"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  BANK_ACCOUNT_MAX_LENGTH,
  BANK_ACCOUNT_MIN_LENGTH,
  EMPLOYEE_DOCUMENT_FIELDS,
  EMPLOYEE_MAX_EXPERIENCE_YEARS,
  formToSheetRow,
  initialEmployeeForm,
  hidesEmploymentFields,
  IFSC_CODE_LENGTH,
  maskAadhar,
  maskPan,
  maxBirthDateForMinAge,
  sanitizePersonNameInput,
  splitPersonName,
  joinPersonName,
  sheetRowToForm,
  todayIsoDate,
  validateEmployeeForm,
  type EmployeeFieldErrors,
  type EmployeeFormState,
} from "@/lib/employee";
import { toUserFacingActionError, toUserFacingFetchError } from "@/lib/api/user-facing-error";
import { readResponseJson } from "@/lib/api/read-response-json";
import { POSITIONS, ROLES } from "@/app/consts/common";
import { useAuth } from "@/contexts/auth-provider";
import { useNotifications } from "@/contexts/notifications-provider";
import { canManageEmployees } from "@/lib/auth/roles";
import { joinSkillsValue, parseSkillsValue } from "@/app/consts/tech-skills";
import { Select } from "../ui/select";
import { resolveProfileImageSrc } from "@/lib/employee/documents";
import { type DocumentField, FileUploaderField } from "../ui/file-uploader";
import { IndianPhoneInput } from "../ui/indian-phone-input";
import { SkillsChipsInput } from "../ui/skills-chips-input";
import { DateInput } from "../ui/date-input";
import { FormSkeleton } from "../ui/form-skeleton";

function FormField({
  label,
  id,
  children,
  className,
  error,
  optional,
}: {
  label: string;
  id: string;
  children: React.ReactNode;
  className?: string;
  error?: string;
  optional?: boolean;
}) {
  return (
    <div className={className ?? "space-y-2"}>
      <Label htmlFor={id}>
        {label}
        {optional ? <span className="text-ex-muted font-normal"> (optional)</span> : null}
      </Label>
      {children}
      {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
    </div>
  );
}

export type EmployeeFormProps = {
  mode: "add" | "edit";
  sheetRow?: number;
  successRedirectPath?: string;
  cancelHref?: string;
  onSaved?: () => void;
  onCancel?: () => void;
  useOwnProfileEndpoint?: boolean;
};

export function EmployeeForm({
  mode,
  sheetRow,
  successRedirectPath = "/employee",
  cancelHref = "/employee",
  onSaved,
  onCancel,
  useOwnProfileEndpoint = false,
}: EmployeeFormProps) {
  const router = useRouter();
  const { user } = useAuth();
  const { pushToast } = useNotifications();
  const canManage = user ? canManageEmployees(user.role) : false;
  const canEditRole = user?.role === ROLES.HR_MANAGER || user?.role === ROLES.SUPER_ADMIN;
  const canEditLastIncrement = user?.role !== ROLES.EMPLOYEE;
  const isEdit = mode === "edit";

  const [form, setForm] = useState<EmployeeFormState>(initialEmployeeForm);
  const [sheetHeaders, setSheetHeaders] = useState<string[]>([]);
  const [skillSuggestions, setSkillSuggestions] = useState<string[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(true);
  const [skillsError, setSkillsError] = useState<string | null>(null);
  const [loading, setLoading] = useState(isEdit);
  const [headersLoading, setHeadersLoading] = useState(!isEdit);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [documentFiles, setDocumentFiles] = useState<Partial<Record<DocumentField, File>>>({});
  const [profileImagePreview, setProfileImagePreview] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<EmployeeFieldErrors>({});

  const profileImageSrc = resolveProfileImageSrc(form.profileImage, profileImagePreview);
  const maxBirthDate = useMemo(() => maxBirthDateForMinAge(), []);
  const todayDate = useMemo(() => todayIsoDate(), []);
  const hideEmploymentFields = hidesEmploymentFields({
    position: form.position,
    role: form.role,
  });
  const { firstName, lastName } = useMemo(() => splitPersonName(form.name), [form.name]);

  useEffect(() => {
    return () => {
      if (profileImagePreview?.startsWith("blob:")) {
        URL.revokeObjectURL(profileImagePreview);
      }
    };
  }, [profileImagePreview]);

  const updateNamePart = (part: "first" | "last", raw: string) => {
    const value = sanitizePersonNameInput(raw);
    const nextFirst = part === "first" ? value : firstName;
    const nextLast = part === "last" ? value : lastName;

    setForm((prev) => ({ ...prev, name: joinPersonName(nextFirst, nextLast) }));
    setFieldErrors((prev) => {
      if (!prev.name) return prev;
      const next = { ...prev };
      delete next.name;
      return next;
    });
  };

  const clearProfileImagePreview = () => {
    setProfileImagePreview((prev) => {
      if (prev?.startsWith("blob:")) URL.revokeObjectURL(prev);
      return null;
    });
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        setError(null);
        clearProfileImagePreview();

        if (isEdit && useOwnProfileEndpoint) {
          const response = await fetch("/api/employee/me");
          const result = await readResponseJson<{
            success?: boolean;
            message?: string;
            [key: string]: unknown;
          }>(response, "fetch");
          if (cancelled) return;

          if (!result.success) {
            setError(toUserFacingFetchError(result.message || "Employee Not Found"));
            return;
          }

          const headers = (result.headers as string[]) ?? [];
          setSheetHeaders(headers);
          setForm(sheetRowToForm(headers, (result.row as string[]) ?? []));
          return;
        }

        if (isEdit && sheetRow) {
          const response = await fetch(`/api/employee?row=${sheetRow}`);
          const result = await readResponseJson<{
            success?: boolean;
            message?: string;
            [key: string]: unknown;
          }>(response, "fetch");
          if (cancelled) return;

          if (!result.success) {
            setError(toUserFacingFetchError(result.message || "Employee Not Found"));
            return;
          }

          const headers = (result.headers as string[]) ?? [];
          setSheetHeaders(headers);
          setForm(sheetRowToForm(headers, (result.row as string[]) ?? []));
          return;
        }

        const response = await fetch("/api/employee?headersOnly=true");
        const result = await readResponseJson<{
          success?: boolean;
          message?: string;
          [key: string]: unknown;
        }>(response, "fetch");
        if (cancelled) return;

        if (result.success) {
          const headers = (result.headers as string[]) ?? [];
          if (headers.length === 0) {
            setError("No columns found in the employee sheet.");
          } else {
            setSheetHeaders(headers);
          }
        } else {
          setError(toUserFacingFetchError(result.message || "Failed to load sheet columns"));
        }
      } catch {
        if (!cancelled) {
          setError(
            toUserFacingFetchError(
              isEdit ? "Failed to load employee" : "Failed to load sheet columns",
            ),
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          setHeadersLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isEdit, sheetRow, useOwnProfileEndpoint]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        setSkillsError(null);
        setSkillsLoading(true);

        const response = await fetch("/api/employee/skills");
        const result = await readResponseJson<{
          success?: boolean;
          message?: string;
          [key: string]: unknown;
        }>(response, "fetch");

        if (cancelled) return;

        if (result.success) {
          setSkillSuggestions(Array.isArray(result.skills) ? result.skills : []);
        } else {
          setSkillsError(result.message || "Failed to Load Skill Suggestions");
          setSkillSuggestions([]);
        }
      } catch {
        if (!cancelled) {
          setSkillsError("Failed to Load Skill Suggestions");
          setSkillSuggestions([]);
        }
      } finally {
        if (!cancelled) {
          setSkillsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const update =
    (field: keyof EmployeeFormState) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      let value = e.target.value;
      if (field === "panNumber") {
        value = value
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, "")
          .slice(0, 10);
      } else if (field === "aadharNumber") {
        value = value.replace(/\D/g, "").slice(0, 12);
      } else if (field === "bankAccountNumber") {
        value = value.replace(/\D/g, "").slice(0, BANK_ACCOUNT_MAX_LENGTH);
      } else if (field === "ifscCode") {
        value = value
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, "")
          .slice(0, IFSC_CODE_LENGTH);
      } else if (field === "name" || field === "parentName") {
        value = sanitizePersonNameInput(value);
      }

      setForm((prev) => {
        const next = { ...prev, [field]: value };
        if (
          (field === "position" || field === "role") &&
          hidesEmploymentFields({
            position: field === "position" ? value : next.position,
            role: field === "role" ? value : next.role,
          })
        ) {
          next.experience = "";
          next.joiningDate = "";
          next.lastIncrementDate = "";
          next.salary = "";
          next.skills = "";
        }
        return next;
      });

      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        if (
          (field === "position" || field === "role") &&
          hidesEmploymentFields({
            position: field === "position" ? value : form.position,
            role: field === "role" ? value : form.role,
          })
        ) {
          delete next.experience;
          delete next.joiningDate;
          delete next.lastIncrementDate;
          delete next.salary;
        }
        return next;
      });
    };

  const updateField = (field: keyof EmployeeFormState, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setFieldErrors((prev) => {
      const next = { ...prev };
      let changed = false;

      if (next[field]) {
        delete next[field];
        changed = true;
      }

      // Clear the paired "must differ" error when either phone number changes.
      if (field === "contactNumber" && next.parentContact?.toLowerCase().includes("different")) {
        delete next.parentContact;
        changed = true;
      }
      if (field === "parentContact" && next.contactNumber?.toLowerCase().includes("different")) {
        delete next.contactNumber;
        changed = true;
      }

      return changed ? next : prev;
    });
  };

  const handleFile = (field: DocumentField) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setDocumentFiles((prev) => ({ ...prev, [field]: file }));
    setForm((prev) => ({ ...prev, [field]: file.name }));

    if (field === "profileImage") {
      setProfileImagePreview((prev) => {
        if (prev?.startsWith("blob:")) URL.revokeObjectURL(prev);
        return file.type.startsWith("image/") ? URL.createObjectURL(file) : null;
      });
    }
  };

  const saveEmployee = async (formData: EmployeeFormState) => {
    if (!sheetHeaders.length) {
      setError("Sheet Columns are not Loaded Yet.");
      return;
    }

    setError(null);
    setSubmitting(true);

    const rowValues = formToSheetRow(formData, sheetHeaders);

    const body = new FormData();
    body.append("values", JSON.stringify([rowValues]));
    if (isEdit && sheetRow) {
      body.append("sheetRow", String(sheetRow));
    }
    for (const field of EMPLOYEE_DOCUMENT_FIELDS) {
      const file = documentFiles[field];
      if (file) body.append(field, file);
    }

    try {
      const response = await fetch("/api/employee", {
        method: isEdit ? "PUT" : "POST",
        body,
      });
      const result = await readResponseJson<{
        success?: boolean;
        message?: string;
        [key: string]: unknown;
      }>(response, "action");

      if (result.success) {
        if (result.documentWarning) {
          setError(result.message || String(result.documentWarning));
          return;
        }

        const credentials = result.credentials as
          { username?: string; initialPassword?: string } | undefined;
        if (!isEdit && credentials && (credentials.username || credentials.initialPassword)) {
          const credentialParts = [
            credentials.username ? `Username: ${credentials.username}` : null,
            credentials.initialPassword ? `Password: ${credentials.initialPassword}` : null,
          ].filter(Boolean);
          pushToast({
            title: "Employee Created",
            body: `Share these sign-in details once (stored encrypted): ${credentialParts.join(" · ")}`,
            variant: "success",
          });
        } else {
          pushToast({
            title: isEdit ? "Employee Updated" : "Employee Created",
            body:
              (typeof result.message === "string" && result.message) ||
              (isEdit ? "Employee updated successfully." : "Employee created successfully."),
            variant: "success",
          });
        }

        if (onSaved) {
          onSaved();
        } else {
          router.push(successRedirectPath);
        }
        return;
      }

      if (result.errors && typeof result.errors === "object") {
        setFieldErrors(result.errors as EmployeeFieldErrors);
        if (Object.keys(result.errors).length > 0) {
          setError(null);
          return;
        }
      }
      setError(
        toUserFacingActionError(
          result.message || (isEdit ? "Failed to Update Employee" : "Failed to Add Employee"),
        ),
      );
    } catch (error) {
      setError(toUserFacingActionError(error));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const errors = validateEmployeeForm(form);
    setFieldErrors(errors);

    if (Object.keys(errors).length > 0) {
      setError(null);
      return;
    }

    await saveEmployee(form);
  };

  if (loading) {
    return <FormSkeleton label="Loading employee…" fields={8} />;
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <div className="mb-4 flex flex-col gap-4 xl:flex-row">
        <div className="w-full max-w-3xl space-y-6 xl:w-1/2">
          <Card>
            <CardHeader>
              <CardTitle>Employee Details</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <FormField
                label="First Name"
                id="firstName"
                error={fieldErrors.name && !firstName.trim() ? fieldErrors.name : undefined}
              >
                <Input
                  id="firstName"
                  value={firstName}
                  onChange={(e) => updateNamePart("first", e.target.value)}
                  required
                  aria-invalid={Boolean(fieldErrors.name && !firstName.trim())}
                />
              </FormField>

              <FormField
                label="Last Name"
                id="lastName"
                error={fieldErrors.name && firstName.trim() ? fieldErrors.name : undefined}
              >
                <Input
                  id="lastName"
                  value={lastName}
                  onChange={(e) => updateNamePart("last", e.target.value)}
                  required
                  aria-invalid={Boolean(fieldErrors.name && firstName.trim())}
                />
              </FormField>

              <FormField label="Role" id="role" error={fieldErrors.role}>
                <Select
                  id="role"
                  value={form.role}
                  onChange={update("role")}
                  disabled={isEdit && !canEditRole}
                  required
                  aria-invalid={Boolean(fieldErrors.role)}
                >
                  <option value="">Select Role</option>
                  <option value={ROLES.SUPER_ADMIN}>Super Administrator</option>
                  <option value={ROLES.HR_MANAGER}>HR Manager</option>
                  <option value={ROLES.EMPLOYEE}>Employee</option>
                </Select>
              </FormField>

              <FormField label="Birthday date" id="birthdayDate" error={fieldErrors.birthdayDate}>
                <DateInput
                  id="birthdayDate"
                  value={form.birthdayDate}
                  onChange={(birthdayDate) => updateField("birthdayDate", birthdayDate)}
                  maxDate={maxBirthDate}
                  required
                  aria-invalid={Boolean(fieldErrors.birthdayDate)}
                />
              </FormField>

              <div className="space-y-2 sm:col-span-2">
                <FormField label="Address" id="address" error={fieldErrors.address}>
                  <Textarea
                    id="address"
                    value={form.address}
                    onChange={update("address")}
                    placeholder="House/flat, street, area, city, pincode"
                    rows={3}
                    required
                    aria-invalid={Boolean(fieldErrors.address)}
                  />
                </FormField>
              </div>

              <FormField label="PAN number" id="panNumber" error={fieldErrors.panNumber} optional>
                <Input
                  id="panNumber"
                  value={form.panNumber}
                  onChange={update("panNumber")}
                  placeholder="AAAAA9999A"
                  autoComplete="off"
                  maxLength={10}
                  aria-invalid={Boolean(fieldErrors.panNumber)}
                />
              </FormField>

              <FormField
                label="Aadhaar number"
                id="aadharNumber"
                error={fieldErrors.aadharNumber}
                optional
              >
                <Input
                  id="aadharNumber"
                  value={form.aadharNumber}
                  onChange={update("aadharNumber")}
                  placeholder="12-digit Aadhaar Number"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={12}
                  aria-invalid={Boolean(fieldErrors.aadharNumber)}
                />
              </FormField>

              <FormField
                label="Bank account number"
                id="bankAccountNumber"
                error={fieldErrors.bankAccountNumber}
                optional
              >
                <Input
                  id="bankAccountNumber"
                  value={form.bankAccountNumber}
                  onChange={update("bankAccountNumber")}
                  placeholder={`${BANK_ACCOUNT_MIN_LENGTH}–${BANK_ACCOUNT_MAX_LENGTH} digit account number`}
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={BANK_ACCOUNT_MAX_LENGTH}
                  aria-invalid={Boolean(fieldErrors.bankAccountNumber)}
                />
              </FormField>

              <FormField label="IFSC code" id="ifscCode" error={fieldErrors.ifscCode} optional>
                <Input
                  id="ifscCode"
                  value={form.ifscCode}
                  onChange={update("ifscCode")}
                  placeholder={`${IFSC_CODE_LENGTH}-character IFSC (e.g. SBIN0001234)`}
                  autoComplete="off"
                  maxLength={IFSC_CODE_LENGTH}
                  aria-invalid={Boolean(fieldErrors.ifscCode)}
                />
              </FormField>
            </CardContent>
          </Card>

          {!isEdit ? (
            <Card>
              <CardHeader>
                <CardTitle>Documents</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <FormField label="PAN card (upload)" id="pancard">
                  <FileUploaderField
                    id="pancard"
                    fileName={form.pancard}
                    onChange={handleFile("pancard")}
                  />
                </FormField>

                <FormField label="Aadhaar card (upload)" id="aadharCard">
                  <FileUploaderField
                    id="aadharCard"
                    fileName={form.aadharCard}
                    onChange={handleFile("aadharCard")}
                  />
                </FormField>

                <FormField label="Marksheet" id="marksheet">
                  <FileUploaderField
                    id="marksheet"
                    fileName={form.marksheet}
                    onChange={handleFile("marksheet")}
                  />
                </FormField>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Emergency Contact</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="mb-4 grid gap-4 sm:grid-cols-2">
                <FormField
                  label="Contact Name"
                  id="parentName"
                  error={fieldErrors.parentName}
                >
                  <Input
                    id="parentName"
                    value={form.parentName}
                    onChange={update("parentName")}
                    required
                    aria-invalid={Boolean(fieldErrors.parentName)}
                  />
                </FormField>
                <FormField
                  label="Contact Number"
                  id="parentContact"
                  error={fieldErrors.parentContact}
                >
                  <IndianPhoneInput
                    id="parentContact"
                    value={form.parentContact}
                    onChange={(value) => updateField("parentContact", value)}
                    required
                    aria-invalid={Boolean(fieldErrors.parentContact)}
                  />
                </FormField>
              </div>
              <FormField label="Relationship" id="parentDetails" error={fieldErrors.parentDetails}>
                <Select
                  id="parentDetails"
                  value={
                    ["father", "mother", "spouse", "husband", "brother", "sister"].includes(
                      form.parentDetails.trim().toLowerCase(),
                    )
                      ? form.parentDetails.trim().toLowerCase()
                      : ""
                  }
                  onChange={(e) =>
                    updateField("parentDetails", e.target.value.trim().toLowerCase())
                  }
                  required
                  aria-invalid={Boolean(fieldErrors.parentDetails)}
                >
                  <option value="">Select</option>
                  <option value="father">Father</option>
                  <option value="mother">Mother</option>
                  <option value="spouse">Spouse</option>
                  <option value="husband">Husband</option>
                  <option value="brother">Brother</option>
                  <option value="sister">Sister</option>
                </Select>
              </FormField>
            </CardContent>
          </Card>

          {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
        </div>
        <div className="w-full max-w-3xl space-y-6 xl:w-1/2">
          <Card>
            <CardHeader>
              <CardTitle>Profile</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="mb-4 flex items-center justify-center">
                {profileImageSrc ? (
                  <Image
                    src={profileImageSrc}
                    alt="Profile"
                    width={96}
                    height={96}
                    unoptimized
                    className="border-ex-border size-24 rounded-full border object-cover"
                  />
                ) : null}
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <FormField label="Profile image" id="profileImage">
                    <FileUploaderField
                      id="profileImage"
                      fileName={form.profileImage}
                      onChange={handleFile("profileImage")}
                    />
                  </FormField>
                </div>

                <div className="space-y-2">
                  <FormField label="Postion" id="position" error={fieldErrors.position}>
                    <Select
                      id="position"
                      value={form.position}
                      onChange={update("position")}
                      required
                      aria-invalid={Boolean(fieldErrors.position)}
                    >
                      <option value="">Select</option>
                      {[
                        { value: POSITIONS.TRAINEE, label: "Trainee" },
                        {
                          value: POSITIONS.AI_ML_LLM_TRAINEE,
                          label: "AI/ML & LLM Trainee",
                        },
                        { value: POSITIONS.FRONTEND_DEVELOPER, label: "Frontend Developer" },
                        {
                          value: POSITIONS.SENIOR_FRONTEND_DEVELOPER,
                          label: "Senior Frontend Developer",
                        },
                        { value: POSITIONS.BACKEND_DEVELOPER, label: "Backend Developer" },
                        {
                          value: POSITIONS.SENIOR_BACKEND_DEVELOPER,
                          label: "Senior Backend Developer",
                        },
                        { value: POSITIONS.FULLSTACK_DEVELOPER, label: "Fullstack Developer" },
                        {
                          value: POSITIONS.SENIOR_FULLSTACK_DEVELOPER,
                          label: "Senior Fullstack Developer",
                        },
                        {
                          value: POSITIONS.AI_ML_LLM_DEVELOPER,
                          label: "AI/ML & LLM Developer",
                        },
                        { value: POSITIONS.HR_MANAGER, label: "HR Manager" },
                        { value: POSITIONS.TEAM_LEAD, label: "Team Lead" },
                        { value: POSITIONS.CEO, label: "CEO" },
                        { value: POSITIONS.OTHER, label: "Other" },
                      ].map((position) => (
                        <option key={position.value} value={position.value}>
                          {position.label}
                        </option>
                      ))}
                    </Select>
                  </FormField>
                </div>

                <div className="space-y-2">
                  <FormField label="Email" id="email" error={fieldErrors.email}>
                    <Input
                      id="email"
                      type="email"
                      value={form.email}
                      onChange={update("email")}
                      placeholder="Email Address"
                      required
                      aria-invalid={Boolean(fieldErrors.email)}
                    />
                  </FormField>
                </div>

                <div className="space-y-2">
                  <FormField
                    label="Contact number"
                    id="contactNumber"
                    error={fieldErrors.contactNumber}
                  >
                    <IndianPhoneInput
                      id="contactNumber"
                      value={form.contactNumber}
                      onChange={(value) => updateField("contactNumber", value)}
                      placeholder="Enter Number"
                      required
                      aria-invalid={Boolean(fieldErrors.contactNumber)}
                    />
                  </FormField>
                </div>

                <div className="space-y-2">
                  <FormField label="Username" id="username">
                    <Input
                      id="username"
                      value={form.username}
                      onChange={update("username")}
                      placeholder="Optional — defaults to email before @"
                      autoComplete="off"
                    />
                    <p className="text-ex-muted text-xs">
                      Leave blank to use the part of the email before @.
                    </p>
                  </FormField>
                </div>

                <div className="space-y-2">
                  <FormField label="Password" id="password" error={fieldErrors.password}>
                    <PasswordInput
                      id="password"
                      value={form.password}
                      onChange={update("password")}
                      placeholder={
                        isEdit
                          ? "Leave blank to keep current password"
                          : "Leave blank to auto-generate (stored encrypted)"
                      }
                      autoComplete="new-password"
                      aria-invalid={Boolean(fieldErrors.password)}
                    />
                    <p className="text-ex-muted text-xs">
                      {isEdit
                        ? "If set, must be 8+ characters with uppercase, number, and special character (@, !, etc.)."
                        : "Leave blank to auto-generate. If entered: 8+ characters with one uppercase letter, one number, and one special character (@, !, etc.). Stored encrypted."}
                    </p>
                  </FormField>
                </div>

                {!hideEmploymentFields ? (
                  <>
                  {canManage ? (
                      <div className="space-y-2">
                        <FormField label="Salary (monthly)" id="salary" error={fieldErrors.salary}>
                          <Input
                            id="salary"
                            type="text"
                            inputMode="decimal"
                            value={form.salary}
                            onChange={update("salary")}
                            autoComplete="off"
                            aria-invalid={Boolean(fieldErrors.salary)}
                          />
                        </FormField>
                      </div>
                    ) : null}

                    <div className="space-y-2">
                      <FormField label="Experience" id="experience" error={fieldErrors.experience}>
                        <Input
                          id="experience"
                          type="number"
                          min={0}
                          max={EMPLOYEE_MAX_EXPERIENCE_YEARS}
                          step={0.1}
                          value={form.experience}
                          onChange={update("experience")}
                          placeholder="Years of experience"
                          aria-invalid={Boolean(fieldErrors.experience)}
                        />
                      </FormField>
                    </div>

                    <div className="space-y-2">
                      <FormField
                        label="Joining Date"
                        id="joiningDate"
                        error={fieldErrors.joiningDate}
                      >
                        <DateInput
                          id="joiningDate"
                          value={form.joiningDate}
                          onChange={(joiningDate) => updateField("joiningDate", joiningDate)}
                          maxDate={todayDate}
                          required
                          aria-invalid={Boolean(fieldErrors.joiningDate)}
                        />
                      </FormField>
                    </div>

                    <div className="space-y-2">
                      <FormField
                        label="Last Increment Date"
                        id="lastIncrementDate"
                        error={fieldErrors.lastIncrementDate}
                      >
                        <DateInput
                          id="lastIncrementDate"
                          value={form.lastIncrementDate}
                          onChange={(lastIncrementDate) =>
                            updateField("lastIncrementDate", lastIncrementDate)
                          }
                          maxDate={todayDate}
                          disabled={!canEditLastIncrement}
                          aria-invalid={Boolean(fieldErrors.lastIncrementDate)}
                        />
                      </FormField>
                    </div>
                  </>
                ) : null}
              </div>
            </CardContent>
          </Card>

          {!hideEmploymentFields ? (
            <Card>
              <CardHeader>
                <CardTitle>Skills</CardTitle>
              </CardHeader>
              <CardContent>
                <FormField label="Tech Skills" id="skills">
                  <SkillsChipsInput
                    id="skills"
                    value={parseSkillsValue(form.skills)}
                    suggestions={skillSuggestions}
                    onChange={(skills) =>
                      setForm((prev) => ({ ...prev, skills: joinSkillsValue(skills) }))
                    }
                    disabled={skillsLoading}
                  />
                  <p className="text-ex-muted text-xs">
                    {skillsError
                      ? skillsError
                        : "Enter a skill and click Add to create a tag. Click any tag to select it."}
                  </p>
                </FormField>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap justify-end gap-2">
        <Button type="submit" disabled={submitting || headersLoading || !sheetHeaders.length}>
          {submitting ? "Saving…" : isEdit ? "Save Changes" : "Add Employee"}
        </Button>

        {onCancel ? (
          <Button type="button" variant="ghost" disabled={submitting} onClick={onCancel}>
            Cancel
          </Button>
        ) : (
          <Link href={cancelHref}>
            <Button type="button" variant="ghost" disabled={submitting}>
              Cancel
            </Button>
          </Link>
        )}
      </div>
    </form>
  );
}
