export type OfficeNetwork = {
  id: string;
  label: string;
  ip: string;
  createdAt: string;
  updatedAt: string;
};

export type RemoteAccessEmployee = {
  id: string;
  employeeSheetRow: number;
  employeeId: string;
  employeeName: string;
  createdAt: string;
};

/** Company-wide WFH day: Wi‑Fi restriction off for everyone on this date. */
export type CompanyWfhDay = {
  id: string;
  /** YYYY-MM-DD (app timezone). */
  date: string;
  note: string;
  createdAt: string;
  createdByName: string;
};

export type NetworkAccessSettings = {
  restrictionEnabled: boolean;
};

export type NetworkAccessDecision = {
  allowed: boolean;
  reason:
    | "restriction_disabled"
    | "admin_bypass"
    | "remote_exempt"
    | "company_wfh_day"
    | "office_ip"
    | "blocked"
    | "unauthenticated";
  clientIp: string;
};
