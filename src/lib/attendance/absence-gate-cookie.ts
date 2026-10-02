import type { NextResponse } from "next/server";

export const ABSENCE_GATE_COOKIE = "exhibyte_absence_gate";
export const ABSENCE_GATE_SUPPRESS_COOKIE = "exhibyte_absence_gate_suppress";
export const PUNCH_TODAY_COOKIE = "exhibyte_punch_today";

/** Grace window after submit so Sheets lag cannot resurrect just-cleared dates. */
const ABSENCE_GATE_SUPPRESS_MAX_AGE_SEC = 120;

export function isAbsenceGateCookieActive(value: string | undefined): boolean {
  return value === "1";
}

export function setAbsenceGateCookie(res: NextResponse, required: boolean): void {
  res.cookies.set(ABSENCE_GATE_COOKIE, required ? "1" : "0", {
    path: "/",
    sameSite: "lax",
    httpOnly: true,
  });
}

export function clearAbsenceGateCookie(res: NextResponse): void {
  res.cookies.set(ABSENCE_GATE_COOKIE, "0", {
    path: "/",
    sameSite: "lax",
    httpOnly: true,
    maxAge: 0,
  });
}

export function setAbsenceGateSuppressCookie(res: NextResponse, dateIsos: string[]): void {
  const unique = [...new Set(dateIsos.map((value) => value.trim()).filter(Boolean))];
  if (unique.length === 0) return;
  res.cookies.set(ABSENCE_GATE_SUPPRESS_COOKIE, unique.join(","), {
    path: "/",
    sameSite: "lax",
    httpOnly: true,
    maxAge: ABSENCE_GATE_SUPPRESS_MAX_AGE_SEC,
  });
}

export function readAbsenceGateSuppressDates(value: string | undefined): Set<string> {
  if (!value?.trim()) return new Set();
  return new Set(
    value
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean),
  );
}

export function isMorningPunchGateCookieActive(value: string | undefined): boolean {
  return value === "1";
}

export function setMorningPunchGateCookie(res: NextResponse, required: boolean): void {
  res.cookies.set(PUNCH_TODAY_COOKIE, required ? "1" : "0", {
    path: "/",
    sameSite: "lax",
    httpOnly: true,
  });
}

export function clearMorningPunchGateCookie(res: NextResponse): void {
  res.cookies.set(PUNCH_TODAY_COOKIE, "0", {
    path: "/",
    sameSite: "lax",
    httpOnly: true,
    maxAge: 0,
  });
}

export function isSiteAccessGateActive(
  absenceGateCookie: string | undefined,
  morningPunchGateCookie: string | undefined,
): boolean {
  return (
    isAbsenceGateCookieActive(absenceGateCookie) ||
    isMorningPunchGateCookieActive(morningPunchGateCookie)
  );
}
