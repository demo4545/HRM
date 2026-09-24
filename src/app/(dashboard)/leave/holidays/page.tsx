"use client";

import { readResponseJson } from "@/lib/api/read-response-json";
import {
  CalendarDays,
  CalendarRange,
  List,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useAuth } from "@/contexts/auth-provider";
import { canManageEmployees } from "@/lib/auth/roles";
import { formatIsoDate } from "@/lib/attendance/time";
import { toUserFacingActionError, toUserFacingFetchError } from "@/lib/api/user-facing-error";
import { COMPANY_HOLIDAYS_2026, type CompanyHoliday } from "@/lib/company-holidays";
import { buildMonthCells, WEEKDAY_LABELS } from "@/lib/company-holidays/calendar";
import { cn } from "@/lib/utils";

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const YEAR_OPTIONS = [2025, 2026, 2027, 2028] as const;
const UPCOMING_LIMIT = 6;

type ViewMode = "calendar" | "list";
type TypeFilter = "all" | "leave" | "celebration";

function holidayMatchesFilters(
  holiday: CompanyHoliday,
  params: { search: string; month: string; type: TypeFilter; year: number },
): boolean {
  if (!holiday.date.startsWith(`${params.year}-`)) return false;
  if (params.type !== "all" && holiday.type !== params.type) return false;
  if (params.month !== "all") {
    const monthIndex = Number(holiday.date.slice(5, 7)) - 1;
    if (monthIndex !== Number(params.month)) return false;
  }
  const query = params.search.trim().toLowerCase();
  if (query && !holiday.name.toLowerCase().includes(query)) return false;
  return true;
}

function formatLongDate(iso: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(`${iso}T00:00:00`));
}

function formatShortMonthDay(iso: string): { day: string; month: string } {
  const date = new Date(`${iso}T00:00:00`);
  return {
    day: String(date.getDate()),
    month: new Intl.DateTimeFormat("en-IN", { month: "short" }).format(date),
  };
}

export default function CompanyHolidaysPage() {
  const { user } = useAuth();
  const canManage = user ? canManageEmployees(user.role) : false;
  const [holidayYear, setHolidayYear] = useState(2026);
  const [viewMode, setViewMode] = useState<ViewMode>("calendar");
  const [search, setSearch] = useState("");
  const [holidayMonth, setHolidayMonth] = useState("all");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [holidays, setHolidays] = useState<CompanyHoliday[]>(COMPANY_HOLIDAYS_2026);
  const [editor, setEditor] = useState<{
    id?: string;
    date: string;
    name: string;
    type: "leave" | "celebration";
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<CompanyHoliday | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dayTooltip, setDayTooltip] = useState<{
    name: string;
    typeLabel: string;
    x: number;
    y: number;
    place: "above" | "below";
  } | null>(null);

  const yearHolidays = useMemo(
    () => holidays.filter((holiday) => holiday.date.startsWith(`${holidayYear}-`)),
    [holidays, holidayYear],
  );

  const leaveCount = yearHolidays.filter((holiday) => holiday.type === "leave").length;
  const celebrationCount = yearHolidays.length - leaveCount;

  const filteredHolidays = useMemo(
    () =>
      yearHolidays
        .filter((holiday) =>
          holidayMatchesFilters(holiday, {
            search,
            month: holidayMonth,
            type: typeFilter,
            year: holidayYear,
          }),
        )
        .sort((a, b) => a.date.localeCompare(b.date)),
    [yearHolidays, search, holidayMonth, typeFilter, holidayYear],
  );

  const holidaysByDate = useMemo(() => {
    const map = new Map<string, CompanyHoliday>();
    for (const holiday of filteredHolidays) {
      map.set(holiday.date, holiday);
    }
    return map;
  }, [filteredHolidays]);

  const todayIso = formatIsoDate();

  const upcomingHolidays = useMemo(
    () => filteredHolidays.filter((holiday) => holiday.date >= todayIso).slice(0, UPCOMING_LIMIT),
    [filteredHolidays, todayIso],
  );

  const listGroups = useMemo(() => {
    return MONTH_NAMES.map((month, monthIndex) => ({
      month,
      monthIndex,
      holidays: filteredHolidays.filter(
        (holiday) => Number(holiday.date.slice(5, 7)) - 1 === monthIndex,
      ),
    })).filter((group) => group.holidays.length > 0);
  }, [filteredHolidays]);

  const visibleMonths = useMemo(() => {
    if (holidayMonth === "all") {
      return MONTH_NAMES.map((month, monthIndex) => ({ month, monthIndex }));
    }
    const monthIndex = Number(holidayMonth);
    return [{ month: MONTH_NAMES[monthIndex], monthIndex }];
  }, [holidayMonth]);

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/company-holidays?year=${holidayYear}`, { cache: "no-store" })
      .then(async (response) => {
        const data = await readResponseJson<{
          success?: boolean;
          holidays?: CompanyHoliday[];
          message?: string;
        }>(response, "fetch");
        if (!response.ok || !data.success) {
          throw new Error(data.message ?? "Failed to load company holidays");
        }
        return data.holidays ?? [];
      })
      .then((items) => {
        if (!cancelled) setHolidays(items);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(toUserFacingFetchError(loadError));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [holidayYear]);

  const openCreate = () => {
    setError(null);
    const today = formatIsoDate();
    setEditor({
      date: today.startsWith(`${holidayYear}-`) ? today : `${holidayYear}-01-01`,
      name: "",
      type: "leave",
    });
  };

  const openEdit = (holiday: CompanyHoliday) => {
    setError(null);
    setEditor({
      id: holiday.id,
      date: holiday.date,
      name: holiday.name,
      type: holiday.type,
    });
  };

  const saveHoliday = async () => {
    if (!editor?.date || !editor.name.trim()) {
      setError("Holiday date and name are required.");
      return;
    }

    const duplicate = holidays.find(
      (holiday) => holiday.date === editor.date && holiday.id !== editor.id,
    );
    if (duplicate) {
      setError(
        `A holiday already exists on this date (${duplicate.name}). Edit that holiday to change the name.`,
      );
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/company-holidays", {
        method: editor.id ? "PATCH" : "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editor.id,
          date: editor.date,
          name: editor.name.trim(),
          type: editor.type,
        }),
      });
      const data = await readResponseJson<{
        success?: boolean;
        message?: string;
        holiday?: CompanyHoliday;
      }>(response, "action");
      if (!response.ok || !data.success || !data.holiday) {
        throw new Error(data.message ?? "Failed to save company holiday");
      }

      setHolidays((current) =>
        [...current.filter((holiday) => holiday.id !== data.holiday?.id), data.holiday!].sort(
          (left, right) => left.date.localeCompare(right.date),
        ),
      );
      setHolidayMonth("all");
      setEditor(null);
    } catch (saveError) {
      setError(toUserFacingActionError(saveError));
    } finally {
      setSaving(false);
    }
  };

  const deleteHoliday = async (holiday: CompanyHoliday) => {
    setDeletingId(holiday.id);
    setError(null);
    try {
      const response = await fetch("/api/company-holidays", {
        method: "DELETE",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: holiday.id }),
      });
      const data = await readResponseJson<{ success?: boolean; message?: string }>(
        response,
        "action",
      );
      if (!response.ok || !data.success) {
        throw new Error(data.message ?? "Failed to delete company holiday");
      }
      setHolidays((current) => current.filter((item) => item.id !== holiday.id));
      setEditor((current) => (current?.id === holiday.id ? null : current));
      setPendingDelete(null);
    } catch (deleteError) {
      setError(toUserFacingActionError(deleteError));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Company Holidays"
        description="Official company leave days and workplace celebrations."
      />

      <section className="grid gap-4 sm:grid-cols-3">
        <div className="border-ex-border bg-ex-elevated relative overflow-hidden rounded-xl border p-4 shadow-sm dark:shadow-none">
          <div className="bg-ex-chip-success-bg text-ex-chip-success-fg absolute top-4 right-4 flex size-9 items-center justify-center rounded-full">
            <CalendarDays className="size-4" aria-hidden />
          </div>
          <p className="text-ex-muted text-xs font-medium tracking-wide uppercase">Total holidays</p>
          <p className="text-ex-primary mt-2 text-2xl font-semibold tabular-nums">
            {yearHolidays.length}
          </p>
        </div>
        <div className="border-ex-border bg-ex-elevated relative overflow-hidden rounded-xl border p-4 shadow-sm dark:shadow-none">
          <div className="bg-ex-secondary/15 text-ex-secondary absolute top-4 right-4 flex size-9 items-center justify-center rounded-full">
            <CalendarRange className="size-4" aria-hidden />
          </div>
          <p className="text-ex-muted text-xs font-medium tracking-wide uppercase">Leave days</p>
          <p className="text-ex-primary mt-2 text-2xl font-semibold tabular-nums">{leaveCount}</p>
        </div>
        <div className="border-ex-border bg-ex-elevated relative overflow-hidden rounded-xl border p-4 shadow-sm dark:shadow-none">
          <div className="bg-ex-accent/15 text-ex-accent absolute top-4 right-4 flex size-9 items-center justify-center rounded-full">
            <Sparkles className="size-4" aria-hidden />
          </div>
          <p className="text-ex-muted text-xs font-medium tracking-wide uppercase">Celebrations</p>
          <p className="text-ex-primary mt-2 text-2xl font-semibold tabular-nums">
            {celebrationCount}
          </p>
        </div>
      </section>

      <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center lg:justify-between">
        <div className="border-ex-border bg-ex-elevated inline-flex rounded-lg border p-1">
          <Button
            type="button"
            size="sm"
            variant={viewMode === "calendar" ? "secondary" : "ghost"}
            className="gap-1.5"
            onClick={() => setViewMode("calendar")}
          >
            <CalendarRange className="size-4" />
            Calendar
          </Button>
          <Button
            type="button"
            size="sm"
            variant={viewMode === "list" ? "secondary" : "ghost"}
            className="gap-1.5"
            onClick={() => setViewMode("list")}
          >
            <List className="size-4" />
            List
          </Button>
        </div>

        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 lg:justify-end">
          <div className="relative min-w-48 flex-1 sm:max-w-xs">
            <Search className="text-ex-muted pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search holidays…"
              className="pl-9"
              aria-label="Search holidays"
            />
          </div>
          <Select
            value={holidayMonth}
            onChange={(event) => setHolidayMonth(event.target.value)}
            className="w-36"
            aria-label="Filter by month"
          >
            <option value="all">All months</option>
            {MONTH_NAMES.map((month, index) => (
              <option key={month} value={index}>
                {month}
              </option>
            ))}
          </Select>
          <Select
            value={typeFilter}
            onChange={(event) => setTypeFilter(event.target.value as TypeFilter)}
            className="w-36"
            aria-label="Filter by type"
          >
            <option value="all">All types</option>
            <option value="leave">Leave</option>
            <option value="celebration">Celebration</option>
          </Select>
          <Select
            value={String(holidayYear)}
            onChange={(event) => setHolidayYear(Number(event.target.value))}
            className="w-28"
            aria-label="Holiday year"
          >
            {YEAR_OPTIONS.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </Select>
          {canManage ? (
            <Button size="sm" variant="secondary" onClick={openCreate}>
              <Plus className="size-4" />
              Add Holiday
            </Button>
          ) : null}
        </div>
      </div>

      {editor ? (
        <div className="border-ex-secondary/25 bg-ex-secondary/5 rounded-xl border p-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
            <div className="grid flex-1 gap-4 sm:grid-cols-3">
              <label className="space-y-1.5">
                <span className="text-ex-muted text-xs font-medium tracking-wide uppercase">
                  Date
                </span>
                <Input
                  type="date"
                  min={`${holidayYear}-01-01`}
                  max={`${holidayYear}-12-31`}
                  value={editor.date}
                  onChange={(event) =>
                    setEditor((current) =>
                      current ? { ...current, date: event.target.value } : current,
                    )
                  }
                />
              </label>
              <label className="space-y-1.5">
                <span className="text-ex-muted text-xs font-medium tracking-wide uppercase">
                  Holiday name
                </span>
                <Input
                  value={editor.name}
                  maxLength={120}
                  placeholder="Holiday name"
                  onChange={(event) =>
                    setEditor((current) =>
                      current ? { ...current, name: event.target.value } : current,
                    )
                  }
                />
              </label>
              <label className="space-y-1.5">
                <span className="text-ex-muted text-xs font-medium tracking-wide uppercase">
                  Day type
                </span>
                <Select
                  value={editor.type}
                  onChange={(event) =>
                    setEditor((current) =>
                      current
                        ? {
                            ...current,
                            type: event.target.value as "leave" | "celebration",
                          }
                        : current,
                    )
                  }
                >
                  <option value="leave">Leave</option>
                  <option value="celebration">Celebration</option>
                </Select>
              </label>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                disabled={saving}
                onClick={() => {
                  setEditor(null);
                  setError(null);
                }}
              >
                Cancel
              </Button>
              <Button variant="secondary" disabled={saving} onClick={() => void saveHoliday()}>
                {saving ? "Saving…" : editor.id ? "Update holiday" : "Add holiday"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {error ? (
        <p className="border-ex-banner-danger-border bg-ex-banner-danger-bg text-ex-banner-danger-fg rounded-lg border px-4 py-3 text-sm">
          {error}
        </p>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem] xl:items-start">
        <div className="min-w-0">
          {viewMode === "calendar" ? (
            <div
              className={cn(
                "grid gap-3",
                visibleMonths.length === 1
                  ? "max-w-xs grid-cols-1"
                  : "grid-cols-2 lg:grid-cols-3 xl:grid-cols-4",
              )}
            >
              {visibleMonths.map(({ month, monthIndex }) => {
                const cells = buildMonthCells(holidayYear, monthIndex);
                const monthCount = filteredHolidays.filter(
                  (holiday) => Number(holiday.date.slice(5, 7)) - 1 === monthIndex,
                ).length;

                return (
                  <Card key={month} className="overflow-visible">
                    <CardHeader className="flex flex-row items-center justify-between gap-2 px-2.5 py-2">
                      <CardTitle className="text-sm font-semibold">{month}</CardTitle>
                      {monthCount > 0 ? (
                        <span className="bg-ex-secondary/15 text-ex-secondary inline-flex size-5 items-center justify-center rounded-full text-[10px] font-semibold">
                          {monthCount}
                        </span>
                      ) : null}
                    </CardHeader>
                    <CardContent className="overflow-visible px-2 pb-2">
                      <div className="text-ex-muted mb-0.5 grid grid-cols-7 gap-px text-center text-[9px] font-medium tracking-wide uppercase">
                        {WEEKDAY_LABELS.map((label) => (
                          <span key={label}>{label.slice(0, 1)}</span>
                        ))}
                      </div>
                      <div className="grid grid-cols-7 gap-px">
                        {cells.map((cell) => {
                          if (cell.kind === "empty") {
                            return <div key={cell.key} className="h-6" />;
                          }
                          const holiday = holidaysByDate.get(cell.iso);
                          const isLeave = holiday?.type === "leave";
                          const isCelebration = holiday?.type === "celebration";
                          return (
                            <button
                              key={cell.key}
                              type="button"
                              aria-label={
                                holiday
                                  ? `${holiday.name}, ${holiday.type === "leave" ? "Leave" : "Celebration"}`
                                  : undefined
                              }
                              disabled={!holiday}
                              onMouseEnter={(event) => {
                                if (!holiday) return;
                                const rect = event.currentTarget.getBoundingClientRect();
                                const showBelow = rect.top < 72;
                                setDayTooltip({
                                  name: holiday.name,
                                  typeLabel:
                                    holiday.type === "leave" ? "Leave" : "Celebration",
                                  x: rect.left + rect.width / 2,
                                  y: showBelow ? rect.bottom + 8 : rect.top - 8,
                                  place: showBelow ? "below" : "above",
                                });
                              }}
                              onMouseLeave={() => setDayTooltip(null)}
                              onClick={() => {
                                if (holiday && canManage) openEdit(holiday);
                              }}
                              className={cn(
                                "mx-auto flex size-7 items-center justify-center rounded-full text-[10px] tabular-nums",
                                holiday
                                  ? cn(
                                      "font-semibold text-white",
                                      isLeave && "bg-ex-secondary",
                                      isCelebration && "bg-ex-accent",
                                      canManage ? "hover:opacity-90" : "cursor-default",
                                    )
                                  : "cursor-default text-ex-muted",
                              )}
                            >
                              {cell.day}
                            </button>
                          );
                        })}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          ) : listGroups.length === 0 ? (
            <div className="border-ex-border bg-ex-surface/40 rounded-xl border border-dashed px-6 py-10 text-center">
              <p className="text-ex-primary font-medium">No holidays match your filters</p>
              <p className="text-ex-muted mt-1 text-sm">Try another month, type, or search.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {listGroups.map((group) => (
                <Card key={group.month} className="overflow-hidden">
                  <CardHeader className="bg-ex-surface/40 flex flex-row items-center justify-between px-4 py-3">
                    <CardTitle className="text-sm">{group.month}</CardTitle>
                    <span className="text-ex-muted text-xs">
                      {group.holidays.length} day{group.holidays.length === 1 ? "" : "s"}
                    </span>
                  </CardHeader>
                  <CardContent className="space-y-2 p-4">
                    {group.holidays.map((holiday) => {
                      const short = formatShortMonthDay(holiday.date);
                      const isLeave = holiday.type === "leave";
                      return (
                        <div
                          key={holiday.id}
                          className="border-ex-border bg-ex-surface/40 flex items-start gap-3 rounded-xl border p-3"
                        >
                          <div
                            className={cn(
                              "flex size-11 shrink-0 flex-col items-center justify-center rounded-lg",
                              isLeave
                                ? "bg-ex-secondary/15 text-ex-secondary"
                                : "bg-ex-accent/15 text-ex-accent",
                            )}
                          >
                            <span className="text-sm leading-none font-semibold">{short.day}</span>
                            <span className="mt-1 text-[10px] leading-none uppercase">
                              {short.month}
                            </span>
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="text-ex-primary truncate text-sm font-medium">
                                  {holiday.name}
                                </p>
                                <p className="text-ex-muted mt-0.5 text-xs">
                                  {formatLongDate(holiday.date)}
                                </p>
                              </div>
                              {canManage ? (
                                <div className="flex shrink-0 gap-0.5">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="size-8 p-0"
                                    aria-label={`Edit ${holiday.name}`}
                                    onClick={() => openEdit(holiday)}
                                  >
                                    <Pencil className="size-4" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="size-8 p-0"
                                    disabled={deletingId === holiday.id}
                                    aria-label={`Delete ${holiday.name}`}
                                    onClick={() => setPendingDelete(holiday)}
                                  >
                                    <Trash2 className="size-4 text-red-600 dark:text-red-400" />
                                  </Button>
                                </div>
                              ) : null}
                            </div>
                            <Badge
                              variant={isLeave ? "default" : "accent"}
                              className={cn(
                                "mt-2",
                                isLeave &&
                                  "border-ex-secondary/30 bg-ex-secondary/10 text-ex-secondary",
                              )}
                            >
                              {isLeave ? "Leave" : "Celebration"}
                            </Badge>
                          </div>
                        </div>
                      );
                    })}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        <aside className="border-ex-border bg-ex-elevated rounded-xl border p-4 shadow-sm xl:sticky xl:top-4 dark:shadow-none">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-ex-primary text-sm font-semibold">Upcoming Holidays</h2>
            <button
              type="button"
              className="text-ex-secondary text-xs font-medium underline-offset-2 hover:underline"
              onClick={() => {
                setViewMode("list");
                setHolidayMonth("all");
                setSearch("");
                setTypeFilter("all");
              }}
            >
              View all →
            </button>
          </div>
          {upcomingHolidays.length === 0 ? (
            <p className="text-ex-muted text-sm">No upcoming holidays in this view.</p>
          ) : (
            <ul className="space-y-3">
              {upcomingHolidays.map((holiday) => {
                const short = formatShortMonthDay(holiday.date);
                const isLeave = holiday.type === "leave";
                return (
                  <li key={holiday.id} className="flex items-start gap-3">
                    <div
                      className={cn(
                        "flex size-11 shrink-0 flex-col items-center justify-center rounded-lg border text-center",
                        isLeave
                          ? "border-ex-secondary/25 bg-ex-secondary/10 text-ex-secondary"
                          : "border-ex-accent/25 bg-ex-accent/10 text-ex-accent",
                      )}
                    >
                      <span className="text-sm leading-none font-semibold">{short.day}</span>
                      <span className="mt-1 text-[10px] leading-none uppercase">{short.month}</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-ex-primary truncate text-sm font-medium">
                            {holiday.name}
                          </p>
                          <p className="text-ex-muted mt-0.5 text-xs">
                            {formatLongDate(holiday.date)}
                          </p>
                        </div>
                        <Badge
                          variant={isLeave ? "default" : "accent"}
                          className={cn(
                            "shrink-0",
                            isLeave &&
                              "border-ex-secondary/30 bg-ex-secondary/10 text-ex-secondary",
                          )}
                        >
                          {isLeave ? "Leave" : "Celebration"}
                        </Badge>
                      </div>
                      {canManage ? (
                        <div className="mt-1.5 flex gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            onClick={() => openEdit(holiday)}
                          >
                            Edit
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs text-red-600 dark:text-red-400"
                            disabled={deletingId === holiday.id}
                            onClick={() => setPendingDelete(holiday)}
                          >
                            Delete
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>
      </div>

      <ConfirmationDialog
        open={Boolean(pendingDelete)}
        title="Delete holiday?"
        description={
          pendingDelete ? (
            <>
              Remove <span className="text-ex-primary font-medium">“{pendingDelete.name}”</span>{" "}
              from the company holiday calendar?
            </>
          ) : (
            ""
          )
        }
        busy={Boolean(deletingId)}
        busyText="Deleting…"
        confirmText="Delete"
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) void deleteHoliday(pendingDelete);
        }}
        icon={<Trash2 className="size-5 text-white" aria-hidden />}
      />

      {dayTooltip ? (
        <div
          role="tooltip"
          className={cn(
            "border-ex-border bg-ex-elevated text-ex-primary pointer-events-none fixed z-50 w-max max-w-56 -translate-x-1/2 rounded-lg border px-3 py-2 text-left shadow-md dark:shadow-none",
            dayTooltip.place === "above" ? "-translate-y-full" : null,
          )}
          style={{ left: dayTooltip.x, top: dayTooltip.y }}
        >
          <p className="text-sm font-semibold">{dayTooltip.name}</p>
          <p className="text-ex-muted mt-0.5 text-xs">{dayTooltip.typeLabel}</p>
        </div>
      ) : null}
    </div>
  );
}
