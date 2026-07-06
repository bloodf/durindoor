const { maskSecret } = require("./logger");

const SECRET_HEADER_NAMES = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "api-key",
  "bearer",
]);

function isSecretHeader(name) {
  return SECRET_HEADER_NAMES.has(String(name || "").toLowerCase());
}

function maskHeaderValue(name, value) {
  const lower = String(name || "").toLowerCase();
  if (lower === "set-cookie") return "[REDACTED]";
  return maskSecret(String(Array.isArray(value) ? value.join(", ") : value));
}

function sanitizeHeaders(headers = {}) {
  const result = {};
  for (const [key, value] of Object.entries(headers || {})) {
    const lowerKey = key.toLowerCase();
    if (value === undefined || value === null) continue;
    result[lowerKey] = isSecretHeader(lowerKey)
      ? maskHeaderValue(lowerKey, value)
      : String(Array.isArray(value) ? value.join(", ") : value);
  }
  return result;
}

module.exports = { sanitizeHeaders };
