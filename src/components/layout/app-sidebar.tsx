"use client";

import {
  CalendarDays,
  ChevronDown,
  FileText,
  LayoutDashboard,
  Megaphone,
  Menu,
  MessageSquareWarning,
  Plug,
  Shield,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { BrandLogo } from "@/components/brand/brand-logo";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { filterNav, isNavChildActive, isNavGroupActive, type NavItem } from "@/lib/rbac";
import { useAuth } from "@/contexts/auth-provider";
import { useCompanyBranding } from "@/lib/branding/use-company-branding";
import { useNotificationsOptional } from "@/contexts/notifications-provider";
import { UnreadBadge } from "@/components/notifications/unread-badge";

const iconMap = {
  LayoutDashboard,
  Users,
  CalendarDays,
  Megaphone,
  MessageSquareWarning,
  Plug,
  Shield,
  FileText,
} as const;

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { user } = useAuth();
  const notifications = useNotificationsOptional();
  const items = useMemo(() => filterNav(user?.role ?? null), [user?.role]);
  const unreadCount = notifications?.unreadCount ?? 0;

  return (
    <nav className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-3 py-4">
      {items.map((item) => (
        <NavGroup
          key={item.href}
          item={item}
          pathname={pathname}
          onNavigate={onNavigate}
          unreadCount={item.href === "/notifications" ? unreadCount : 0}
        />
      ))}
    </nav>
  );
}

function NavGroup({
  item,
  pathname,
  onNavigate,
  unreadCount = 0,
}: {
  item: NavItem;
  pathname: string;
  onNavigate?: () => void;
  unreadCount?: number;
}) {
  const [open, setOpen] = useState(true);
  const Icon = iconMap[item.icon as keyof typeof iconMap] ?? LayoutDashboard;
  const active = isNavGroupActive(pathname, item);

  if (!item.children?.length) {
    return (
      <Link
        href={item.href}
        onClick={onNavigate}
        className={cn(
          "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition",
          pathname === item.href
            ? "bg-ex-secondary text-white shadow-sm"
            : "text-ex-muted hover:bg-ex-surface hover:text-ex-primary",
        )}
      >
        <Icon className="size-4 shrink-0 opacity-90" />
        <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
          <span>{item.label}</span>
          {unreadCount > 0 ? <UnreadBadge count={unreadCount} /> : null}
        </span>
      </Link>
    );
  }

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium transition",
          active
            ? "bg-ex-surface text-ex-primary"
            : "text-ex-muted hover:bg-ex-surface hover:text-ex-primary",
        )}
      >
        <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
          <span className="flex items-center gap-3">
            <Icon className="size-4 shrink-0" />
            {item.label}
          </span>
          {unreadCount > 0 ? <UnreadBadge count={unreadCount} /> : null}
        </span>
        <ChevronDown className={cn("size-4 transition", open ? "rotate-180" : "")} />
      </button>
      {open ? (
        <div className="border-ex-border ml-4 flex flex-col gap-0.5 border-l pl-3">
          {item.children.map((child) => {
            const childActive = isNavChildActive(pathname, child.href, item.href);
            const childUnread = item.href === "/notifications" && child.href === "/notifications";
            return (
              <Link
                key={child.href}
                href={child.href}
                onClick={onNavigate}
                className={cn(
                  "flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm transition",
                  childActive
                    ? "bg-ex-secondary/12 text-ex-secondary font-medium"
                    : "text-ex-muted hover:bg-ex-surface hover:text-ex-primary",
                )}
              >
                <span>{child.label}</span>
                {childUnread && unreadCount > 0 ? <UnreadBadge count={unreadCount} /> : null}
              </Link>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function AppSidebar() {
  return (
    <aside className="border-ex-border bg-ex-elevated fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r lg:flex">
      <SidebarBrand />
      <NavLinks />
    </aside>
  );
}

export function MobileDrawer() {
  const [open, setOpen] = useState(false);

  // Clear a stuck body scroll lock left behind after mobile → desktop transitions.
  useEffect(() => {
    if (window.matchMedia("(min-width: 1024px)").matches) {
      document.body.style.removeProperty("overflow");
    }
  }, []);

  useEffect(() => {
    if (!open) return;

    const media = window.matchMedia("(min-width: 1024px)");
    const previousOverflow = document.body.style.overflow;

    const syncLock = () => {
      // Desktop layout hides this drawer; never keep body scroll locked there.
      if (media.matches) {
        document.body.style.overflow = previousOverflow || "";
        setOpen(false);
        return;
      }
      document.body.style.overflow = "hidden";
    };

    syncLock();
    media.addEventListener("change", syncLock);
    return () => {
      media.removeEventListener("change", syncLock);
      document.body.style.removeProperty("overflow");
    };
  }, [open]);

  const close = () => setOpen(false);

  return (
    <>
      <ButtonIcon onClick={() => setOpen(true)} label="Open menu">
        <Menu className="size-5" />
      </ButtonIcon>
      {open
        ? createPortal(
            <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true">
              <button
                type="button"
                className="absolute inset-0 bg-black/40 backdrop-blur-sm"
                aria-label="Close menu backdrop"
                onClick={close}
              />
              <div className="border-ex-border bg-ex-elevated absolute inset-0 flex w-full flex-col">
                <div className="border-ex-border flex items-center justify-between border-b px-3 py-3">
                  <SidebarBrand compact onNavigate={close} />
                  <ButtonIcon onClick={close} label="Close menu">
                    <X className="size-5" />
                  </ButtonIcon>
                </div>
                <NavLinks onNavigate={close} />
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function SidebarBrand({ compact, onNavigate }: { compact?: boolean; onNavigate?: () => void }) {
  const { branding } = useCompanyBranding();
  const companyName = branding.companyName.trim() || "HRM";

  return (
    <Link
      href="/dashboard"
      onClick={onNavigate}
      className={cn(
        "border-ex-border flex items-center gap-3 border-b px-4 py-3",
        compact && "border-0 py-2",
      )}
    >
      <BrandLogo size="sm" />
      <div className="min-w-0">
        <p className="text-ex-primary truncate text-sm font-semibold">{companyName}</p>
        <p className="text-ex-muted truncate text-xs">HRM Admin</p>
      </div>
    </Link>
  );
}

function ButtonIcon({
  children,
  onClick,
  label,
}: {
  children: React.ReactNode;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="border-ex-border bg-ex-elevated text-ex-primary hover:bg-ex-surface inline-flex h-10 w-10 items-center justify-center rounded-lg border shadow-sm"
    >
      {children}
    </button>
  );
}
