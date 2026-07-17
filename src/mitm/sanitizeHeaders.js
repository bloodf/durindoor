const SECRET_HEADER_NAMES = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "api-key",
  "bearer",
  "proxy-authorization",
  "x-goog-api-key",
  "x-apikey",
  "x-subscription-token",
  "xi-api-key",
  "x-arcjet-key",
  "x-amz-security-token",
  "x-amz-session-token",
  "x-auth-token",
  "x-access-token",
  "x-client-secret",
  "proxy-authenticate",
]);

function isSecretHeader(name) {
  const normalized = String(name || "").toLowerCase();
  return SECRET_HEADER_NAMES.has(normalized)
    || /(?:^|[-_])(authorization|cookie|token|api[-_]?key|secret)(?:$|[-_])/.test(normalized);
}

function sanitizeHeaders(headers = {}) {
  const result = {};
  for (const [key, value] of Object.entries(headers || {})) {
    const lowerKey = key.toLowerCase();
    if (value === undefined || value === null) continue;
    result[lowerKey] = isSecretHeader(lowerKey)
      ? "[REDACTED]"
      : String(Array.isArray(value) ? value.join(", ") : value);
  }
  return result;
}

module.exports = { isSecretHeader, sanitizeHeaders };
