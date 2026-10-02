"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { PageHeader } from "@/components/ui/page-header";
import { AccessDenied } from "@/components/ui/access-denied";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/auth-provider";
import { canManageEmployees } from "@/lib/auth/roles";
import { useCompanyBranding } from "@/lib/branding/use-company-branding";

import { useLetterEmployees } from "../../_shared/use-letter-employees";
import { TITLE_OPTIONS, printLetter, todayIso, type Title } from "../../_shared/letter-utils";
import styles from "../../_shared/letter.module.css";
import { buildNocData } from "./generate";
import NocTemplate from "./letter-template";
import type { NocFormState } from "./types";

export default function NocPage() {
  const { user } = useAuth();
  const canManage = user ? canManageEmployees(user.role) : false;
  const { branding } = useCompanyBranding();
  const { employees, loading, error } = useLetterEmployees(canManage);

  const [form, setForm] = useState<NocFormState>({
    employeeSheetRow: "",
    candidateName: "",
    title: "Mr",
    date: todayIso(),
  });

  function update<K extends keyof NocFormState>(key: K, value: NocFormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function selectEmployee(sheetRow: string) {
    const employee = employees.find((e) => e.sheetRow === sheetRow);
    setForm((prev) => ({
      ...prev,
      employeeSheetRow: sheetRow,
      candidateName: employee?.name ?? "",
    }));
  }

  const data = useMemo(
    () =>
      buildNocData(form, {
        name: branding.companyName,
        address: branding.companyAddress,
      }),
    [form, branding.companyName, branding.companyAddress],
  );

  const isReady = Boolean(form.candidateName.trim() && form.date);

  if (!canManage) {
    return (
      <div className="space-y-8">
        <PageHeader
          title="Non-Objection Certificate"
          description="Generate a non-objection certificate for an employee."
        />
        <AccessDenied
          description="Document generation is only available to HR and Super Admin."
          action={
            <Link href="/documents/employee">
              <Button variant="outline" size="sm">
                <ArrowLeft className="size-4" />
                Back to documents
              </Button>
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 lg:h-[calc(100dvh-8.5rem)] lg:overflow-hidden">
      <PageHeader
        className="shrink-0"
        title="Non-Objection Certificate"
        description="Pick an employee and fill in the certificate date."
        actions={
          <Link href="/documents/employee">
            <Button variant="outline" size="sm">
              <ArrowLeft className="size-4" />
              Back to documents
            </Button>
          </Link>
        }
      />

      {error ? (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </p>
      ) : null}

      <div className="divide-ex-border -mx-4 grid min-h-0 flex-1 grid-cols-1 gap-6 px-2 lg:mx-0 lg:grid-cols-2 lg:gap-0 lg:divide-x lg:overflow-hidden lg:px-0">
        <div className="lg:overflow-y-auto lg:pr-6">
          <Card className="print:hidden">
            <CardHeader>
              <CardTitle className="text-base">Details</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="space-y-2">
                <Label htmlFor="candidate">Employee</Label>
                <Select
                  id="candidate"
                  value={form.employeeSheetRow}
                  onChange={(e) => selectEmployee(e.target.value)}
                  disabled={loading}
                >
                  <option value="">{loading ? "Loading Employees…" : "Select Employee"}</option>
                  {employees.map((employee) => (
                    <option key={employee.sheetRow} value={employee.sheetRow}>
                      {employee.name} ({employee.employeeId})
                    </option>
                  ))}
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="title">Title</Label>
                <Select
                  id="title"
                  value={form.title}
                  onChange={(e) => update("title", e.target.value as Title)}
                >
                  {TITLE_OPTIONS.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="date">Issue Date</Label>
                <Input
                  id="date"
                  type="date"
                  value={form.date}
                  onChange={(e) => update("date", e.target.value)}
                />
              </div>

              <Button onClick={printLetter} disabled={!isReady} className="mt-1">
                Print / Save PDF
              </Button>
              {!isReady ? (
                <p className="text-ex-muted text-xs">
                  Select an employee and set the date to enable printing.
                </p>
              ) : null}
            </CardContent>
          </Card>
        </div>

        <div className="min-h-0 lg:pl-6">
          <div
            className={`${styles.previewPanel} border-ex-border bg-ex-elevated/40 overflow-x-hidden overflow-y-auto rounded-xl border p-4 lg:h-full print:overflow-visible print:border-0 print:bg-transparent print:p-0`}
          >
            <div className={styles.previewScaler}>
              <NocTemplate data={data} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
