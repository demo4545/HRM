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

import { plusDaysIso, printLetter, todayIso } from "../../_shared/letter-utils";
import styles from "../../_shared/letter.module.css";
import { buildOfferLetterData, partTimeHoursMeetMinimum } from "./generate";
import OfferLetterTemplate from "./letter-template";
import type { InternshipType, OfferFormState } from "./types";

export default function InternshipOfferLetterPage() {
  const { user } = useAuth();
  const canManage = user ? canManageEmployees(user.role) : false;
  const { branding } = useCompanyBranding();

  const [form, setForm] = useState<OfferFormState>({
    candidateName: "",
    position: "",
    internshipType: "full-time",
    partTimeStart: "",
    partTimeEnd: "",
    durationStart: "",
    durationEnd: "",
    offerDate: todayIso(),
    acceptanceDeadline: plusDaysIso(3),
  });

  function update<K extends keyof OfferFormState>(key: K, value: OfferFormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  const data = useMemo(
    () =>
      buildOfferLetterData(form, {
        name: branding.companyName,
        address: branding.companyAddress,
      }),
    [form, branding.companyName, branding.companyAddress],
  );

  const partTimeHoursValid =
    form.internshipType === "full-time" ||
    partTimeHoursMeetMinimum(form.partTimeStart, form.partTimeEnd);
  const showPartTimeHoursError =
    form.internshipType === "part-time" &&
    Boolean(form.partTimeStart && form.partTimeEnd) &&
    !partTimeHoursMeetMinimum(form.partTimeStart, form.partTimeEnd);

  const isReady = Boolean(
    form.candidateName.trim() &&
    form.position.trim() &&
    form.durationStart &&
    form.durationEnd &&
    form.offerDate &&
    partTimeHoursValid,
  );

  if (!canManage) {
    return (
      <div className="space-y-8">
        <PageHeader title="Internship Offer Letter" description="Generate an internship offer." />
        <AccessDenied
          description="Document generation is only available to HR and Super Admin."
          action={
            <Link href="/documents/internship">
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
        title="Internship Offer Letter"
        description="Fill in the candidate and internship details."
        actions={
          <Link href="/documents/internship">
            <Button variant="outline" size="sm">
              <ArrowLeft className="size-4" />
              Back to documents
            </Button>
          </Link>
        }
      />

      <div className="divide-ex-border -mx-4 grid min-h-0 flex-1 grid-cols-1 gap-6 px-2 lg:mx-0 lg:grid-cols-2 lg:gap-0 lg:divide-x lg:overflow-hidden lg:px-0">
        <div className="lg:overflow-y-auto lg:pr-6">
          <Card className="print:hidden">
            <CardHeader>
              <CardTitle className="text-base">Details</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="space-y-2">
                <Label htmlFor="candidateName">Candidate name</Label>
                <Input
                  id="candidateName"
                  value={form.candidateName}
                  onChange={(e) => update("candidateName", e.target.value)}
                  placeholder="Full Name"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="position">Position</Label>
                <Input
                  id="position"
                  value={form.position}
                  onChange={(e) => update("position", e.target.value)}
                  placeholder="e.g. Java Backend Developer"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="internshipType">Type</Label>
                <Select
                  id="internshipType"
                  value={form.internshipType}
                  onChange={(e) => update("internshipType", e.target.value as InternshipType)}
                >
                  <option value="full-time">Full-Time</option>
                  <option value="part-time">Part-Time</option>
                </Select>
              </div>

              {form.internshipType === "part-time" ? (
                <div className="grid gap-2">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="partTimeStart">Working Hours Start</Label>
                      <Input
                        id="partTimeStart"
                        type="time"
                        value={form.partTimeStart}
                        onChange={(e) => update("partTimeStart", e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="partTimeEnd">Working Hours End</Label>
                      <Input
                        id="partTimeEnd"
                        type="time"
                        value={form.partTimeEnd}
                        onChange={(e) => update("partTimeEnd", e.target.value)}
                      />
                    </div>
                  </div>
                  {showPartTimeHoursError ? (
                    <p className="text-xs text-red-600 dark:text-red-400">
                      Part-time working hours must be at least 4 hours.
                    </p>
                  ) : null}
                </div>
              ) : (
                <p className="text-ex-muted text-xs">Full-time working hours: 9:30 AM to 6:30 PM</p>
              )}

              <div className="space-y-2">
                <Label htmlFor="durationStart">Duration start</Label>
                <Input
                  id="durationStart"
                  type="date"
                  value={form.durationStart}
                  onChange={(e) => update("durationStart", e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="durationEnd">Duration end</Label>
                <Input
                  id="durationEnd"
                  type="date"
                  value={form.durationEnd}
                  onChange={(e) => update("durationEnd", e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="offerDate">Offer date</Label>
                <Input
                  id="offerDate"
                  type="date"
                  value={form.offerDate}
                  onChange={(e) => update("offerDate", e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="acceptanceDeadline">Acceptance deadline</Label>
                <Input
                  id="acceptanceDeadline"
                  type="date"
                  value={form.acceptanceDeadline}
                  onChange={(e) => update("acceptanceDeadline", e.target.value)}
                />
              </div>

              <Button onClick={printLetter} disabled={!isReady} className="mt-1">
                Print / Save PDF
              </Button>
              {!isReady ? (
                <p className="text-ex-muted text-xs">
                  Fill in the candidate, position, type, and dates to enable printing.
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
              <OfferLetterTemplate data={data} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
