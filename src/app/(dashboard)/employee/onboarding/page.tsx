"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { UserMinus, UserPlus } from "lucide-react";

import { ROLES } from "@/app/consts/common";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
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

function formatEmployeeOptionLabel(name: string, employeeId: string, role: string): string {
  const idPart = employeeId ? ` (${employeeId})` : "";
  const rolePart = role ? ` — ${formatEmployeeRole(role)}` : "";
  return `${name}${idPart}${rolePart}`;
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

  const canViewInactive = user?.role === ROLES.HR_MANAGER || user?.role === ROLES.SUPER_ADMIN;

  const { activeEmployees, inactiveEmployees } = useMemo(() => {
    const active = employees.filter((e) => !isEmployeeInactive(e.status));
    const inactive = canViewInactive ? employees.filter((e) => isEmployeeInactive(e.status)) : [];
    return { activeEmployees: active, inactiveEmployees: inactive };
  }, [employees, canViewInactive]);

  useEffect(() => {
    void dispatch(fetchEmployeeList());
  }, [dispatch]);

  const handleOffboard = async () => {
    if (!selectedEmployee) {
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
          sheetRow: selectedEmployee,
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
        description="Checklists, asset assignments, and exit interviews. Hook these steps to Google Drive document packs and Slack channels."
        actions={
          <Link href="/employee/new">
            <Button size="sm">
              <UserPlus className="size-4" />
              Add
            </Button>
          </Link>
        }
      />
      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>Off Boarding</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="offboard-employee">Employee</Label>
            <Select
              id="offboard-employee"
              value={selectedEmployee}
              onChange={(e) => setSelectedEmployee(e.target.value)}
              disabled={isBusy}
            >
              <option value="" disabled>
                {loading ? "Loading employees…" : "Select"}
              </option>
              {activeEmployees.map((employee) => (
                <option key={employee.sheetRow} value={employee.sheetRow}>
                  {formatEmployeeOptionLabel(employee.name, employee.employeeId, employee.role)}
                </option>
              ))}
              {inactiveEmployees.length > 0 ? (
                <optgroup label="Inactive">
                  {inactiveEmployees.map((employee) => (
                    <option
                      key={employee.sheetRow}
                      value={employee.sheetRow}
                      disabled
                      title="This user is inactive"
                    >
                      {formatEmployeeOptionLabel(
                        employee.name,
                        employee.employeeId,
                        employee.role,
                      )}{" "}
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </Select>
            {!loading && employees.length === 0 ? (
              <p className="text-ex-muted text-sm">No employees found.</p>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="last-working-day">Last working day</Label>
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
            <UserMinus className="size-4" />
            {offboarding ? "Offboarding…" : "Off board"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
