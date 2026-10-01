"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Pencil } from "lucide-react";

import { ROLES } from "@/app/consts/common";
import { PageHeader } from "@/components/ui/page-header";
import { AccessDenied } from "@/components/ui/access-denied";
import { Button } from "@/components/ui/button";
import { FormSkeleton } from "@/components/ui/form-skeleton";
import { EmployeeProfileView } from "@/components/employee/employee-profile-view";
import { useAuth } from "@/contexts/auth-provider";
import { readResponseJson } from "@/lib/api/read-response-json";
import { toUserFacingFetchError } from "@/lib/api/user-facing-error";
import { sheetRowToForm, type EmployeeFormState } from "@/lib/employee";

export default function EmployeeProfileByRowPage() {
  const router = useRouter();
  const params = useParams();
  const { user, loading: authLoading } = useAuth();
  const [form, setForm] = useState<EmployeeFormState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const sheetRow = Number(params.sheetRow);
  const validRow = Number.isFinite(sheetRow) && sheetRow >= 2;
  const canManage = user?.role === ROLES.HR_MANAGER || user?.role === ROLES.SUPER_ADMIN;

  useEffect(() => {
    if (authLoading) return;
    if (!canManage) {
      router.replace("/employee/profile");
      return;
    }
    if (!validRow) {
      router.replace("/employee");
    }
  }, [authLoading, canManage, router, validRow]);

  useEffect(() => {
    if (authLoading || !canManage || !validRow) return;

    const loadProfile = async () => {
      try {
        setLoading(true);
        setError(null);
        const response = await fetch(`/api/employee?row=${sheetRow}`);
        const result = await readResponseJson<{
          success?: boolean;
          message?: string;
          headers?: string[];
          row?: string[];
        }>(response, "fetch");

        if (!result.success) {
          setError(toUserFacingFetchError(result.message ?? "Employee not found."));
          return;
        }

        const headers = result.headers ?? [];
        setForm(sheetRowToForm(headers, result.row ?? []));
      } catch (error) {
        setError(toUserFacingFetchError(error));
      } finally {
        setLoading(false);
      }
    };

    void loadProfile();
  }, [authLoading, canManage, sheetRow, validRow]);

  if (authLoading || !canManage || !validRow) {
    return null;
  }

  if (loading) {
    return (
      <div className="space-y-8">
        <PageHeader title="Employee Profile" description="Loading employee record…" />
        <FormSkeleton label="Loading Profile…" fields={8} />
      </div>
    );
  }

  if (error || !form) {
    return (
      <div className="space-y-8">
        <PageHeader title="Employee Profile" />
        <AccessDenied
          title="Profile Unavailable"
          description={error ?? "Employee not found."}
          action={
            <Link href="/employee">
              <Button variant="outline" size="sm">
                <ArrowLeft className="size-4" />
                Back to Directory
              </Button>
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Employee Profile"
        description={`Viewing ${form.name || "employee"}'s details.`}
        actions={
          <>
            <Link href="/employee">
              <Button variant="outline" size="sm">
                <ArrowLeft className="size-4" />
                Back to Directory
              </Button>
            </Link>
            <Link href={`/employee/${sheetRow}/edit`}>
              <Button size="sm">
                <Pencil className="size-4" />
                Edit
              </Button>
            </Link>
          </>
        }
      />
      <EmployeeProfileView form={form} employeeSheetRow={sheetRow} />
    </div>
  );
}
