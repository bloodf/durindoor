// port(omniroute): provider peak-hour protection windows per connection
// (OmniRoute c11f661a8, #11622). A connection's providerSpecificData carries
// an optional `peakHourProtection` block; when a configured UTC window is
// active, getProviderCredentials (src/sse/services/auth.js) either blocks the
// connection or, in "avoid" mode, deprioritizes it.

import { isObject, isString } from "@/shared/utils/typeChecks";

export const PEAK_HOUR_PROTECTION_MODES = ["block", "avoid"];
export const PEAK_HOUR_PROTECTION_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

const DAY_BY_UTC_INDEX = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const MINUTES_PER_DAY = 24 * 60;
const MAX_WINDOWS = 16;

function asRecord(value) {
  return isObject(value) && value !== null && !Array.isArray(value) ? value : {};
}

function parseUtcTimeMinutes(value) {
  if (!isString(value)) return null;
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

function formatUtcTimeMinutes(minutes) {
  const normalized = ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const hour = Math.floor(normalized / 60);
  const minute = normalized % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function normalizeDays(value) {
  if (!Array.isArray(value)) return undefined;
  const days = value.
  map((day) => isString(day) ? day.trim().toLowerCase() : "").
  filter((day) => PEAK_HOUR_PROTECTION_DAYS.includes(day));
  const unique = Array.from(new Set(days));
  return unique.length > 0 ? unique : undefined;
}

/** Build one sanitized window entry, or null when start/end are unusable. */
function normalizeWindowEntry(entry) {
  const window = asRecord(entry);
  const start = parseUtcTimeMinutes(window.startUtc);
  const end = parseUtcTimeMinutes(window.endUtc);
  if (start === null || end === null || start === end) return null;

  const normalized = { startUtc: formatUtcTimeMinutes(start), endUtc: formatUtcTimeMinutes(end) };
  const id = isString(window.id) ? window.id.trim() : "";
  if (id) normalized.id = id.slice(0, 80);
  const name = isString(window.name) ? window.name.trim() : "";
  if (name) normalized.name = name.slice(0, 120);
  const days = normalizeDays(window.days);
  if (days) normalized.days = days;
  return normalized;
}

/**
 * Sanitize a raw `peakHourProtection` value into a persistable config, or
 * `null` when it describes nothing (disabled and no windows).
 * @param {unknown} value
 * @returns {{enabled: boolean, mode: "block"|"avoid", windows: object[]}|null}
 */
export function normalizePeakHourProtection(value) {
  const record = asRecord(value);
  const rawWindows = Array.isArray(record.windows) ? record.windows : [];
  const windows = rawWindows.
  slice(0, MAX_WINDOWS).
  map(normalizeWindowEntry).
  filter((window) => window !== null);

  const enabled = record.enabled === true;
  const mode = record.mode === "avoid" ? "avoid" : "block";
  if (!enabled && windows.length === 0) return null;
  return { enabled, mode, windows };
}

/** @param {unknown} providerSpecificData */
export function getPeakHourProtectionConfig(providerSpecificData) {
  return normalizePeakHourProtection(asRecord(providerSpecificData).peakHourProtection);
}

function isDayAllowed(window, date) {
  if (!window.days || window.days.length === 0) return true;
  return window.days.includes(DAY_BY_UTC_INDEX[date.getUTCDay()]);
}

function windowActiveAt(window, date) {
  if (!isDayAllowed(window, date)) return false;
  const start = parseUtcTimeMinutes(window.startUtc);
  const end = parseUtcTimeMinutes(window.endUtc);
  if (start === null || end === null || start === end) return false;
  const now = date.getUTCHours() * 60 + date.getUTCMinutes();
  return start < end ? now >= start && now < end : now >= start || now < end;
}

function nextWindowEndMs(window, date) {
  const start = parseUtcTimeMinutes(window.startUtc);
  const end = parseUtcTimeMinutes(window.endUtc);
  if (start === null || end === null || start === end) return null;

  const midnight = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const now = date.getUTCHours() * 60 + date.getUTCMinutes();
  let endDayOffset = 0;
  if (start > end && now >= start) endDayOffset = 1;
  return midnight + (endDayOffset * MINUTES_PER_DAY + end) * 60_000;
}

/**
 * Evaluate whether a connection is inside a peak-hour protection window.
 * @param {unknown} providerSpecificData
 * @param {Date} [now]
 * @returns {{active: false}|{active: true, mode: "block"|"avoid", retryAfter: string, retryAfterSeconds: number, window: object}}
 */
export function evaluatePeakHourProtection(providerSpecificData, now = new Date()) {
  const config = getPeakHourProtectionConfig(providerSpecificData);
  if (!config?.enabled || config.windows.length === 0) return { active: false };

  const active = config.windows.
  filter((window) => windowActiveAt(window, now)).
  map((window) => ({ window, endMs: nextWindowEndMs(window, now) })).
  filter((entry) => Number.isFinite(entry.endMs) && entry.endMs > now.getTime()).
  sort((a, b) => a.endMs - b.endMs)[0];

  if (!active) return { active: false };
  const retryAfterSeconds = Math.max(1, Math.ceil((active.endMs - now.getTime()) / 1000));
  return {
    active: true,
    mode: config.mode,
    retryAfter: new Date(active.endMs).toISOString(),
    retryAfterSeconds,
    window: active.window
  };
}

/** @param {object} window */
export function describePeakHourWindow(window) {
  const name = window.name ? `${window.name} ` : "";
  const days = window.days && window.days.length > 0 ? `${window.days.join(",")} ` : "daily ";
  return `${name}${days}${window.startUtc}-${window.endUtc} UTC`.trim();
}
