import { isAbsoluteApiKeyExpiryTimestamp } from "@/shared/utils/apiKeyExpiry";

export const API_KEY_EXPIRY_PRESETS = Object.freeze([
  { value: "never", label: "Never expires", days: null },
  { value: "1", label: "1 day", days: 1 },
  { value: "7", label: "7 days", days: 7 },
  { value: "30", label: "30 days", days: 30 },
  { value: "90", label: "90 days", days: 90 },
  { value: "custom", label: "Custom date and time", days: null },
]);

function parseLocalDateTime(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value || "");
  if (!match) return null;
  const [, yearText, monthText, dayText, hourText, minuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const date = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (
    date.getFullYear() !== year
    || date.getMonth() !== month - 1
    || date.getDate() !== day
    || date.getHours() !== hour
    || date.getMinutes() !== minute
  ) return null;
  return date;
}

export function expiryFromSelection(selection, customLocalValue, now = Date.now()) {
  if (selection === "never") return null;
  const preset = API_KEY_EXPIRY_PRESETS.find((item) => item.value === selection);
  const nowTime = Number(now);
  if (!preset || !Number.isFinite(nowTime)) throw new Error("Choose a valid expiry option");
  if (preset.days != null) return new Date(nowTime + (preset.days * 86_400_000)).toISOString();

  const date = parseLocalDateTime(customLocalValue);
  if (!date || date.getTime() <= nowTime) throw new Error("Expiry must be a future local date and time");
  return date.toISOString();
}

export function toLocalDateTimeInput(expiresAt) {
  if (!isAbsoluteApiKeyExpiryTimestamp(expiresAt)) return "";
  const date = new Date(expiresAt);
  if (!Number.isFinite(date.getTime())) return "";
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function expirySelectionFromValue(expiresAt) {
  return expiresAt === null || expiresAt === undefined
    ? { selection: "never", customLocalValue: "" }
    : { selection: "custom", customLocalValue: toLocalDateTimeInput(expiresAt) };
}

export function formatKeyExpiry(expiresAt, now = Date.now()) {
  if (expiresAt === null || expiresAt === undefined) return { text: "Never expires", danger: false };
  if (!isAbsoluteApiKeyExpiryTimestamp(expiresAt)) return { text: "Invalid expiry", danger: true };
  const date = new Date(expiresAt);
  const time = date.getTime();
  if (!Number.isFinite(time)) return { text: "Invalid expiry", danger: true };
  const rendered = date.toLocaleString();
  return time <= Number(now)
    ? { text: `Expired ${rendered}`, danger: true }
    : { text: `Expires ${rendered}`, danger: false };
}
