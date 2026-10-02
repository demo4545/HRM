import { STATUS } from "@/app/consts/common";

export const initialEmployeeForm = {
  employeeId: "",
  status: STATUS.ACTIVE,
  name: "",
  address: "",
  panNumber: "",
  aadharNumber: "",
  bankAccountNumber: "",
  ifscCode: "",
  pancard: "",
  aadharCard: "",
  marksheet: "",
  parentName: "",
  parentContact: "",
  /** Stores relationship: father | mother | spouse | husband | brother | sister */
  parentDetails: "",
  experience: "",
  joiningDate: "",
  skills: "",
  role: "",
  birthdayDate: "",
  lastIncrementDate: "",
  salary: "",
  documentsFolderId: "",
  attendanceSpreadsheetId: "",
  profileImage: "",
  position: "",
  email: "",
  username: "",
  password: "",
  contactNumber: "",
  projects: "",
  lastWorkingDay: "",
  offboardReason: "",
  createdAt: "",
  updatedAt: "",
};

export type EmployeeFormState = {
  [K in keyof typeof initialEmployeeForm]: string;
};

export const PARENT_RELATIONSHIP_OPTIONS = [
  "father",
  "mother",
  "spouse",
  "husband",
  "brother",
  "sister",
] as const;

export type ParentRelationship = (typeof PARENT_RELATIONSHIP_OPTIONS)[number];

export function formatParentRelationshipLabel(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return "";
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

const POSITION_ACRONYMS = new Set(["hr", "ai", "ml", "llm", "ceo", "qa", "ui", "ux"]);

function formatKeyedLabel(value: string): string {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return "";
  return trimmed
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => {
      const lower = part.toLowerCase();
      if (POSITION_ACRONYMS.has(lower)) return lower.toUpperCase();
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

/** Display label for stored position keys such as `hr_manager` → `HR Manager`. */
export function formatEmployeePositionLabel(position: string): string {
  return formatKeyedLabel(position);
}

/** Display label for stored role keys such as `hr` → `HR`. */
export function formatEmployeeRoleLabel(role: string): string {
  return formatKeyedLabel(role);
}

/** Maps normalized sheet header → form field key */
const SHEET_KEY_TO_FORM: Record<string, keyof EmployeeFormState> = {
  employee_id: "employeeId",
  status: "status",
  name: "name",
  role: "role",
  skills: "skills",
  experience: "experience",
  address: "address",
  birthday_date: "birthdayDate",
  joining_date: "joiningDate",
  email: "email",
  username: "username",
  user_name: "username",
  login_username: "username",
  password: "password",
  login_password: "password",
  pwd: "password",
  contact_number: "contactNumber",
  profile_image: "profileImage",
  position: "position",
  project: "projects",
  projects: "projects",
  pan: "panNumber",
  pan_number: "panNumber",
  bank_account_number: "bankAccountNumber",
  bank_account_no: "bankAccountNumber",
  bank_ac_no: "bankAccountNumber",
  bank_a_c_no: "bankAccountNumber",
  bank_a_c_number: "bankAccountNumber",
  bank_acc_no: "bankAccountNumber",
  bank_acc_number: "bankAccountNumber",
  bank_account: "bankAccountNumber",
  account_number: "bankAccountNumber",
  account_no: "bankAccountNumber",
  ifsc: "ifscCode",
  ifsc_code: "ifscCode",
  ifsc_code_number: "ifscCode",
  ifsc_code_no: "ifscCode",
  ifsc_no: "ifscCode",
  aadhaar: "aadharNumber",
  aadhar_number: "aadharNumber",
  aadhaar_number: "aadharNumber",
  pancard: "pancard",
  aadhar_card: "aadharCard",
  parent_name: "parentName",
  parent_contact: "parentContact",
  parent_details: "parentDetails",
  last_increment_date: "lastIncrementDate",
  salary: "salary",
  monthly_salary: "salary",
  salary_monthly: "salary",
  annual_salary: "salary",
  ctc: "salary",
  marksheet: "marksheet",
  documents_folder_id: "documentsFolderId",
  attendance_spreadsheet_id: "attendanceSpreadsheetId",
  attendance_sheet_id: "attendanceSpreadsheetId",
  last_working_day: "lastWorkingDay",
  lastworkingday: "lastWorkingDay",
  last_working_date: "lastWorkingDay",
  offboard_reason: "offboardReason",
  offboarding_reason: "offboardReason",
  offboardreason: "offboardReason",
  off_board_reason: "offboardReason",
  reason_for_offboarding: "offboardReason",
  created_at: "createdAt",
  createdat: "createdAt",
  updated_at: "updatedAt",
  updatedat: "updatedAt",
};

/** Normalize sheet header for form lookup (camelCase, spaces/punctuation → snake_case). */
function headerToSheetFormLookupKey(header: string): string {
  return (
    header
      .trim()
      .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
      // "Salary (monthly)" → "Salary_monthly", "Bank A/C No" → "Bank_A_C_No"
      .replace(/[^a-zA-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .replace(/_+/g, "_")
      .toLowerCase()
  );
}

export function headerToFormKey(header: string): keyof EmployeeFormState | null {
  const key = headerToSheetFormLookupKey(header);
  return SHEET_KEY_TO_FORM[key] ?? null;
}

/**
 * Columns the employee form always needs. Older Employees sheets / Firebase
 * meta headers may omit these, which drops them from GET and the save payload.
 */
export const REQUIRED_EMPLOYEE_FORM_HEADERS: ReadonlyArray<{
  formKey: keyof EmployeeFormState;
  header: string;
}> = [
  { formKey: "bankAccountNumber", header: "Bank Account Number" },
  { formKey: "ifscCode", header: "IFSC Code" },
];

export function ensureRequiredEmployeeFormHeaders(headers: string[]): string[] {
  if (headers.length === 0) return headers;
  const next = [...headers];
  for (const required of REQUIRED_EMPLOYEE_FORM_HEADERS) {
    if (!next.some((header) => headerToFormKey(header) === required.formKey)) {
      next.push(required.header);
    }
  }
  return next;
}

export function employeeHeadersEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((header, index) => header === b[index]);
}

/**
 * Build a sheet row using the live header row order from Google Sheets.
 * Missing bank/IFSC columns are appended so they are included in the save payload.
 */
export function formToSheetRow(form: EmployeeFormState, headers: string[]): string[] {
  return ensureRequiredEmployeeFormHeaders(headers).map((header) => {
    if (!header.trim()) return "";
    const formKey = headerToFormKey(header);
    return formKey ? String(form[formKey] ?? "") : "";
  });
}

/** Convert a sheet data row into form state (header order from sheet) */
export function sheetRowToForm(headers: string[], row: string[]): EmployeeFormState {
  const form: EmployeeFormState = {
    employeeId: "",
    documentsFolderId: "",
    attendanceSpreadsheetId: "",
    name: "",
    address: "",
    panNumber: "",
    aadharNumber: "",
    bankAccountNumber: "",
    ifscCode: "",
    pancard: "",
    aadharCard: "",
    marksheet: "",
    parentName: "",
    parentContact: "",
    parentDetails: "",
    experience: "",
    joiningDate: "",
    position: "",
    projects: "",
    skills: "",
    role: "",
    birthdayDate: "",
    lastIncrementDate: "",
    salary: "",
    profileImage: "",
    email: "",
    username: "",
    password: "",
    contactNumber: "",
    lastWorkingDay: "",
    offboardReason: "",
    createdAt: "",
    updatedAt: "",
    status: STATUS.ACTIVE,
  };

  headers.forEach((header, index) => {
    const formKey = headerToFormKey(header);
    if (!formKey) return;

    const raw = row[index] ?? "";
    if (formKey === "status") {
      form.status = normalizeStatus(raw);
      return;
    }

    form[formKey] = raw;
  });

  applyOffboardFieldFallbacks(headers, row, form);

  return form;
}

/** Read offboard columns when the sheet header uses a variant we do not map directly. */
function applyOffboardFieldFallbacks(
  headers: string[],
  row: string[],
  form: EmployeeFormState,
): void {
  if (!form.lastWorkingDay.trim()) {
    const lastDayIndex = findHeaderIndex(
      headers,
      (key) => key.includes("last") && key.includes("working"),
    );
    if (lastDayIndex >= 0) {
      form.lastWorkingDay = String(row[lastDayIndex] ?? "").trim();
    }
  }

  if (!form.offboardReason.trim()) {
    const reasonIndex = findHeaderIndex(
      headers,
      (key) =>
        (key.includes("offboard") && key.includes("reason")) ||
        (key.includes("offboarding") && key.includes("reason")),
    );
    if (reasonIndex >= 0) {
      form.offboardReason = String(row[reasonIndex] ?? "").trim();
    }
  }
}

function findHeaderIndex(headers: string[], matches: (normalizedKey: string) => boolean): number {
  return headers.findIndex((header) => matches(headerToSheetFormLookupKey(header)));
}

/** Map sheet status cell → form value (Active / Inactive) */
export function normalizeStatus(value: string): string {
  return isEmployeeStatusActive(value) ? STATUS.ACTIVE : STATUS.INACTIVE;
}

/** Only explicit Active allows sign-in and app access. */
export function isEmployeeStatusActive(value: string): boolean {
  const v = value.trim().toLowerCase();
  return v === STATUS.ACTIVE.toLowerCase() || v === "active";
}
