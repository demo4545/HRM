"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/auth-provider";
import { AppHeader } from "@/components/layout/app-header";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { TodayAttendanceProvider } from "@/contexts/today-attendance-provider";
import { NotificationsProvider } from "@/contexts/notifications-provider";
import {
  PUNCH_GATE_ROUTE,
  roleRequiresAbsenceExplanationGate,
} from "@/lib/attendance/absence-gate";
import { parseJsonResponse } from "@/lib/api/json-response";
import {
  readAbsenceGateSessionHint,
  setAbsenceGateSessionHint,
} from "@/lib/attendance/absence-gate-session";

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const gateRole = user ? roleRequiresAbsenceExplanationGate(user.role) : false;
  const onPunchPage = pathname === PUNCH_GATE_ROUTE || pathname.startsWith(`${PUNCH_GATE_ROUTE}/`);
  const gateApplies = gateRole && !onPunchPage;
  // Prefer the login-set hint. Unknown (null) must not block the shell — middleware
  // already enforces punch-gate cookies; we only redirect when we know gate is on.
  const [gateActive, setGateActive] = useState<boolean>(() => {
    if (!gateApplies) return false;
    return readAbsenceGateSessionHint() === true;
  });

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login");
    }
  }, [loading, user, router]);

  // Ensure dashboard pages can always scroll (mobile drawer may leave body locked).
  useEffect(() => {
    document.body.style.removeProperty("overflow");
  }, [pathname]);

  useEffect(() => {
    if (!gateApplies || loading || !user) return;

    let cancelled = false;

    void (async () => {
      try {
        const res = await fetch("/api/auth/absence-gate", {
          credentials: "include",
          cache: "no-store",
        });
        const parsed = await parseJsonResponse<{ active?: boolean }>(res);
        if (cancelled || parsed.invalid || parsed.empty) return;
        const active = Boolean(parsed.data?.active);
        setAbsenceGateSessionHint(active);
        setGateActive(active);
        if (active) {
          router.replace(PUNCH_GATE_ROUTE);
        }
      } catch {
        const hint = readAbsenceGateSessionHint();
        if (!cancelled && hint === true) {
          setGateActive(true);
          router.replace(PUNCH_GATE_ROUTE);
        } else if (!cancelled) {
          setGateActive(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [gateApplies, loading, user, router]);

  if (loading || !user) {
    return (
      <div className="bg-ex-bg flex min-h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="border-ex-border border-t-ex-secondary size-10 animate-spin rounded-full border-2" />
          <p className="text-ex-muted text-sm">Loading workspace…</p>
        </div>
      </div>
    );
  }

  if (gateApplies && gateActive) {
    return (
      <div className="bg-ex-bg flex min-h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="border-ex-border border-t-ex-secondary size-10 animate-spin rounded-full border-2" />
          <p className="text-ex-muted text-sm">Redirecting to punch desk…</p>
        </div>
      </div>
    );
  }

  return (
    <TodayAttendanceProvider>
      <NotificationsProvider>
        <div className="bg-ex-bg min-h-screen">
          <AppSidebar />
          <div className="flex min-w-0 flex-col lg:pl-64">
            <AppHeader />
            <main className="min-w-0 flex-1 space-y-8 p-4 pb-10 lg:p-8">{children}</main>
          </div>
        </div>
      </NotificationsProvider>
    </TodayAttendanceProvider>
  );
}
