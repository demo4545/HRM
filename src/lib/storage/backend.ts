/**
 * Daily multi-user flows (attendance, login, notifications, absence gate, system specs)
 * use Firebase when DAILY_DATA_STORAGE=firebase. Network access (office Wi‑Fi / WFH)
 * always uses Firestore. Other infrequent HR flows may still use Google Sheets.
 */
export function isFirebaseDailyStorage(): boolean {
  const daily = process.env.DAILY_DATA_STORAGE?.trim().toLowerCase();
  if (daily === "firebase") return true;
  if (daily === "sheets") return false;

  const attendance = process.env.ATTENDANCE_STORAGE?.trim().toLowerCase();
  if (attendance === "firebase") return true;
  if (attendance === "sheets") return false;

  return Boolean(process.env.FIREBASE_PROJECT_ID?.trim());
}
