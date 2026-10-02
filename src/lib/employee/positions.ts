import { POSITIONS } from "@/app/consts/common";
import { formatEmployeePositionLabel } from "@/lib/employee/form";

export type PositionOption = {
  value: string;
  label: string;
};

/** Sentinel select value used only in the UI to reveal the add-position fields. */
export const ADD_NEW_POSITION_VALUE = "__add_new_position__";

/** Built-in positions always available (stored as snake_case values). */
export const DEFAULT_POSITION_OPTIONS: PositionOption[] = [
  { value: POSITIONS.TRAINEE, label: "Trainee" },
  { value: POSITIONS.AI_ML_LLM_TRAINEE, label: "AI/ML & LLM Trainee" },
  { value: POSITIONS.FRONTEND_DEVELOPER, label: "Frontend Developer" },
  { value: POSITIONS.SENIOR_FRONTEND_DEVELOPER, label: "Senior Frontend Developer" },
  { value: POSITIONS.BACKEND_DEVELOPER, label: "Backend Developer" },
  { value: POSITIONS.SENIOR_BACKEND_DEVELOPER, label: "Senior Backend Developer" },
  { value: POSITIONS.FULLSTACK_DEVELOPER, label: "Fullstack Developer" },
  { value: POSITIONS.SENIOR_FULLSTACK_DEVELOPER, label: "Senior Fullstack Developer" },
  { value: POSITIONS.AI_ML_LLM_DEVELOPER, label: "AI/ML & LLM Developer" },
  { value: POSITIONS.HR_MANAGER, label: "HR Manager" },
  { value: POSITIONS.TEAM_LEAD, label: "Team Lead" },
  { value: POSITIONS.CEO, label: "CEO" },
  { value: POSITIONS.OTHER, label: "Other" },
];

export function slugifyPosition(label: string): string {
  return String(label ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function normalizePositionLabel(label: string): string {
  return String(label ?? "").trim().replace(/\s+/g, " ");
}

/**
 * Merge built-in positions with custom labels from the Positions sheet.
 * Custom entries that collide with a built-in value/label are skipped.
 * "Other" always stays last.
 */
export function mergePositionOptions(customLabels: string[]): PositionOption[] {
  const other = DEFAULT_POSITION_OPTIONS.find((option) => option.value === POSITIONS.OTHER);
  const options = DEFAULT_POSITION_OPTIONS.filter((option) => option.value !== POSITIONS.OTHER);
  const valueKeys = new Set(options.map((option) => option.value.toLowerCase()));
  const labelKeys = new Set(options.map((option) => option.label.toLowerCase()));
  if (other) {
    valueKeys.add(other.value.toLowerCase());
    labelKeys.add(other.label.toLowerCase());
  }

  for (const raw of customLabels) {
    const label = normalizePositionLabel(raw);
    if (!label) continue;
    const value = slugifyPosition(label);
    if (!value) continue;
    if (valueKeys.has(value) || labelKeys.has(label.toLowerCase())) continue;
    valueKeys.add(value);
    labelKeys.add(label.toLowerCase());
    options.push({ value, label });
  }

  if (other) options.push(other);
  return options;
}

/** Ensure a stored position value appears in the select (e.g. legacy / custom). */
export function ensurePositionInOptions(
  options: PositionOption[],
  positionValue: string,
): PositionOption[] {
  const value = String(positionValue ?? "").trim();
  if (!value) return options;
  if (options.some((option) => option.value === value)) return options;

  const next = [
    ...options,
    {
      value,
      label: formatEmployeePositionLabel(value) || value,
    },
  ];

  const other = next.find((option) => option.value === POSITIONS.OTHER);
  if (!other) return next;

  const withoutOther = next.filter((option) => option.value !== POSITIONS.OTHER);
  return [...withoutOther, other];
}
