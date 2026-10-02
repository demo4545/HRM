"use client";

import Link from "next/link";
import { LogIn } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { useTodayAttendance } from "@/hooks/use-today-attendance";
import { cn } from "@/lib/utils";

export function PunchInBanner({ className }: { className?: string }) {
  return (
    <div
      role="status"
      className={cn(
        "border-ex-banner-warning-border bg-ex-banner-warning-bg flex items-start gap-3 rounded-xl border px-4 py-3",
        className,
      )}
    >
      <div className="bg-ex-banner-warning-icon-bg text-ex-banner-warning-icon-fg flex size-9 shrink-0 items-center justify-center rounded-full">
        <LogIn className="size-4" aria-hidden />
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-ex-banner-warning-fg text-sm font-semibold">Punch In Not Done</p>
        <p className="text-ex-banner-warning-muted text-sm leading-relaxed">
          You haven&apos;t punched in for today yet. Start your day to begin tracking work hours.
        </p>
        <Link
          href="/employee/punch"
          className="text-ex-banner-warning-link inline-flex text-sm font-medium underline-offset-2 hover:underline"
        >
          Go to Punch Desk
        </Link>
      </div>
    </div>
  );
}

export function PunchInStatusFlag({
  variant = "chip",
  className,
}: {
  variant?: "chip" | "banner";
  className?: string;
}) {
  const { today, loading } = useTodayAttendance();

  if (loading || today?.hasPunchedIn) return null;

  if (variant === "banner") {
    return <PunchInBanner className={className} />;
  }

  return (
    <Link href="/employee/punch" className={cn("shrink-0", className)}>
      <Badge variant="warning" className="gap-1.5 px-2.5 py-1">
        <LogIn className="size-3.5" aria-hidden />
        Punch In Pending
      </Badge>
    </Link>
  );
}
