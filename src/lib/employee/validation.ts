import { POSITIONS, ROLES } from "@/app/consts/common";
import { passwordStrengthError } from "@/lib/auth/password-rules";
import type { EmployeeFormState } from "./form";
import { PARENT_RELATIONSHIP_OPTIONS } from "./form";

export const EMPLOYEE_MIN_AGE = 18;
export const EMPLOYEE_MAX_EXPERIENCE_YEARS = 35;

/** CEO profile does not use experience / joining / increment / salary / skills fields. */
export function isCeoPosition(position: string): boolean {
  return position.trim().toLowerCase() === POSITIONS.CEO.toLowerCase();
}

/** Super Admin / CEO do not use experience, joining, increment, salary, or skills fields. */
export function hidesEmploymentFields(input: { position?: string; role?: string }): boolean {
  const role = String(input.role ?? "")
    .trim()
    .toLowerCase();
  return isCeoPosition(String(input.position ?? "")) || role === ROLES.SUPER_ADMIN.toLowerCase();
}

/** Indian PAN: 5 letters + 4 digits + 1 letter */
export const PAN_PATTERN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

/** 12-digit Aadhaar */
export const AADHAAR_PATTERN = /^\d{12}$/;

/** Optional bank account: 5–18 digits when provided */
export const BANK_ACCOUNT_MIN_LENGTH = 5;
export const BANK_ACCOUNT_MAX_LENGTH = 18;
export const BANK_ACCOUNT_PATTERN = /^\d{5,18}$/;

/** Optional IFSC: exactly 11 alphanumeric characters when provided */
export const IFSC_CODE_LENGTH = 11;
export const IFSC_CODE_PATTERN = /^[A-Z0-9]{11}$/;

/** Indian mobile: 10 digits starting 6–9 */
export const INDIAN_MOBILE_PATTERN = /^[6-9]\d{9}$/;

export const PERSON_NAME_PATTERN = /^[A-Za-z]+(?:[ .'-][A-Za-z]+)*$/;

const PLACEHOLDER_WORDS = new Set([
  "test",
  "testing",
  "tester",
  "asdf",
  "asd",
  "qwerty",
  "qwer",
  "abc",
  "abcd",
  "xyz",
  "xxx",
  "dummy",
  "sample",
  "example",
  "name",
  "fname",
  "lname",
  "firstname",
  "lastname",
  "fullname",
  "surname",
  "user",
  "admin",
  "temp",
  "temporary",
  "foo",
  "bar",
  "baz",
  "na",
  "n/a",
  "nil",
  "none",
  "null",
  "unknown",
]);

export type EmployeeFieldErrors = Partial<Record<keyof EmployeeFormState, string>>;

/** Keep letters, spaces, and common name punctuation; collapse extra spaces. */
export function sanitizePersonNameInput(raw: string): string {
  return raw
    .replace(/[^A-Za-z .'-]/g, "")
    .replace(/\s+/g, " ")
    .replace(/^[ .'-]+/, "");
}

/** Split a stored full name into first + remaining last parts for the form UI. */
export function splitPersonName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0]!, lastName: "" };
  return { firstName: parts[0]!, lastName: parts.slice(1).join(" ") };
}

/** Combine first / last name inputs into the stored full-name field. */
export function joinPersonName(firstName: string, lastName: string): string {
  return [firstName, lastName]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ");
}

function lettersOnly(word: string): string {
  return word.replace(/[^A-Za-z]/g, "").toLowerCase();
}

/** Collapse Indic transliteration digraphs (kh, bh, th, …) to one consonant. */
function collapseIndicDigraphs(letters: string): string {
  return letters.toLowerCase().replace(/[kgcjtdpbs]h/g, "C");
}

function maxConsonantRun(letters: string): number {
  const collapsed = collapseIndicDigraphs(letters);
  let max = 0;
  let current = 0;
  for (const ch of collapsed) {
    if (/[aeiouy]/.test(ch)) {
      current = 0;
    } else if (/[a-zC]/i.test(ch)) {
      current += 1;
      if (current > max) max = current;
    }
  }
  return max;
}

function vowelRatio(letters: string): number {
  if (!letters.length) return 0;
  const vowels = (letters.match(/[aeiouy]/gi) ?? []).length;
  return vowels / letters.length;
}

/**
 * Person-name parts (allows Indian names like Mansukhbhai / Pidhadiya).
 * Digraphs like "kh"/"bh" count as one consonant so real names are not rejected.
 */
function looksLikeRealNamePart(word: string): boolean {
  const letters = lettersOnly(word);
  if (letters.length < 2) return false;
  if (PLACEHOLDER_WORDS.has(letters)) return false;
  if (!/[aeiouy]/i.test(letters)) return false;
  if (/(.)\1{2,}/i.test(letters)) return false;
  // After kh/bh collapse, reject only extreme gibberish runs
  if (maxConsonantRun(letters) > 4) return false;
  if (vowelRatio(letters) < 0.15) return false;
  return true;
}

export function isValidPersonName(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length < 3) return false;
  if (!PERSON_NAME_PATTERN.test(trimmed)) return false;

  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return false;
  return parts.every((part) => looksLikeRealNamePart(part));
}

export function personNameError(value: string, label = "Name"): string | null {
  const trimmed = value.trim();
  if (!trimmed) return `${label} is required.`;
  if (!PERSON_NAME_PATTERN.test(trimmed)) {
    return `Enter full ${label.toLowerCase()} with first and last name (letters only, no numbers).`;
  }
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length < 2) {
    return `Enter both first and last name for ${label.toLowerCase()}.`;
  }
  if (!parts.every((part) => looksLikeRealNamePart(part))) {
    return `Enter a real-looking ${label.toLowerCase()}. Placeholder or random text is not allowed.`;
  }
  return null;
}

export function isValidAddress(value: string): boolean {
  return addressError(value) == null;
}

export function addressError(value: string): string | null {
  if (!value.trim()) {
    return "Address is required.";
  }
  return null;
}

export function parentDetailsError(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return "Please select a relationship.";
  }
  if (!(PARENT_RELATIONSHIP_OPTIONS as readonly string[]).includes(normalized)) {
    return "Please select a valid relationship.";
  }
  return null;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function normalizeDateValue(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  const dmy = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) {
    return `${dmy[3]}-${pad2(Number(dmy[2]))}-${pad2(Number(dmy[1]))}`;
  }

  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    return `${parsed.getFullYear()}-${pad2(parsed.getMonth() + 1)}-${pad2(parsed.getDate())}`;
  }

  return "";
}

function parseIndianMobileDigits(raw: string): string {
  let digits = raw.replace(/\D/g, "");
  if (digits.length === 0) return "";

  if (digits.startsWith("91") && digits.length > 10) {
    digits = digits.slice(2);
  }
  if (digits.startsWith("0") && digits.length === 11) {
    digits = digits.slice(1);
  }

  return digits.slice(0, 10);
}

export function toIsoDate(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function todayIsoDate(): string {
  return toIsoDate(new Date());
}

/** Latest birthday allowed for someone who is at least `years` years old today. */
export function maxBirthDateForMinAge(years: number = EMPLOYEE_MIN_AGE): string {
  const today = new Date();
  return toIsoDate(new Date(today.getFullYear() - years, today.getMonth(), today.getDate()));
}

/** Common work / personal email TLDs and country suffixes */
const VALID_EMAIL_SUFFIXES = new Set([
  "com",
  "in",
  "org",
  "net",
  "edu",
  "gov",
  "io",
  "me",
  "info",
  "biz",
  "dev",
  "co.in",
  "com.in",
  "org.in",
  "net.in",
  "edu.in",
  "gov.in",
  "ac.in",
  "co.uk",
  "uk",
  "us",
]);

/** Well-known mailbox providers (optional fast-path). */
const KNOWN_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.co.in",
  "yahoo.in",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "icloud.com",
  "protonmail.com",
  "proton.me",
  "rediffmail.com",
  "zoho.com",
  "ymail.com",
]);

const EMAIL_LOCAL_PATTERN = /^[A-Za-z0-9._+-]+$/;
const EMAIL_DOMAIN_LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

function emailDomainSuffix(domain: string): string | null {
  const lower = domain.toLowerCase();
  for (const suffix of [
    "co.in",
    "com.in",
    "org.in",
    "net.in",
    "edu.in",
    "gov.in",
    "ac.in",
    "co.uk",
  ]) {
    if (lower.endsWith(`.${suffix}`)) return suffix;
  }
  const lastDot = lower.lastIndexOf(".");
  if (lastDot <= 0 || lastDot === lower.length - 1) return null;
  return lower.slice(lastDot + 1);
}

function emailHostLabels(domain: string, suffix: string): string[] {
  const lower = domain.toLowerCase();
  const host = lower.slice(0, lower.length - suffix.length - 1);
  return host.split(".").filter(Boolean);
}

export function emailError(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return "Email is required.";

  const atIndex = trimmed.indexOf("@");
  if (atIndex <= 0 || atIndex !== trimmed.lastIndexOf("@") || atIndex === trimmed.length - 1) {
    return "Enter a valid email address (e.g. name@gmail.com).";
  }

  const local = trimmed.slice(0, atIndex);
  const domain = trimmed.slice(atIndex + 1);

  if (!EMAIL_LOCAL_PATTERN.test(local) || local.startsWith(".") || local.endsWith(".")) {
    return "Enter a valid email address (e.g. name@gmail.com).";
  }

  if (!domain.includes(".")) {
    return "Enter a valid email domain (e.g. gmail.com, yahoo.com).";
  }

  const suffix = emailDomainSuffix(domain);
  if (!suffix || !VALID_EMAIL_SUFFIXES.has(suffix)) {
    return "Use a valid email ending like .com, .in, or .org (not .yy or other invalid domains).";
  }

  const domainLower = domain.toLowerCase();
  if (KNOWN_EMAIL_DOMAINS.has(domainLower)) {
    return null;
  }

  const hostLabels = emailHostLabels(domain, suffix);
  if (hostLabels.length === 0) {
    return "Enter a valid email domain (e.g. gmail.com, yahoo.com).";
  }

  const primaryLabel = hostLabels[hostLabels.length - 1]!;
  if (
    primaryLabel.length < 3 ||
    !EMAIL_DOMAIN_LABEL_PATTERN.test(primaryLabel) ||
    hostLabels.some((label) => label.length < 2 || !EMAIL_DOMAIN_LABEL_PATTERN.test(label))
  ) {
    return "Enter a valid email domain (e.g. gmail.com, yahoo.com, company.com).";
  }

  return null;
}

export function isValidEmail(value: string): boolean {
  return emailError(value) == null;
}

export function isValidPan(value: string): boolean {
  return PAN_PATTERN.test(value.replace(/\s/g, "").toUpperCase());
}

export function isValidAadhaar(value: string): boolean {
  return AADHAAR_PATTERN.test(value.replace(/\D/g, ""));
}

export function isValidBankAccountNumber(value: string): boolean {
  return BANK_ACCOUNT_PATTERN.test(value.replace(/\D/g, ""));
}

export function isValidIfscCode(value: string): boolean {
  return IFSC_CODE_PATTERN.test(value.replace(/\s/g, "").toUpperCase());
}

export function isValidIndianMobile(value: string): boolean {
  return INDIAN_MOBILE_PATTERN.test(parseIndianMobileDigits(value));
}

function parsePositiveAmount(value: string): number | null {
  const cleaned = value.replace(/,/g, "").trim();
  if (!cleaned) return null;
  const amount = Number(cleaned);
  if (!Number.isFinite(amount)) return null;
  return amount;
}

function ageFromBirthday(iso: string, today = new Date()): number | null {
  const normalized = normalizeDateValue(iso);
  if (!normalized) return null;

  const [y, m, d] = normalized.split("-").map(Number);
  const birth = new Date(y, m - 1, d);
  if (Number.isNaN(birth.getTime())) return null;

  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age -= 1;
  }
  return age;
}

/**
 * Validate employee create/edit form fields.
 * Optional identity fields (PAN / Aadhaar) are only validated when non-empty.
 */
export function validateEmployeeForm(
  form: EmployeeFormState,
  options?: { requireSalary?: boolean },
): EmployeeFieldErrors {
  const errors: EmployeeFieldErrors = {};
  const today = todayIsoDate();

  const nameError = personNameError(form.name, "Name");
  if (nameError) {
    errors.name = nameError;
  }

  const addrError = addressError(form.address);
  if (addrError) {
    errors.address = addrError;
  }

  if (!form.role.trim()) {
    errors.role = "Role is required.";
  }

  if (!form.position.trim()) {
    errors.position = "Position is required.";
  }

  if (!form.email.trim()) {
    errors.email = "Email is required.";
  } else {
    const emailErr = emailError(form.email);
    if (emailErr) {
      errors.email = emailErr;
    }
  }

  if (form.password.trim()) {
    const passwordError = passwordStrengthError(form.password);
    if (passwordError) {
      errors.password = passwordError;
    }
  }

  if (!form.contactNumber.trim()) {
    errors.contactNumber = "Contact number is required.";
  } else if (!isValidIndianMobile(form.contactNumber)) {
    errors.contactNumber = "Enter a valid 10-digit Indian mobile number.";
  }

  if (!form.birthdayDate.trim()) {
    errors.birthdayDate = "Birthday is required.";
  } else {
    const birthday = normalizeDateValue(form.birthdayDate);
    if (!birthday) {
      errors.birthdayDate = "Enter a valid birthday.";
    } else if (birthday > today) {
      errors.birthdayDate = "Birthday cannot be a future date.";
    } else {
      const age = ageFromBirthday(birthday);
      if (age == null || age < EMPLOYEE_MIN_AGE) {
        errors.birthdayDate = `Employee must be at least ${EMPLOYEE_MIN_AGE} years old.`;
      }
    }
  }

  const skipEmploymentFields = hidesEmploymentFields({
    position: form.position,
    role: form.role,
  });

  if (!skipEmploymentFields) {
    if (!form.joiningDate.trim()) {
      errors.joiningDate = "Joining date is required.";
    } else {
      const joining = normalizeDateValue(form.joiningDate);
      if (!joining) {
        errors.joiningDate = "Enter a valid joining date.";
      } else if (joining > today) {
        errors.joiningDate = "Joining date cannot be a future date.";
      }
    }

    if (form.lastIncrementDate.trim()) {
      const lastIncrement = normalizeDateValue(form.lastIncrementDate);
      if (!lastIncrement) {
        errors.lastIncrementDate = "Enter a valid last increment date.";
      } else if (lastIncrement > today) {
        errors.lastIncrementDate = "Last increment date cannot be a future date.";
      }
    }

    if (form.experience.trim()) {
      const experience = Number(form.experience);
      if (!Number.isFinite(experience) || experience < 0) {
        errors.experience = "Experience must be 0 or a positive number.";
      } else if (experience > EMPLOYEE_MAX_EXPERIENCE_YEARS) {
        errors.experience = `Experience cannot be more than ${EMPLOYEE_MAX_EXPERIENCE_YEARS} years.`;
      }
    }

    if (form.salary.trim() || options?.requireSalary) {
      const amount = parsePositiveAmount(form.salary);
      if (amount == null) {
        errors.salary = "Enter a valid salary amount.";
      } else if (amount <= 0) {
        errors.salary = "Salary must be a positive amount.";
      }
    }
  }

  const pan = form.panNumber.replace(/\s/g, "").toUpperCase();
  if (!pan) {
    errors.panNumber = "PAN number is required.";
  } else if (!isValidPan(pan)) {
    errors.panNumber = "Enter a valid PAN (e.g. ABCDE1234F).";
  }

  const aadhaar = form.aadharNumber.replace(/\D/g, "");
  if (!aadhaar) {
    errors.aadharNumber = "Aadhaar number is required.";
  } else if (!isValidAadhaar(aadhaar)) {
    errors.aadharNumber = "Enter a valid 12-digit Aadhaar number.";
  }

  const bankAccount = form.bankAccountNumber.replace(/\D/g, "");
  if (bankAccount && !isValidBankAccountNumber(bankAccount)) {
    errors.bankAccountNumber = `Enter a valid bank account number (${BANK_ACCOUNT_MIN_LENGTH}–${BANK_ACCOUNT_MAX_LENGTH} digits), or leave blank.`;
  }

  const ifsc = form.ifscCode.replace(/\s/g, "").toUpperCase();
  if (ifsc && !isValidIfscCode(ifsc)) {
    errors.ifscCode = `Enter a valid ${IFSC_CODE_LENGTH}-character IFSC code, or leave blank.`;
  }

  const parentNameErr = personNameError(form.parentName, "Contact name");
  if (parentNameErr) {
    errors.parentName = parentNameErr;
  }

  if (!form.parentContact.trim()) {
    errors.parentContact = "Contact number is required.";
  } else if (!isValidIndianMobile(form.parentContact)) {
    errors.parentContact = "Enter a valid 10-digit Indian mobile number.";
  } else if (
    isValidIndianMobile(form.contactNumber) &&
    parseIndianMobileDigits(form.contactNumber) === parseIndianMobileDigits(form.parentContact)
  ) {
    errors.parentContact =
      "Emergency contact number must be different from the employee contact number.";
    errors.contactNumber =
      "Employee contact number must be different from the emergency contact number.";
  }

  const parentDetailsErr = parentDetailsError(form.parentDetails);
  if (parentDetailsErr) {
    errors.parentDetails = parentDetailsErr;
  }

  return errors;
}

export function firstEmployeeValidationMessage(errors: EmployeeFieldErrors): string | null {
  const first = Object.values(errors).find((message) => Boolean(message));
  return first ?? null;
}
