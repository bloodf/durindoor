import { isString } from "../../src/shared/utils/typeChecks.js";
const CODEX_ACCOUNT_ID_FIELDS = Object.freeze([
"workspaceId",
"chatgptAccountId",
"accountId"]
);
const UNSAFE_HEADER_VALUE = /[\0\r\n]/;

function normalizeAccountId(value) {
  if (!isString(value)) return "";
  const normalized = value.trim();
  return normalized && normalized.length <= 256 && !UNSAFE_HEADER_VALUE.test(normalized) ?
  normalized :
  "";
}

/**
 * Decode the chatgpt_account_id embedded in a Codex OAuth id_token (JWT).
 * Legacy connections may carry only an idToken with no explicit account field.
 */
function decodeAccountIdFromIdToken(idToken) {
  if (!isString(idToken) || !idToken) return "";
  try {
    const payload = JSON.parse(Buffer.from(idToken.split(".")[1] || "", "base64url").toString("utf8"));
    return normalizeAccountId(
      payload?.["https://api.openai.com/auth"]?.chatgpt_account_id || payload?.account_id || ""
    );
  } catch {
    return "";
  }
}

/**
 * Resolves the Codex account binding ID without rewriting legacy metadata.
 * Precedence is workspaceId, then chatgptAccountId, then accountId, then the
 * account id decoded from the OAuth id_token. Only a non-empty trimmed string is
 * accepted; numbers and objects are never coerced.
 */
export function resolveCodexAccountId(providerSpecificData = {}, idToken = null) {
  for (const field of CODEX_ACCOUNT_ID_FIELDS) {
    const value = normalizeAccountId(providerSpecificData?.[field]);
    if (value) return value;
  }
  return decodeAccountIdFromIdToken(idToken);
}

/** Conflicting aliases are unsafe for persistence deduplication. */
export function hasConflictingCodexAccountIds(providerSpecificData = {}) {
  const ids = CODEX_ACCOUNT_ID_FIELDS.
  map((field) => normalizeAccountId(providerSpecificData?.[field])).
  filter(Boolean);
  return new Set(ids).size > 1;
}

export function hasHeaderIgnoreCase(headers, name) {
  const expected = name.toLowerCase();
  return Object.keys(headers || {}).some((key) => key.toLowerCase() === expected);
}

/** Adds the resolved binding only when the caller did not already set it. */
export function applyCodexAccountHeader(headers, providerSpecificData, headerName = "ChatGPT-Account-ID", idToken = null) {
  if (hasHeaderIgnoreCase(headers, headerName)) return headers;
  const accountId = resolveCodexAccountId(providerSpecificData, idToken);
  if (accountId) headers[headerName] = accountId;
  return headers;
}