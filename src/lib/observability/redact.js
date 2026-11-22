import { isNumber, isObject, isString } from "../../shared/utils/typeChecks.js";

export const SENSITIVE_KEY_PARTS = [
  "authorization",
  "xapikey",
  "cookie",
  "token",
  "apikey",
  "setcookie",
  "xgoogapikey",
  "relaykey",
];

const SUBSTRING_SENSITIVE_KEY_PARTS = ["authorization", "xapikey", "cookie", "setcookie", "xgoogapikey", "relaykey", "password", "secret"];

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
  return ["code", "clientsecret"].includes(normalized)
    || SENSITIVE_QUERY_PARTS.includes(normalized)
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

const URL_PATTERN = /\bhttps?:\/\/[^\s#"']*/g;

function redactString(value) {
  return redactInlineSecrets(value.replace(URL_PATTERN, (match) => {
    match = match.replace(/^(https?:\/\/)([^/?#\s]*)(.*)$/i, (url, scheme, authority, suffix) => {
      const atIndex = authority.lastIndexOf("@");
      return atIndex < 0 ? url : `${scheme}[redacted]@${authority.slice(atIndex + 1)}${suffix}`;
    });
    const qIndex = match.indexOf("?");
    if (qIndex < 0) return match;
    const hashIndex = match.indexOf("#", qIndex);
    const queryEnd = hashIndex < 0 ? match.length : hashIndex;
    return `${match.slice(0, qIndex)}?${redactQueryString(match.slice(qIndex + 1, queryEnd))}${match.slice(queryEnd)}`;
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
