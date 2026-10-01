"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

import { SystemSpecsForm } from "@/components/system-specs/system-specs-form";
import { AccessDenied } from "@/components/ui/access-denied";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/auth-provider";
import { useNotifications } from "@/contexts/notifications-provider";
import { ROLES } from "@/app/consts/common";
import { readResponseJson } from "@/lib/api/read-response-json";
import { toUserFacingActionError, toUserFacingFetchError } from "@/lib/api/user-facing-error";
import {
  emptySystemSpecsForm,
  recordToFormState,
  type SystemSpecsFormState,
  type SystemSpecsRecord,
} from "@/lib/system-specs/types";

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

export default function EmployeeSystemSpecsPage() {
  const { user, loading: authLoading } = useAuth();
  const { pushToast } = useNotifications();
  const isSuperAdmin = user?.role === ROLES.SUPER_ADMIN;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<SystemSpecsFormState>(emptySystemSpecsForm());
  const [hasExisting, setHasExisting] = useState(false);

  const loadOwn = useCallback(async () => {
    if (!user || isSuperAdmin) return;
    setLoading(true);
    try {
      const res = await fetch("/api/system-specs?me=1", {
        credentials: "include",
        cache: "no-store",
      });
      const json = await readResponseJson<{
        success?: boolean;
        message?: string;
        required?: boolean;
        specs?: SystemSpecsRecord | null;
      }>(res, "fetch");

      if (!json.success) {
        throw new Error(json.message ?? "Failed to load your system specifications");
      }

      setForm(recordToFormState(json.specs ?? null));
      setHasExisting(Boolean(json.specs));
    } catch (err) {
      pushToast({
        title: "Could Not Load Specifications",
        body: toUserFacingFetchError(err),
        variant: "error",
      });
    } finally {
      setLoading(false);
    }
  }, [user, isSuperAdmin, pushToast]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load
    void loadOwn();
  }, [loadOwn]);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const res = await fetch("/api/system-specs", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ me: true, ...form }),
      });
      const json = await readResponseJson<{
        success?: boolean;
        message?: string;
        specs?: SystemSpecsRecord;
      }>(res, "action");
      if (!json.success || !json.specs) {
        throw new Error(json.message ?? "Failed to save");
      }
      setForm(recordToFormState(json.specs));
      setHasExisting(true);
      pushToast({
        title: "Specifications Saved",
        body: "Your system specifications were saved successfully.",
        variant: "success",
      });
      window.scrollTo({ top: 0, behavior: "smooth" });
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

  if (authLoading) return null;

  if (!user) {
    return (
      <div className="space-y-6">
        <PageHeader title="System Specifications" />
        <AccessDenied />
      </div>
    );
  }

  if (isSuperAdmin) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="System Specifications"
          description="Super Admin accounts are not required to submit system specifications."
        />
        <AccessDenied
          title="Not Required"
          description="Use Access Control → System Specifications to view or edit employee details."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="System Specifications"
        description="Add or update your workstation hardware details and system login credentials."
      />

      <Card>
        <CardHeader>
          <CardTitle>{hasExisting ? "Edit Your Specifications" : "Add Your Specifications"}</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <SystemSpecsFormSkeleton />
          ) : (
            <SystemSpecsForm
              value={form}
              onChange={setForm}
              onSubmit={onSubmit}
              saving={saving}
              submitLabel={hasExisting ? "Update Specifications" : "Save Specifications"}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
