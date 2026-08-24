import { isString } from "./typeChecks.js";
const ABSOLUTE_ISO_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):(\d{2}))$/;

/**
 * Parse a strict absolute ISO-8601 timestamp without accepting Date's silent
 * calendar normalization (for example February 30). Returns epoch ms or null.
 */
export function parseAbsoluteTimestamp(value) {
  if (!isString(value)) return null;
  const match = ABSOLUTE_ISO_TIMESTAMP.exec(value);
  if (!match) return null;

  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fraction = "", zone, sign, offsetHourText = "0", offsetMinuteText = "0"] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const millisecond = Number(fraction.padEnd(3, "0"));
  const offsetHour = Number(offsetHourText);
  const offsetMinute = Number(offsetMinuteText);

  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59 || offsetHour > 23 || offsetMinute > 59) {
    return null;
  }

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
  {
    return null;
  }

  const offsetMinutes = zone === "Z" ? 0 : (sign === "-" ? -1 : 1) * (offsetHour * 60 + offsetMinute);
  const timestamp = wallClock.getTime() - offsetMinutes * 60_000;
  return Number.isFinite(timestamp) && Date.parse(value) === timestamp ? timestamp : null;
}

export function canonicalizeAbsoluteTimestamp(value) {
  const timestamp = parseAbsoluteTimestamp(value);
  return timestamp === null ? null : new Date(timestamp).toISOString();
}