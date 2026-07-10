const ABSOLUTE_ISO_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):(\d{2}))$/;

function parseAbsoluteTimestamp(value) {
  if (typeof value !== "string") return null;
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

  // Build the stated wall-clock time without Date.UTC's special handling for
  // years 0-99, then compare every component to reject normalized dates such
  // as February 30 instead of silently storing a different instant.
  const wallClock = new Date(0);
  wallClock.setUTCFullYear(year, month - 1, day);
  wallClock.setUTCHours(hour, minute, second, millisecond);
  if (
    wallClock.getUTCFullYear() !== year
    || wallClock.getUTCMonth() !== month - 1
    || wallClock.getUTCDate() !== day
    || wallClock.getUTCHours() !== hour
    || wallClock.getUTCMinutes() !== minute
    || wallClock.getUTCSeconds() !== second
    || wallClock.getUTCMilliseconds() !== millisecond
  ) {
    return null;
  }

  const offsetMinutes = zone === "Z" ? 0 : (sign === "-" ? -1 : 1) * ((offsetHour * 60) + offsetMinute);
  const timestamp = wallClock.getTime() - (offsetMinutes * 60_000);
  return Number.isFinite(timestamp) && Date.parse(value) === timestamp ? timestamp : null;
}

export function isAbsoluteApiKeyExpiryTimestamp(value) {
  return parseAbsoluteTimestamp(value) !== null;
}

export class ApiKeyExpiryValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ApiKeyExpiryValidationError";
    this.code = "INVALID_API_KEY_EXPIRY";
  }
}

/** Canonicalize an absolute timestamp while permitting already-expired history. */
export function canonicalizeApiKeyExpiresAt(value) {
  if (value === null) return null;
  const time = parseAbsoluteTimestamp(value);
  if (time === null) {
    throw new ApiKeyExpiryValidationError("expiresAt must be an absolute ISO-8601 timestamp with a timezone");
  }
  return new Date(time).toISOString();
}

/** Convert a future absolute ISO-8601 timestamp to canonical UTC storage. */
export function normalizeApiKeyExpiresAt(value, now = Date.now()) {
  const canonical = canonicalizeApiKeyExpiresAt(value);
  if (canonical === null) return null;
  const time = Date.parse(canonical);
  const nowTime = Number(now);
  if (!Number.isFinite(nowTime) || time <= nowTime) {
    throw new ApiKeyExpiryValidationError("expiresAt must be in the future");
  }
  return canonical;
}

/** Missing expiry never expires; malformed stored values fail closed. */
export function isApiKeyExpired(value, now = Date.now()) {
  if (value === null || value === undefined) return false;
  const time = parseAbsoluteTimestamp(value);
  const nowTime = Number(now);
  return time === null || !Number.isFinite(nowTime) || time <= nowTime;
}

export function isApiKeyExpiryValidationError(error) {
  return error?.code === "INVALID_API_KEY_EXPIRY";
}
