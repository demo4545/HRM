import type { UserRole } from "@/types/auth";
import { ROLES } from "@/app/consts/common";
import {
  isLeaveDeskRoute,
  isPunchRoute,
  roleCanApplyLeave,
  roleCanPunchInOut,
} from "@/lib/attendance/absence-gate";

const { SUPER_ADMIN, HR_MANAGER, EMPLOYEE, INTERN } = ROLES;

/** Employee-like roles (standard staff + interns). */
const STAFF = [EMPLOYEE, INTERN] as const;
const EVERYONE = [SUPER_ADMIN, HR_MANAGER, ...STAFF] as const;
const MANAGERS = [SUPER_ADMIN, HR_MANAGER] as const;
const HR_AND_STAFF = [HR_MANAGER, ...STAFF] as const;

export type NavChild = {
  label: string;
  href: string;
  roles: UserRole[];
};

export type NavItem = {
  label: string;
  href: string;
  icon: string;
  roles: UserRole[];
  children?: NavChild[];
};

/** Section index links (e.g. /employee) must not match deeper sibling routes (e.g. /employee/punch). */
export function isNavLinkActive(
  pathname: string,
  href: string,
  options?: { exactOnly?: boolean },
): boolean {
  if (pathname === href) return true;
  if (options?.exactOnly) return false;
  return pathname.startsWith(`${href}/`);
}

/** Any route under the Employee module (directory, profile by row, edit, new, etc.). */
export function isEmployeeSectionPath(pathname: string): boolean {
  return pathname === "/employee" || pathname.startsWith("/employee/");
}

/**
 * Employee directory routes: list, add, and per-employee pages (`/employee/6/profile`).
 * Excludes static module pages that have their own nav item (punch, attendance, …).
 */
export function isEmployeeDirectoryPath(pathname: string): boolean {
  if (pathname === "/employee") return true;
  if (!pathname.startsWith("/employee/")) return false;

  const firstSegment = pathname.slice("/employee/".length).split("/")[0] ?? "";
  if (firstSegment === "new") return true;
  if (/^\d+$/.test(firstSegment)) return true;

  return false;
}

/** Resolve sidebar active state for a nav child link. */
export function isNavChildActive(pathname: string, childHref: string, parentHref: string): boolean {
  if (parentHref === "/employee") {
    if (childHref === "/employee") {
      return isEmployeeDirectoryPath(pathname);
    }
    if (childHref === "/employee/profile") {
      return pathname === "/employee/profile";
    }
  }

  return isNavLinkActive(pathname, childHref, {
    exactOnly: childHref === parentHref,
  });
}

/** Resolve sidebar active state for a top-level nav group. */
export function isNavGroupActive(pathname: string, item: NavItem): boolean {
  if (item.href === "/employee") {
    return isEmployeeSectionPath(pathname);
  }

  if (pathname === item.href) return true;

  return item.children?.some((child) => isNavChildActive(pathname, child.href, item.href)) ?? false;
}

export const navStructure: NavItem[] = [
  {
    label: "Dashboard",
    href: "/dashboard",
    icon: "LayoutDashboard",
    roles: [...EVERYONE],
  },
  {
    label: "Employee",
    href: "/employee",
    icon: "Users",
    roles: [...EVERYONE],
    children: [
      {
        label: "Punch In / Out",
        href: "/employee/punch",
        roles: [...HR_AND_STAFF],
      },
      {
        label: "All Employees",
        href: "/employee",
        roles: [...MANAGERS],
      },
      {
        label: "Payroll",
        href: "/employee/payroll",
        roles: [...MANAGERS],
      },
      {
        label: "Salary Advances",
        href: "/employee/salary-advances",
        roles: [...MANAGERS],
      },
      {
        label: "Overtime & Approvals",
        href: "/employee/overtime",
        roles: [...MANAGERS],
      },
      {
        label: "Attendance History",
        href: "/employee/attendance",
        roles: [...EVERYONE],
      },
      {
        label: "Expenses",
        href: "/employee/expenses",
        roles: [...MANAGERS],
      },
      {
        label: "Salary Slips",
        href: "/employee/salary-slips",
        roles: [...EVERYONE],
      },
      {
        label: "Performance",
        href: "/employee/performance",
        roles: [...MANAGERS],
      },
      {
        label: "Boarding",
        href: "/employee/onboarding",
        roles: [...MANAGERS],
      },
      {
        label: "System Specifications",
        href: "/employee/system-specs",
        roles: [...EVERYONE],
      },
      { label: "Complaints", href: "/employee/complaints", roles: [] },

      { label: "Leave & festivals", href: "/employee/leave-festival", roles: [] },
      { label: "Leave privacy", href: "/employee/privacy", roles: [] },
    ],
  },
  {
    label: "Documents",
    href: "/documents",
    icon: "FileText",
    roles: [...MANAGERS],
    children: [
      {
        label: "Employees",
        href: "/documents/employee",
        roles: [...MANAGERS],
      },
      {
        label: "Interns",
        href: "/documents/internship",
        roles: [...MANAGERS],
      },
    ],
  },
  {
    label: "Leave",
    href: "/leave",
    icon: "CalendarDays",
    roles: [...EVERYONE],
    children: [
      { roles: [...HR_AND_STAFF], label: "Leave Desk", href: "/leave" },
      {
        roles: [...EVERYONE],
        label: "Company Holidays",
        href: "/leave/holidays",
      },
      { roles: [...MANAGERS], label: "Approvals & Chain", href: "/leave/approvals" },
      { roles: [], label: "Early leave", href: "/leave/early-leave" },
      { roles: [], label: "Working vs on leave", href: "/leave/dashboard" },
    ],
  },
  {
    label: "Social",
    href: "/notifications/announcements",
    icon: "Megaphone",
    roles: [...EVERYONE],
  },
  // {
  //   label: "Notifications",
  //   href: "/notifications",
  //   icon: "Bell",
  //   roles: [SUPER_ADMIN, HR_MANAGER],
  //   children: [
  //     {
  //       roles: [SUPER_ADMIN, HR_MANAGER, EMPLOYEE],
  //       label: "Notifications",
  //       href: "/notifications",
  //     },
  //     {
  //       roles: [SUPER_ADMIN, HR_MANAGER],
  //       label: "Notice / Announcement",
  //       href: "/notifications/announcements",
  //     },
  //     { roles: [], label: "Automation rules", href: "/notifications/rules" },
  //   ],
  // },
  {
    label: "Integrations",
    href: "/integrations",
    icon: "Plug",
    roles: [...MANAGERS],
    children: [
      { roles: [], label: "Overview", href: "/integrations" },
      {
        roles: [...MANAGERS],
        label: "Google Drive",
        href: "/integrations/google-drive",
      },
      { roles: [], label: "Slack", href: "/integrations/slack" },
      { roles: [], label: "Media uploads", href: "/integrations/media" },
    ],
  },
  {
    label: "Access Control",
    href: "/settings/network",
    icon: "Shield",
    roles: [...MANAGERS],
    children: [
      {
        roles: [...MANAGERS],
        label: "LAN / Wi-Fi Restriction",
        href: "/settings/network",
      },
    ],
  },
  {
    label: "Help Desk",
    href: "/complaints",
    icon: "MessageSquareWarning",
    roles: [...EVERYONE],
  },
];

function filterNavChildren(
  children: NavChild[] | undefined,
  role: UserRole,
): NavChild[] | undefined {
  if (!children?.length) return undefined;
  const filtered = children.filter((child) => child.roles.includes(role));
  return filtered.length ? filtered : undefined;
}

export function filterNav(role: UserRole | null): NavItem[] {
  if (!role) return [];

  return navStructure
    .filter((item) => item.roles.includes(role))
    .map((item) => {
      const children = filterNavChildren(item.children, role);
      // If the section index route is not allowed (e.g. employees can't open
      // /employee), point the group link at the first visible child instead.
      const href =
        children?.length && !children.some((child) => child.href === item.href)
          ? children[0]!.href
          : item.href;
      return {
        ...item,
        href,
        children,
      };
    })
    .filter((item) => !item.children || item.children.length > 0);
}

export function canAccessPath(role: UserRole, pathname: string): boolean {
  if (isPunchRoute(pathname) && !roleCanPunchInOut(role)) {
    return false;
  }

  if (isLeaveDeskRoute(pathname) && !roleCanApplyLeave(role)) {
    return false;
  }

  if (role === ROLES.SUPER_ADMIN) return true;

  for (const item of navStructure) {
    if (!item.roles.includes(role)) continue;

    if (item.children?.length) {
      const children = [...item.children].sort((a, b) => b.href.length - a.href.length);
      for (const child of children) {
        if (
          isNavLinkActive(pathname, child.href, {
            exactOnly: child.href === item.href,
          })
        ) {
          return child.roles.includes(role);
        }
      }
    }

    if (pathname === item.href || pathname.startsWith(`${item.href}/`)) {
      return item.roles.includes(role);
    }
  }

  if (pathname.startsWith("/integrations") && (role === ROLES.EMPLOYEE || role === ROLES.INTERN)) {
    return false;
  }
  return true;
}
