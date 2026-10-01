"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter, useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { EmployeeForm } from "@/components/employee/employee-form";
import { useAuth } from "@/contexts/auth-provider";
import { ROLES } from "@/app/consts/common";

export default function EditEmployeePage() {
  const router = useRouter();
  const params = useParams();
  const { user, loading: authLoading } = useAuth();

  const sheetRow = Number(params.sheetRow);
  const validRow = Number.isFinite(sheetRow) && sheetRow >= 2;

  const canManage = user?.role === ROLES.HR_MANAGER || user?.role === ROLES.SUPER_ADMIN;

  useEffect(() => {
    if (authLoading) return;
    if (!canManage) router.replace("/employee");
    if (!validRow) router.replace("/employee");
  }, [authLoading, canManage, router, validRow]);

  if (authLoading || !canManage || !validRow) {
    return null;
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Edit Employee"
        actions={
          <Link href="/employee">
            <Button variant="outline" size="sm">
              <ArrowLeft className="size-4" />
              Back
            </Button>
          </Link>
        }
      />

      <EmployeeForm mode="edit" sheetRow={sheetRow} />
    </div>
  );
}
