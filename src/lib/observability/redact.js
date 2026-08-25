import { isNumber, isObject, isString } from "../../shared/utils/typeChecks.js";

export const SENSITIVE_KEY_PARTS = [
  "authorization",
  "xapikey",
  "cookie",
  "token",
  "apikey",
  "setcookie",
  "xgoogapikey",
];

const SUBSTRING_SENSITIVE_KEY_PARTS = ["authorization", "xapikey", "cookie", "setcookie", "xgoogapikey"];

const TOKEN_USAGE_SUFFIXES = ["tokens", "tokencount"];

function normalizeKey(key) {
  return String(key).toLowerCase().replace(/[-_]/g, "");
}

export function isSensitiveKey(key, value) {
  const normalized = normalizeKey(key);
  if (isNumber(value) && TOKEN_USAGE_SUFFIXES.some((suffix) => normalized.endsWith(suffix))) {
    return false;
  }
  return SENSITIVE_KEY_PARTS.includes(normalized)
    || SUBSTRING_SENSITIVE_KEY_PARTS.some((part) => normalized.includes(part))
    || normalized.endsWith("apikey")
    || normalized.endsWith("token")
    || normalized.endsWith("tokens")
    || normalized.endsWith("tokencount");
}

export function redactHeaders(headers, { keepKeys = true } = {}) {
  if (!headers || !isObject(headers)) return {};

  return Object.fromEntries(Object.entries(headers).flatMap(([key, value]) => {
    if (!isSensitiveKey(key)) return [[key, value]];
    return keepKeys ? [[key, "[redacted]"]] : [];
  }));
}

const SENSITIVE_QUERY_PARTS = ["key", ...SENSITIVE_KEY_PARTS];

function isSensitiveQueryParam(name) {
  const normalized = normalizeKey(name);
  return SENSITIVE_QUERY_PARTS.includes(normalized)
    || SUBSTRING_SENSITIVE_KEY_PARTS.some((part) => normalized.includes(part))
    || normalized.endsWith("apikey")
    || normalized.endsWith("token")
    || normalized.endsWith("tokens");
}
function redactInlineSecrets(value) {
  return value
    .replace(/Bearer\s+[^\s,;"']+/gi, "Bearer [redacted]")
    .replace(/sk[-_][A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/AIza[A-Za-z0-9_-]+/g, "[redacted]");
}

function redactQueryString(query) {
  const params = new URLSearchParams(query);
  const redacted = new URLSearchParams();
  for (const [name, value] of [...params]) {
    redacted.append(name, isSensitiveQueryParam(name) ? "[redacted]" : redactInlineSecrets(value));
  }
  return redacted.toString();
}

const URL_PATTERN = /\bhttps?:\/\/\S*?\?[^\s#"']*/g;

function redactString(value) {
  return redactInlineSecrets(value.replace(URL_PATTERN, (match) => {
    const qIndex = match.indexOf("?");
    return `${match.slice(0, qIndex)}?${redactQueryString(match.slice(qIndex + 1))}`;
  }));
}

export function redactValue(value, seen = new WeakSet()) {
  if (isString(value)) return redactString(value);
  if (!value || !isObject(value)) return value;
  if (seen.has(value)) return "[circular]";
  seen.add(value);

  try {
    if (Array.isArray(value)) return value.map((entry) => redactValue(entry, seen));

    const out = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = isSensitiveKey(key, entry) ? "[redacted]" : redactValue(entry, seen);
    }
    return out;
  } finally {
    seen.delete(value);
  }
}
