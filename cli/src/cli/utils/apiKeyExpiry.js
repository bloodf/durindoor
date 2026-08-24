const { isFunction, isString } = require("../../../../src/shared/utils/typeChecks.cjs");
const EXPIRY_OPTIONS = Object.freeze([
{ label: "Never expires", value: "never", days: null },
{ label: "1 day", value: "1", days: 1 },
{ label: "7 days", value: "7", days: 7 },
{ label: "30 days", value: "30", days: 30 },
{ label: "90 days", value: "90", days: 90 },
{ label: "Custom local date and time", value: "custom", days: null }]
);

const ABSOLUTE_ISO_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):(\d{2}))$/;

function parseAbsoluteTimestamp(value) {
  if (!isString(value)) return null;
  const match = ABSOLUTE_ISO_TIMESTAMP.exec(value);
  if (!match) return null;
  const [, y, mo, d, h, mi, s, fraction = "", zone, sign, oh = "0", om = "0"] = match;
  const parts = [y, mo, d, h, mi, s, fraction.padEnd(3, "0"), oh, om].map(Number);
  const [year, month, day, hour, minute, second, millisecond, offsetHour, offsetMinute] = parts;
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59 || offsetHour > 23 || offsetMinute > 59) return null;

  const wallClock = new Date(0);
  wallClock.setUTCFullYear(year, month - 1, day);
  wallClock.setUTCHours(hour, minute, second, millisecond);
  if (
  wallClock.getUTCFullYear() !== year ||
  wallClock.getUTCMonth() !== month - 1 ||
  wallClock.getUTCDate() !== day ||
  wallClock.getUTCHours() !== hour ||
  wallClock.getUTCMinutes() !== minute ||
  wallClock.getUTCSeconds() !== second ||
  wallClock.getUTCMilliseconds() !== millisecond)
  return null;

  const offset = zone === "Z" ? 0 : (sign === "-" ? -1 : 1) * (offsetHour * 60 + offsetMinute);
  const timestamp = wallClock.getTime() - offset * 60_000;
  return Number.isFinite(timestamp) && Date.parse(value) === timestamp ? timestamp : null;
}

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
  date.getFullYear() !== year ||
  date.getMonth() !== month - 1 ||
  date.getDate() !== day ||
  date.getHours() !== hour ||
  date.getMinutes() !== minute)
  return null;
  return date;
}

function expiryFromChoice(choice, customLocalValue, now = Date.now()) {
  if (choice?.value === "never") return null;
  const nowTime = Number(now);
  if (!choice || !Number.isFinite(nowTime)) throw new Error("Choose a valid expiry option");
  if (choice.days != null) return new Date(nowTime + choice.days * 86_400_000).toISOString();
  const date = parseLocalDateTime(customLocalValue);
  if (!date || date.getTime() <= nowTime) throw new Error("Expiry must be a future local date and time");
  return date.toISOString();
}

function isExpired(expiresAt, now = Date.now()) {
  if (expiresAt === null || expiresAt === undefined) return false;
  const time = parseAbsoluteTimestamp(expiresAt);
  return time === null || time <= Number(now);
}

function formatExpiry(expiresAt, now = Date.now(), formatDate) {
  if (expiresAt === null || expiresAt === undefined) return "Never expires";
  const time = parseAbsoluteTimestamp(expiresAt);
  if (time === null) return "Invalid expiry";
  const date = new Date(time);
  const rendered = isFunction(formatDate) ? formatDate(expiresAt) : date.toLocaleString();
  return time <= Number(now) ? `Expired: ${rendered}` : `Expires: ${rendered}`;
}

module.exports = {
  EXPIRY_OPTIONS,
  expiryFromChoice,
  formatExpiry,
  isExpired
};