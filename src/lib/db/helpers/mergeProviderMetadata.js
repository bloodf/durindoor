const BLOCKED_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const TOKEN_FIELDS = new Set(["accessToken", "refreshToken", "idToken"]);

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** Deep-merges JSON metadata while ignoring prototype-pollution keys. */
export function mergeProviderSpecificData(existing = {}, incoming = {}) {
  const result = isPlainObject(existing) ? { ...existing } : {};
  if (!isPlainObject(incoming)) return result;
  for (const [key, value] of Object.entries(incoming)) {
    if (BLOCKED_KEYS.has(key) || value === undefined) continue;
    result[key] = isPlainObject(value)
      ? mergeProviderSpecificData(result[key], value)
      : value;
  }
  return result;
}

/**
 * Applies a connection patch without erasing token fields on absent/null values.
 * An inactive-to-active transition starts a new lifecycle: when a durable
 * automatic-disable discriminator is present, its event metadata is cleared.
 */
export function mergeProviderConnection(existing, patch) {
  const result = { ...existing };
  for (const [key, value] of Object.entries(patch || {})) {
    if (value === undefined) continue;
    if (TOKEN_FIELDS.has(key) && (value === null || value === "")) continue;
    result[key] = key === "providerSpecificData"
      ? mergeProviderSpecificData(existing?.providerSpecificData, value)
      : value;
  }
  if (
    existing?.isActive === false
    && patch?.isActive === true
    && existing.autoDisabledReason
    && existing.autoDisabledAt
  ) {
    Object.assign(result, {
      testStatus: null,
      lastError: null,
      errorCode: null,
      lastErrorAt: null,
      autoDisabledReason: null,
      autoDisabledAt: null,
    });
  }
  return result;
}
