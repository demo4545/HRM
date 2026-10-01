"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import { CalendarIcon, ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";

const SHORT_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

const FULL_MONTHS = [
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

export type MonthYearPeriod = {
  year: number;
  months: { month: number; label: string }[];
};

export type MonthYearPickerProps = {
  year: number | null;
  /** 0-indexed month (January = 0). */
  month: number | null;
  periods: MonthYearPeriod[];
  onChange: (year: number | null, month: number | null) => void;
  disabled?: boolean;
  id?: string;
  className?: string;
  label?: string;
  /** Hide the label above the trigger (use when aligning inline with other controls). */
  hideLabel?: boolean;
  /** When true, allows clearing to all years / all months in a year. */
  allowAll?: boolean;
  /** When true, allows selecting all months within a year (year stays required). */
  allowAllMonths?: boolean;
};

type PanelPosition = {
  top: number;
  left: number;
  width: number;
};

export function MonthYearPicker({
  year,
  month,
  periods,
  onChange,
  disabled = false,
  id,
  className,
  label = "Time",
  hideLabel = false,
  allowAll = false,
  allowAllMonths = false,
}: MonthYearPickerProps) {
  const autoId = useId();
  const triggerId = id ?? autoId;
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const [panelPos, setPanelPos] = useState<PanelPosition | null>(null);
  const [viewYear, setViewYear] = useState(
    () => year ?? periods[0]?.year ?? new Date().getFullYear(),
  );

  const years = useMemo(() => periods.map((p) => p.year), [periods]);
  const minYear = years.length ? Math.min(...years) : new Date().getFullYear();
  const maxYear = years.length ? Math.max(...years) : new Date().getFullYear();

  const allowedMonths = useMemo(() => {
    const set = new Set(periods.find((p) => p.year === viewYear)?.months.map((m) => m.month) ?? []);
    return set;
  }, [periods, viewYear]);

  const displayLabel = useMemo(() => {
    if (year == null) return allowAll ? "All periods" : "Select period";
    if (month == null || month < 0 || month > 11) {
      return allowAll || allowAllMonths ? `${year} · All months` : "Select period";
    }
    return `${FULL_MONTHS[month]} ${year}`;
  }, [allowAll, allowAllMonths, month, year]);

  useLayoutEffect(() => {
    if (!open) return;

    const updatePosition = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const panelWidth = Math.max(rect.width, 280);
      const left = Math.min(rect.left, window.innerWidth - panelWidth - 8);
      setPanelPos({
        top: rect.bottom + 4,
        left: Math.max(8, left),
        width: panelWidth,
      });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const canGoPrev = viewYear > minYear;
  const canGoNext = viewYear < maxYear;

  const toggleOpen = () => {
    if (!open && year != null) setViewYear(year);
    setOpen(!open);
  };

  const panel =
    mounted && open && panelPos
      ? createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label="Choose Month and Year"
            style={{
              position: "fixed",
              top: panelPos.top,
              left: panelPos.left,
              width: panelPos.width,
              zIndex: 100,
            }}
            className="border-ex-border bg-ex-elevated rounded-xl border p-3 shadow-lg"
          >
            <div className="mb-3 flex items-center justify-between gap-2">
              <button
                type="button"
                aria-label="Previous Year"
                disabled={!canGoPrev}
                onClick={() => setViewYear((y) => Math.max(minYear, y - 1))}
                className="text-ex-primary hover:bg-ex-surface inline-flex size-8 items-center justify-center rounded-lg disabled:pointer-events-none disabled:opacity-40"
              >
                <ChevronLeft className="size-4" />
              </button>
              <p className="text-ex-primary text-sm font-semibold tabular-nums">{viewYear}</p>
              <button
                type="button"
                aria-label="Next Year"
                disabled={!canGoNext}
                onClick={() => setViewYear((y) => Math.min(maxYear, y + 1))}
                className="text-ex-primary hover:bg-ex-surface inline-flex size-8 items-center justify-center rounded-lg disabled:pointer-events-none disabled:opacity-40"
              >
                <ChevronRight className="size-4" />
              </button>
            </div>

            <div className="grid grid-cols-3 gap-1.5">
              {SHORT_MONTHS.map((shortLabel, monthIndex) => {
                const isAllowed = allowedMonths.has(monthIndex);
                const isSelected = year === viewYear && month === monthIndex;
                return (
                  <button
                    key={shortLabel}
                    type="button"
                    disabled={!isAllowed}
                    aria-pressed={isSelected}
                    onClick={() => {
                      onChange(viewYear, monthIndex);
                      setOpen(false);
                    }}
                    className={cn(
                      "h-9 rounded-lg text-sm font-medium transition-colors",
                      isSelected
                        ? "bg-ex-secondary text-white"
                        : isAllowed
                          ? "text-ex-primary hover:bg-ex-surface"
                          : "text-ex-muted cursor-not-allowed opacity-35",
                    )}
                  >
                    {shortLabel}
                  </button>
                );
              })}
            </div>

            {allowAll || allowAllMonths ? (
              <div className="border-ex-border/60 mt-3 flex flex-col gap-1 border-t pt-3">
                {allowAll ? (
                  <button
                    type="button"
                    onClick={() => {
                      onChange(null, null);
                      setOpen(false);
                    }}
                    className={cn(
                      "text-ex-primary hover:bg-ex-surface h-9 rounded-lg px-2 text-left text-sm font-medium",
                      year == null &&
                        month == null &&
                        "bg-ex-secondary hover:bg-ex-secondary text-white",
                    )}
                  >
                    All Periods
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    onChange(viewYear, null);
                    setOpen(false);
                  }}
                  className={cn(
                    "text-ex-primary hover:bg-ex-surface h-9 rounded-lg px-2 text-left text-sm font-medium",
                    year === viewYear &&
                      month == null &&
                      "bg-ex-secondary hover:bg-ex-secondary text-white",
                  )}
                >
                  All Months in {viewYear}
                </button>
              </div>
            ) : null}
          </div>,
          document.body,
        )
      : null;

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      {hideLabel ? null : (
        <label htmlFor={triggerId} className="text-ex-muted mb-1 block text-xs font-medium">
          {label}
        </label>
      )}
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        disabled={disabled || periods.length === 0}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={hideLabel ? label : undefined}
        onClick={toggleOpen}
        className={cn(
          "border-ex-border bg-ex-bg text-ex-primary focus-visible:ring-ex-ring dark:bg-ex-surface inline-flex h-10 w-full items-center justify-between gap-2 rounded-lg border px-3 text-left text-sm shadow-inner focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
        )}
      >
        <span className="truncate">{displayLabel}</span>
        <CalendarIcon className="text-ex-muted size-4 shrink-0" aria-hidden />
      </button>
      {panel}
    </div>
  );
}
