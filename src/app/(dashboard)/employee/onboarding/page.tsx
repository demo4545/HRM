"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { UserMinus, UserPlus } from "lucide-react";

import { ROLES } from "@/app/consts/common";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Textarea } from "@/components/ui/textarea";
import { DateInput } from "@/components/ui/date-input";
import { useAuth } from "@/contexts/auth-provider";
import { useNotifications } from "@/contexts/notifications-provider";
import { toUserFacingActionError } from "@/lib/api/user-facing-error";
import { todayIsoDate } from "@/lib/employee";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  fetchEmployeeList,
  formatEmployeeRole,
  isEmployeeInactive,
  offboardEmployee,
  selectEmployeeListLoading,
  selectEmployeeOffboarding,
  selectOffboardingEmployeeOptions,
} from "@/store/slices/employee-list-slice";

function formatEmployeeOptionLabel(name: string, role: string): string {
  const rolePart = role ? ` — ${formatEmployeeRole(role)}` : "";
  return `${name}${rolePart}`;
}

export default function OnboardingPage() {
  const { user } = useAuth();
  const { pushToast } = useNotifications();
  const dispatch = useAppDispatch();
  const [selectedEmployee, setSelectedEmployee] = useState("");
  const [lastWorkingDay, setLastWorkingDay] = useState("");
  const [reason, setReason] = useState("");

  const loading = useAppSelector(selectEmployeeListLoading);
  const offboarding = useAppSelector(selectEmployeeOffboarding);
  const employees = useAppSelector((state) => selectOffboardingEmployeeOptions(state, user?.role));

  const { activeEmployees } = useMemo(() => {
    // HR cannot offboard themselves — hide own profile from the list.
    const selfSheetRow =
      user?.role === ROLES.HR_MANAGER && user.sheetRow != null ? String(user.sheetRow) : null;
    const withoutSelf = selfSheetRow
      ? employees.filter((employee) => String(employee.sheetRow) !== selfSheetRow)
      : employees;
    const active = withoutSelf.filter((e) => !isEmployeeInactive(e.status));
    return { activeEmployees: active };
  }, [employees, user]);

  const employeeOptions = useMemo(
    () =>
      activeEmployees.map((employee) => ({
        value: String(employee.sheetRow),
        label: formatEmployeeOptionLabel(employee.name, employee.role),
      })),
    [activeEmployees],
  );

  const selectedEmployeeValue = employeeOptions.some((option) => option.value === selectedEmployee)
    ? selectedEmployee
    : "";

  useEffect(() => {
    void dispatch(fetchEmployeeList());
  }, [dispatch]);

  const handleOffboard = async () => {
    if (!selectedEmployeeValue) {
      pushToast({
        title: "Offboarding Failed",
        body: "Please select an employee.",
        variant: "error",
      });
      return;
    }
    if (!lastWorkingDay.trim()) {
      pushToast({
        title: "Offboarding Failed",
        body: "Last working day is required.",
        variant: "error",
      });
      return;
    }
    if (lastWorkingDay.trim() < todayIsoDate()) {
      pushToast({
        title: "Offboarding Failed",
        body: "Last working day cannot be a past date.",
        variant: "error",
      });
      return;
    }
    if (!reason.trim()) {
      pushToast({
        title: "Offboarding Failed",
        body: "Offboarding reason is required.",
        variant: "error",
      });
      return;
    }

    try {
      await dispatch(
        offboardEmployee({
          sheetRow: selectedEmployeeValue,
          lastWorkingDay: lastWorkingDay.trim(),
          reason: reason.trim(),
        }),
      ).unwrap();

      pushToast({
        title: "Employee Offboarded",
        body: "Employee offboarded and marked inactive.",
        variant: "success",
      });
      setSelectedEmployee("");
      setLastWorkingDay("");
      setReason("");
      void dispatch(fetchEmployeeList());
    } catch (err) {
      pushToast({
        title: "Offboarding Failed",
        body: toUserFacingActionError(err),
        variant: "error",
      });
    }
  };

  const isBusy = loading || offboarding;

  return (
    <div className="space-y-8">
      <PageHeader
        title="On Boarding & Off Boarding"
        description="Add new hires to the roster, or offboard employees with last working day and exit notes."
      />

      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
        <Card className="overflow-hidden">
          <CardHeader className="bg-ex-surface/40">
            <div className="flex items-start gap-3">
              <div className="bg-ex-secondary/15 text-ex-secondary flex size-11 shrink-0 items-center justify-center rounded-xl">
                <UserPlus className="size-5" aria-hidden />
              </div>
              <div className="min-w-0">
                <CardTitle>On Boarding</CardTitle>
                <p className="text-ex-muted mt-1 text-sm leading-relaxed">
                  Create a new employee profile with role, documents, and joining details.
                </p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 pt-5 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-ex-muted text-sm">
              Opens the employee form to add someone to the active roster.
            </p>
            <Link href="/employee/new" className="shrink-0 self-start sm:self-auto">
              <Button size="md" type="button">
                <UserPlus className="size-4" aria-hidden />
                Add Employee
              </Button>
            </Link>
          </CardContent>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader className="bg-ex-surface/40">
            <div className="flex items-start gap-3">
              <div className="bg-ex-chip-danger-bg text-ex-chip-danger-fg flex size-11 shrink-0 items-center justify-center rounded-xl">
                <UserMinus className="size-5" aria-hidden />
              </div>
              <div className="min-w-0">
                <CardTitle>Off Boarding</CardTitle>
                <p className="text-ex-muted mt-1 text-sm leading-relaxed">
                  Mark an employee inactive with last working day and exit reason.
                </p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 pt-5">
            <div className="space-y-2">
              <Label htmlFor="offboard-employee">Employee</Label>
              <SearchableSelect
                id="offboard-employee"
                options={employeeOptions}
                value={selectedEmployeeValue}
                onChange={setSelectedEmployee}
                placeholder={loading ? "Loading Employees…" : "Select"}
                searchPlaceholder="Search Employee…"
                emptyMessage="No Matching Employees"
                disabled={isBusy || loading}
              />
              {!loading && activeEmployees.length === 0 ? (
                <p className="text-ex-muted text-sm">No Employees Found.</p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="last-working-day">Last Working Day</Label>
              <DateInput
                id="last-working-day"
                value={lastWorkingDay}
                onChange={setLastWorkingDay}
                minDate={todayIsoDate()}
                maxYear={new Date().getFullYear() + 1}
                disabled={isBusy}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="offboard-reason">Reason</Label>
              <Textarea
                id="offboard-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Reason for leaving, handover notes, etc."
                rows={4}
                disabled={isBusy}
                required
              />
            </div>
            <Button
              type="button"
              className="w-full sm:w-auto"
              disabled={isBusy || activeEmployees.length === 0}
              onClick={() => void handleOffboard()}
            >
              <UserMinus className="size-4" aria-hidden />
              {offboarding ? "Offboarding…" : "Off Board"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
