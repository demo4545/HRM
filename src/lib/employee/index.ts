/** Employee domain — form, sheet, search, and API helpers */

export { generateEmployeeId, parseEmployeeIdNumber } from "./id";

export {
  initialEmployeeForm,
  type EmployeeFormState,
  PARENT_RELATIONSHIP_OPTIONS,
  type ParentRelationship,
  formatParentRelationshipLabel,
  formatEmployeePositionLabel,
  formatEmployeeRoleLabel,
  headerToFormKey,
  REQUIRED_EMPLOYEE_FORM_HEADERS,
  ensureRequiredEmployeeFormHeaders,
  employeeHeadersEqual,
  formToSheetRow,
  sheetRowToForm,
  normalizeStatus,
  isEmployeeStatusActive,
} from "./form";

export { collectSkillsFromEmployeeSheet } from "./skills";

export {
  BANK_ACCOUNT_MIN_LENGTH,
  BANK_ACCOUNT_MAX_LENGTH,
  IFSC_CODE_LENGTH,
  EMPLOYEE_MIN_AGE,
  EMPLOYEE_MAX_EXPERIENCE_YEARS,
  type EmployeeFieldErrors,
  isCeoPosition,
  hidesEmploymentFields,
  sanitizePersonNameInput,
  splitPersonName,
  joinPersonName,
  validateEmployeeForm,
  firstEmployeeValidationMessage,
  maxBirthDateForMinAge,
  todayIsoDate,
} from "./validation";

export {
  getSheetHeaders,
  mergeRowWithFormFields,
  getEmployeeNameFromRow,
  getEmployeeIdFromRow,
  sheetRowToRange,
} from "./headers";

export type { SortOrder } from "./sort";
export { headerToKey, sortSheetData } from "./sort";

export { EMPLOYEE_SEARCH_KEYS, filterSheetBySearch } from "./search";

export { DEFAULT_PAGE_SIZE, paginateSheetData } from "./pagination";

export type { IndexedSheetRow } from "./process";
export {
  indexSheetBody,
  indexedRowsToSheetData,
  isIndexedRowInactive,
  processEmployeeSheet,
} from "./process";

export {
  EMPLOYEE_DOCUMENT_FIELDS,
  type EmployeeDocumentField,
  getDocumentDisplayName,
  getDocumentHref,
  parseGoogleDriveFileId,
  resolveProfileImageSrc,
} from "./documents";

export { EMPLOYEE_LIST_PUBLIC_FIELDS } from "./list-fields";
export { parseEmployeeListApiResponse, pickSheetRowFields } from "./list";
export { maskAadhar, maskPan } from "./mask";

export {
  formatSheetTimestamp,
  sheetTimestampsForCreate,
  sheetTimestampsForUpdate,
  withSheetRowUpdatedAt,
} from "./timestamps";
