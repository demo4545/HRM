"use client";

import { readResponseJson } from "@/lib/api/read-response-json";
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Bell, LogOut, Palette, User } from "lucide-react";
import { useAuth } from "@/contexts/auth-provider";
import { useNotificationsOptional } from "@/contexts/notifications-provider";
import { PunchInStatusFlag } from "@/components/attendance/punch-in-status-flag";
import { UnreadBadge } from "@/components/notifications/unread-badge";
import { MobileDrawer } from "@/components/layout/app-sidebar";
import { ROLES } from "@/app/consts/common";
import { canManageCompanyBranding, roleCanPunchInOut } from "@/lib/auth/roles";
import { resolveProfileImageSrc, sheetRowToForm } from "@/lib/employee";
import { cn } from "@/lib/utils";

const roleLabel: Record<string, string> = {
  [ROLES.SUPER_ADMIN]: "Super Administrator",
  [ROLES.HR_MANAGER]: "HR Manager",
  [ROLES.EMPLOYEE]: "Employee",
};

function HeaderProfileAvatar({
  userName,
  showBranding = false,
  onLogout,
}: {
  userName?: string;
  showBranding?: boolean;
  onLogout: () => void;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [imageFailed, setImageFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const res = await fetch("/api/employee/me", { credentials: "include", cache: "no-store" });
        const data = await readResponseJson<{
          success?: boolean;
          headers?: string[];
          row?: string[];
        }>(res, "fetch");
        if (cancelled || !data.success || !data.headers || !data.row) {
          if (!cancelled) {
            setSrc(null);
            setImageFailed(false);
          }
          return;
        }

        const form = sheetRowToForm(data.headers, data.row);
        if (!cancelled) {
          setSrc(resolveProfileImageSrc(form.profileImage));
          setImageFailed(false);
        }
      } catch {
        if (!cancelled) {
          setSrc(null);
          setImageFailed(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  const menuItemClass =
    "text-ex-primary hover:bg-ex-surface flex w-full items-center gap-2 px-3 py-2 text-sm transition";
  const showPhoto = Boolean(src) && !imageFailed;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="border-ex-border bg-ex-surface hover:bg-ex-elevated relative inline-flex h-10 w-10 cursor-pointer items-center justify-center overflow-hidden rounded-full border shadow-sm transition"
        aria-label={userName ? `${userName} account menu` : "Your account menu"}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        {showPhoto ? (
          <Image
            src={src!}
            alt={userName ? `${userName} profile` : "Profile"}
            width={40}
            height={40}
            unoptimized
            className="size-full object-cover"
            onError={() => setImageFailed(true)}
          />
        ) : (
          <User className="text-ex-muted size-5" aria-hidden />
        )}
      </button>

      {open ? (
        <div
          role="menu"
          className="border-ex-border bg-ex-elevated absolute top-full right-0 z-50 mt-2 min-w-48 overflow-hidden rounded-lg border py-1 shadow-lg"
        >
          <Link
            href="/employee/profile"
            role="menuitem"
            className={menuItemClass}
            onClick={() => setOpen(false)}
          >
            <User className="size-4" />
            Profile
          </Link>
          {showBranding ? (
            <Link
              href="/settings/branding"
              role="menuitem"
              className={menuItemClass}
              onClick={() => setOpen(false)}
            >
              <Palette className="size-4" />
              Company Branding
            </Link>
          ) : null}
          <button
            type="button"
            role="menuitem"
            className={cn(menuItemClass, "text-rose-600 dark:text-rose-400")}
            onClick={() => {
              setOpen(false);
              onLogout();
            }}
          >
            <LogOut className="size-4" />
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function AppHeader() {
  const { user, logout } = useAuth();
  const notifications = useNotificationsOptional();
  const unreadCount = notifications?.unreadCount ?? 0;

  return (
    <header className="border-ex-border bg-ex-elevated/90 sticky top-0 z-40 flex h-16 items-center gap-3 border-b px-4 backdrop-blur-md lg:px-6">
      <div className="flex items-center gap-2 lg:hidden">
        <MobileDrawer />
      </div>
      <div className="ml-auto flex items-center gap-2">
        <Link
          href="/notifications"
          className="border-ex-border bg-ex-elevated text-ex-primary hover:bg-ex-surface relative inline-flex h-10 w-10 items-center justify-center rounded-lg border shadow-sm transition"
          aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ""}`}
        >
          <Bell className="size-4" />
          {unreadCount > 0 ? (
            <span className="absolute -top-1 -right-1">
              <UnreadBadge count={unreadCount} />
            </span>
          ) : null}
        </Link>
        {user && roleCanPunchInOut(user.role) ? <PunchInStatusFlag /> : null}

        <div className="hidden text-right sm:block">
          <p className="text-ex-primary text-sm leading-tight font-medium">{user?.name}</p>

          <p className="text-ex-muted text-xs capitalize">
            {user?.role ? (roleLabel[user.role] ?? user.role) : ""}
          </p>
        </div>
        <HeaderProfileAvatar
          userName={user?.name}
          showBranding={user ? canManageCompanyBranding(user.role) : false}
          onLogout={() => void logout()}
        />
      </div>
    </header>
  );
}
