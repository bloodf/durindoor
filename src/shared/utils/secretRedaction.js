export const REDACTED_SECRET = "[REDACTED]";

function isSecretField(name) {
  const normalized = String(name || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
  return normalized === "token"
    || normalized === "authorization"
    || /(?:apikey|authtoken|accesstoken|refreshtoken|idtoken|clitoken|password|secret)$/.test(normalized);
}

/** Return a deep copy suitable for status/management responses. */
export function redactSecrets(value) {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(Object.entries(value).map(([key, child]) => [
    key,
    isSecretField(key) && child != null && child !== "" ? REDACTED_SECRET : redactSecrets(child),
  ]));
}
