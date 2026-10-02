"use client";

import Link from "next/link";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export type NotificationToastVariant = "default" | "error" | "success";

export type NotificationToastItem = {
  id: string;
  title: string;
  body: string;
  href?: string;
  variant?: NotificationToastVariant;
};

const toastVariantClass: Record<NotificationToastVariant, string> = {
  default: "border-ex-border bg-ex-elevated",
  error: "border-ex-banner-danger-border bg-ex-banner-danger-bg",
  success: "border-ex-chip-success-border bg-ex-chip-success-bg",
};

export function NotificationToastStack({
  items,
  onDismiss,
}: {
  items: NotificationToastItem[];
  onDismiss: (id: string) => void;
}) {
  if (items.length === 0) return null;

  return (
    <div className="pointer-events-none fixed top-4 right-4 z-[100] flex w-[min(100%-2rem,24rem)] max-w-[calc(100vw-2rem)] flex-col gap-2">
      {items.map((item) => {
        const variant = item.variant ?? "default";
        return (
          <div
            key={item.id}
            className={cn(
              "pointer-events-auto rounded-xl border p-4 shadow-lg",
              toastVariantClass[variant],
            )}
            role="status"
            aria-live="polite"
          >
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    "line-clamp-2 text-sm font-semibold break-words",
                    variant === "default" && "text-ex-primary",
                    variant === "error" && "text-ex-banner-danger-fg",
                    variant === "success" && "text-ex-chip-success-fg",
                  )}
                >
                  {item.title}
                </p>
                <p
                  className={cn(
                    "mt-1 line-clamp-3 text-sm break-words",
                    variant === "default" && "text-ex-muted",
                    variant === "error" && "text-ex-banner-danger-fg",
                    variant === "success" && "text-ex-chip-success-fg",
                  )}
                >
                  {item.body}
                </p>
                {item.href ? (
                  <Link
                    href={item.href}
                    className="text-ex-accent mt-2 inline-block text-sm font-medium hover:underline"
                    onClick={() => onDismiss(item.id)}
                  >
                    View
                  </Link>
                ) : null}
              </div>
              <button
                type="button"
                aria-label="Dismiss notification"
                onClick={() => onDismiss(item.id)}
                className={cn(
                  "shrink-0 rounded-md p-1 transition",
                  variant === "default" && "text-ex-muted hover:text-ex-primary",
                  variant === "error" && "text-ex-banner-danger-fg hover:opacity-80",
                  variant === "success" && "text-ex-chip-success-fg hover:opacity-80",
                )}
              >
                <X className="size-4" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
