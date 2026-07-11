const CODEX_ACCOUNT_ID_FIELDS = Object.freeze([
  "workspaceId",
  "chatgptAccountId",
  "accountId",
]);
const UNSAFE_HEADER_VALUE = /[\0\r\n]/;

function normalizeAccountId(value) {
  if (typeof value !== "string") return "";
  const normalized = value.trim();
  return normalized && normalized.length <= 256 && !UNSAFE_HEADER_VALUE.test(normalized)
    ? normalized
    : "";
}

/**
 * Resolves the Codex account binding ID without rewriting legacy metadata.
 * Precedence is workspaceId, then chatgptAccountId, then accountId. Only a
 * non-empty trimmed string is accepted; numbers and objects are never coerced.
 */
export function resolveCodexAccountId(providerSpecificData = {}) {
  for (const field of CODEX_ACCOUNT_ID_FIELDS) {
    const value = normalizeAccountId(providerSpecificData?.[field]);
    if (value) return value;
  }
  return "";
}

/** Conflicting aliases are unsafe for persistence deduplication. */
export function hasConflictingCodexAccountIds(providerSpecificData = {}) {
  const ids = CODEX_ACCOUNT_ID_FIELDS
    .map((field) => normalizeAccountId(providerSpecificData?.[field]))
    .filter(Boolean);
  return new Set(ids).size > 1;
}

export function hasHeaderIgnoreCase(headers, name) {
  const expected = name.toLowerCase();
  return Object.keys(headers || {}).some((key) => key.toLowerCase() === expected);
}

/** Adds the resolved binding only when the caller did not already set it. */
export function applyCodexAccountHeader(headers, providerSpecificData, headerName = "ChatGPT-Account-ID") {
  if (hasHeaderIgnoreCase(headers, headerName)) return headers;
  const accountId = resolveCodexAccountId(providerSpecificData);
  if (accountId) headers[headerName] = accountId;
  return headers;
}
