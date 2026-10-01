"use client";

import { readResponseJson } from "@/lib/api/read-response-json";
import { useEffect, useState } from "react";

import { PageHeader } from "@/components/ui/page-header";
import { AccessDenied } from "@/components/ui/access-denied";
import { FormSkeleton } from "@/components/ui/form-skeleton";
import { EmployeeForm } from "@/components/employee/employee-form";
import { EmployeeProfileView } from "@/components/employee/employee-profile-view";
import { useAuth } from "@/contexts/auth-provider";
import { isAccountInactiveRedirectError } from "@/lib/account-inactive-client";
import { toUserFacingFetchError } from "@/lib/api/user-facing-error";
import { sheetRowToForm, type EmployeeFormState } from "@/lib/employee";

export default function EmployeeProfilePage() {
  const { user, loading: authLoading } = useAuth();
  const [form, setForm] = useState<EmployeeFormState | null>(null);
  const [sheetRow, setSheetRow] = useState<number | null>(null);
  const [hasPassword, setHasPassword] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadProfile = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch("/api/employee/me");
      const result = await readResponseJson<{
        success?: boolean;
        message?: string;
        [key: string]: unknown;
      }>(response, "fetch");

      if (!result.success) {
        setError(toUserFacingFetchError(result.message ?? "Failed to load your profile."));
        return;
      }

      const headers = (result.headers as string[]) ?? [];
      setForm(sheetRowToForm(headers, (result.row as string[]) ?? []));
      const resolvedSheetRow = typeof result.sheetRow === "number" ? result.sheetRow : null;
      setSheetRow(resolvedSheetRow);
      setHasPassword(Boolean(result.hasPassword));
    } catch (error) {
      if (isAccountInactiveRedirectError(error)) return;
      setError(toUserFacingFetchError(error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (authLoading || !user) return;

    let cancelled = false;
    void (async () => {
      try {
        setLoading(true);
        setError(null);
        const response = await fetch("/api/employee/me");
        const result = await readResponseJson<{
          success?: boolean;
          message?: string;
          [key: string]: unknown;
        }>(response, "fetch");
        if (cancelled) return;

        if (!result.success) {
          setError(toUserFacingFetchError(result.message ?? "Failed to load your profile."));
          return;
        }

        const headers = (result.headers as string[]) ?? [];
        setForm(sheetRowToForm(headers, (result.row as string[]) ?? []));
        const resolvedSheetRow = typeof result.sheetRow === "number" ? result.sheetRow : null;
        setSheetRow(resolvedSheetRow);
        setHasPassword(Boolean(result.hasPassword));
      } catch (error) {
        if (cancelled || isAccountInactiveRedirectError(error)) return;
        setError(toUserFacingFetchError(error));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authLoading, user]);

  if (authLoading || loading) {
    return (
      <div className="space-y-8">
        <PageHeader title="Employee Profile" description="Your basic employment details." />
        <FormSkeleton label="Loading profile…" fields={8} />
      </div>
    );
  }

  if (!user) {
    return null;
  }

  if (error || !form) {
    return (
      <div className="space-y-8">
        <PageHeader title="Employee Profile" description="Your basic employment details." />
        <AccessDenied
          title="Profile unavailable"
          description={
            error ??
            "We could not find an employee record for your login. Contact HR if this is unexpected."
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Profile"
        description={
          isEditing
            ? "Update your details and save changes."
            : "View your details and manage your sign-in username and password."
        }
      />
      {isEditing && sheetRow ? (
        <EmployeeForm
          mode="edit"
          sheetRow={sheetRow}
          useOwnProfileEndpoint
          onSaved={() => {
            setIsEditing(false);
            void loadProfile();
          }}
          onCancel={() => setIsEditing(false)}
        />
      ) : (
        <EmployeeProfileView
          form={form}
          loadOwnSpecs
          showAccountSettings
          hasPassword={hasPassword}
          onEdit={sheetRow ? () => setIsEditing(true) : undefined}
          onPasswordUpdated={() => void loadProfile()}
        />
      )}
    </div>
  );
}
