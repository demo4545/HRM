"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  SESSION_IDLE_MAX_AGE_ADMIN_MS,
  canExtendSession,
  formatSessionDuration,
  hasAdminIdleTimeout,
  sessionExpiresAt,
  sessionIdleWarningMs,
  sessionMaxAgeMsForRole,
  sessionWarningMsForRole,
} from "@/lib/session";
import type { SessionUser } from "@/types/auth";

const SOFT_ACTIVITY_EVENTS = ["mousemove", "scroll", "wheel"] as const;
const HARD_ACTIVITY_EVENTS = ["mousedown", "keydown", "touchstart", "pointerdown"] as const;

type SessionTimeoutGuardProps = {
  user: SessionUser | null;
  enabled: boolean;
  onLogout: () => Promise<void>;
  /** HR / Super Admin only — returns the renewed session user. */
  onContinue?: () => Promise<SessionUser | null>;
};

export function SessionTimeoutGuard({
  user,
  enabled,
  onLogout,
  onContinue,
}: SessionTimeoutGuardProps) {
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [warningReason, setWarningReason] = useState<"absolute" | "idle" | null>(null);
  const [continuing, setContinuing] = useState(false);
  const loggingOutRef = useRef(false);
  const warningVisibleRef = useRef(false);
  const warningReasonRef = useRef<"absolute" | "idle" | null>(null);
  const lastActivityRef = useRef(0);
  const onLogoutRef = useRef(onLogout);

  useEffect(() => {
    onLogoutRef.current = onLogout;
  }, [onLogout]);

  useEffect(() => {
    if (!enabled || !user) {
      return;
    }

    const expiresAt = sessionExpiresAt(user);
    if (expiresAt == null) {
      loggingOutRef.current = true;
      void onLogoutRef.current();
      return;
    }

    loggingOutRef.current = false;
    lastActivityRef.current = Date.now();
    warningVisibleRef.current = false;
    warningReasonRef.current = null;
    const trackIdle = hasAdminIdleTimeout(user.role);
    const absoluteWarningMs = sessionWarningMsForRole(user.role);
    const idleWarningMs = sessionIdleWarningMs();

    const markActivity = (opts?: { force?: boolean }) => {
      if (loggingOutRef.current) return;
      if (!trackIdle) return;
      if (warningVisibleRef.current && !opts?.force) return;
      lastActivityRef.current = Date.now();
      // Hard activity during an idle warning counts as presence — dismiss banner.
      if (warningVisibleRef.current && warningReasonRef.current === "idle") {
        warningVisibleRef.current = false;
        warningReasonRef.current = null;
        setSecondsLeft(null);
        setWarningReason(null);
      }
    };

    const onSoftActivity = () => markActivity();
    const onHardActivity = () => markActivity({ force: true });

    if (trackIdle) {
      for (const event of SOFT_ACTIVITY_EVENTS) {
        window.addEventListener(event, onSoftActivity, { passive: true });
      }
      for (const event of HARD_ACTIVITY_EVENTS) {
        window.addEventListener(event, onHardActivity, { passive: true });
      }
    }

    const tick = () => {
      if (loggingOutRef.current) return;

      const now = Date.now();
      const absoluteRemainingMs = expiresAt - now;
      const idleRemainingMs = trackIdle
        ? lastActivityRef.current + SESSION_IDLE_MAX_AGE_ADMIN_MS - now
        : Number.POSITIVE_INFINITY;
      const remainingMs = Math.min(absoluteRemainingMs, idleRemainingMs);

      if (remainingMs <= 0) {
        loggingOutRef.current = true;
        void onLogoutRef.current();
        return;
      }

      const idleIsSooner = idleRemainingMs <= absoluteRemainingMs;
      const warningMs = idleIsSooner ? idleWarningMs : absoluteWarningMs;

      if (remainingMs <= warningMs) {
        const reason = idleIsSooner ? "idle" : "absolute";
        warningVisibleRef.current = true;
        warningReasonRef.current = reason;
        setWarningReason(reason);
        setSecondsLeft(Math.max(1, Math.ceil(remainingMs / 1000)));
      } else {
        warningVisibleRef.current = false;
        warningReasonRef.current = null;
        setSecondsLeft(null);
        setWarningReason(null);
      }
    };

    const initial = window.setTimeout(tick, 0);
    const id = window.setInterval(tick, 1000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(id);
      if (trackIdle) {
        for (const event of SOFT_ACTIVITY_EVENTS) {
          window.removeEventListener(event, onSoftActivity);
        }
        for (const event of HARD_ACTIVITY_EVENTS) {
          window.removeEventListener(event, onHardActivity);
        }
      }
    };
  }, [enabled, user]);

  if (!enabled || !user || secondsLeft == null) return null;

  const minutes = Math.floor(secondsLeft / 60);
  const seconds = secondsLeft % 60;
  const countdown =
    minutes > 0 ? `${minutes}:${seconds.toString().padStart(2, "0")}` : `${seconds}s`;
  const sessionLabel = formatSessionDuration(sessionMaxAgeMsForRole(user.role));
  const showContinue = canExtendSession(user.role) && Boolean(onContinue);
  const isIdleWarning = warningReason === "idle";

  async function handleContinue() {
    if (!onContinue || continuing) return;
    setContinuing(true);
    try {
      lastActivityRef.current = Date.now();
      await onContinue();
      warningVisibleRef.current = false;
      warningReasonRef.current = null;
      setSecondsLeft(null);
      setWarningReason(null);
    } finally {
      setContinuing(false);
    }
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="border-ex-border bg-ex-elevated fixed right-4 bottom-4 z-100 max-w-sm rounded-xl border p-4 shadow-xl"
    >
      <p className="text-ex-text text-sm font-medium">Session Ending Soon</p>
      <p className="text-ex-muted mt-1 text-sm">
        You will be signed out in <span className="text-ex-text font-medium">{countdown}</span>
        {isIdleWarning
          ? " Due to Inactivity."
          : `. Sessions last ${sessionLabel} from login${showContinue ? " (or last Continue)" : ""}.`}{" "}
        Any work already saved stays in the system.
      </p>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        {showContinue ? (
          <Button
            type="button"
            size="sm"
            disabled={continuing}
            onClick={() => void handleContinue()}
          >
            {continuing ? "Continuing…" : "Continue"}
          </Button>
        ) : null}
        <Button type="button" variant="outline" size="sm" onClick={() => void onLogout()}>
          Sign Out Now
        </Button>
      </div>
    </div>
  );
}
