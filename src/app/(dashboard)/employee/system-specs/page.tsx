"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

import { SystemSpecsForm } from "@/components/system-specs/system-specs-form";
import { AccessDenied } from "@/components/ui/access-denied";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
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

export default function EmployeeSystemSpecsPage() {
  const { user, loading: authLoading } = useAuth();
  const { pushToast } = useNotifications();
  const isSuperAdmin = user?.role === ROLES.SUPER_ADMIN;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<SystemSpecsFormState>(emptySystemSpecsForm());
  const [hasExisting, setHasExisting] = useState(false);

  const loadOwn = useCallback(async () => {
    if (!user || isSuperAdmin) return;
    setLoading(true);
    setError(null);
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
      setError(toUserFacingFetchError(err));
    } finally {
      setLoading(false);
    }
  }, [user, isSuperAdmin]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load
    void loadOwn();
  }, [loadOwn]);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
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
        title: "Specifications saved",
        body: "Your system specifications were saved successfully.",
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
        <PageHeader title="My System Specs" />
        <AccessDenied />
      </div>
    );
  }

  if (isSuperAdmin) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="My System Specs"
          description="Super Admin accounts are not required to submit system specifications."
        />
        <AccessDenied
          title="Not required"
          description="Use Access Control → System Specifications to view or edit employee details."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="My System Specs"
        description="Add or update your workstation hardware details and system login credentials."
      />

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{hasExisting ? "Edit your specifications" : "Add your specifications"}</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-ex-muted text-sm">Loading your specifications…</p>
          ) : (
            <SystemSpecsForm
              value={form}
              onChange={setForm}
              onSubmit={onSubmit}
              saving={saving}
              submitLabel={hasExisting ? "Update specifications" : "Save specifications"}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
