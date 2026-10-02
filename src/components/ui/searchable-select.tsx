"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDownIcon, Search } from "lucide-react";

import { cn } from "@/lib/utils";

export type SearchableSelectOption = {
  value: string;
  label: string;
};

export type SearchableSelectProps = {
  id?: string;
  options: SearchableSelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
  className?: string;
};

export function SearchableSelect({
  id,
  options,
  value,
  onChange,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  emptyMessage = "No matches found",
  disabled = false,
  className,
}: SearchableSelectProps) {
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const selectedLabel = options.find((option) => option.value === value)?.label ?? "";

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((option) => option.label.toLowerCase().includes(q));
  }, [options, query]);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => searchRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        id={id}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        onClick={() => {
          if (disabled) return;
          setOpen((prev) => {
            const next = !prev;
            if (!next) setQuery("");
            return next;
          });
        }}
        className={cn(
          "border-ex-border bg-ex-bg text-ex-primary focus-visible:ring-ex-ring dark:bg-ex-surface flex h-10 w-full items-center justify-between gap-2 rounded-lg border px-3 text-left text-sm shadow-inner focus-visible:ring-2 focus-visible:outline-none",
          disabled && "cursor-not-allowed opacity-60",
        )}
      >
        <span className={cn("truncate", !selectedLabel && "text-ex-muted")}>
          {selectedLabel || placeholder}
        </span>
        <ChevronDownIcon
          className={cn("text-ex-muted size-4 shrink-0 transition-transform", open && "rotate-180")}
          aria-hidden
        />
      </button>

      {open && !disabled ? (
        <div className="border-ex-border bg-ex-bg dark:bg-ex-surface absolute z-20 mt-1 w-full overflow-hidden rounded-lg border shadow-lg">
          <div className="border-ex-border relative border-b p-2">
            <Search
              className="text-ex-muted pointer-events-none absolute top-1/2 left-4 size-3.5 -translate-y-1/2"
              aria-hidden
            />
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              className="border-ex-border bg-ex-surface text-ex-primary placeholder:text-ex-muted focus-visible:ring-ex-ring h-8 w-full rounded-md border pr-2 pl-8 text-sm focus-visible:ring-2 focus-visible:outline-none"
              aria-label={searchPlaceholder}
            />
          </div>
          <ul id={listboxId} role="listbox" className="max-h-56 overflow-y-auto p-1">
            {filtered.length > 0 ? (
              filtered.map((option) => {
                const selected = option.value === value;
                return (
                  <li key={option.value} role="option" aria-selected={selected}>
                    <button
                      type="button"
                      onClick={() => {
                        onChange(option.value);
                        setOpen(false);
                        setQuery("");
                      }}
                      className={cn(
                        "hover:bg-ex-surface dark:hover:bg-ex-bg w-full rounded-md px-3 py-2 text-left text-sm",
                        selected && "bg-ex-surface text-ex-primary font-medium dark:bg-ex-bg",
                      )}
                    >
                      <span className="truncate">{option.label}</span>
                    </button>
                  </li>
                );
              })
            ) : (
              <li className="text-ex-muted px-3 py-2 text-sm">{emptyMessage}</li>
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
