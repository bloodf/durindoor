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
]);

function isSecretHeader(name) {
  return SECRET_HEADER_NAMES.has(String(name || "").toLowerCase());
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

module.exports = { sanitizeHeaders };
