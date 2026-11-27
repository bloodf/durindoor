// Normalize one Codex bulk-import record to the camelCase connection shape.
//
// Besides DurinDoor's own camelCase export ({ accessToken, refreshToken, ... })
// this accepts the Codex CLI `~/.codex/auth.json` file, which nests snake_case
// OAuth fields under `tokens` ({ auth_mode, OPENAI_API_KEY, tokens: {
// id_token, access_token, refresh_token, account_id }, last_refresh }), and
// flat snake_case token exports that carry `expired` / `account_id`
// (CLIProxyAPI `CodexTokenStorage`, which also writes `type` and `plan_type`).
// Pure: no I/O. Returns a new object; the input is never mutated.
//
// Sign in with ChatGPT (SIWC) records and API-key auth files are rejected:
// their tokens belong to an issued `oaiapp_` client (or are not OAuth at all)
// and refreshing them with the Codex client would fail or revoke them.
// Sources: router-for-me/CLIProxyAPI@dbe641f286a489ecb39e3c041c554371e6add864
// internal/auth/codex/token.go; cheaper-inference/OmniRoute@b15b2ee6ac0f57af254be4a3cc60ba8a6cc9a523
// src/lib/oauth/utils/codexAuthImport.ts (auth_mode check, JWT expiry).
import { isObject, isString } from "../../shared/utils/typeChecks.js";

const SNAKE_TO_CAMEL = {
  access_token: "accessToken",
  refresh_token: "refreshToken",
  id_token: "idToken",
};

// Codex CLI / CLIProxyAPI envelope fields that are not connection data.
// OPENAI_API_KEY is a separate secret and must never be persisted as part of
// an OAuth connection. `plan_type` is re-derived from the token claims.
const ENVELOPE_FIELDS = [
  "tokens", "auth_mode", "OPENAI_API_KEY", "last_refresh", "expired", "account_id", "type", "plan_type",
];

function nonEmptyString(value) {
  return isString(value) && value.trim() ? value.trim() : undefined;
}

function reject(message) {
  const error = new Error(message);
  error.code = "OAUTH_VALIDATION_FAILED";
  throw error;
}

function jwtExpiryIso(token) {
  if (!isString(token)) return undefined;
  const parts = token.split(".");
  if (parts.length !== 3) return undefined;
  try {
    const exp = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"))?.exp;
    return Number.isSafeInteger(exp) && exp > 0 ? new Date(exp * 1000).toISOString() : undefined;
  } catch {
    return undefined;
  }
}

export function normalizeCodexImportRecord(raw) {
  if (!raw || !isObject(raw) || Array.isArray(raw)) return raw;

  if (raw.auth_mode !== undefined && raw.auth_mode !== null && raw.auth_mode !== "chatgpt") {
    reject("Unsupported Codex auth.json mode");
  }
  const clientId = nonEmptyString(raw.client_id) ?? nonEmptyString(raw.tokens?.client_id);
  if (raw.use_siwc === true || isObject(raw.siwc) || (clientId && clientId.startsWith("oaiapp_"))) {
    reject("Sign in with ChatGPT credentials cannot be imported as Codex");
  }

  const nested = isObject(raw.tokens) && !Array.isArray(raw.tokens) &&
    isString(raw.tokens.access_token) ? raw.tokens : {};
  const source = { ...raw, ...nested };
  const item = { ...raw };

  for (const [snake, camel] of Object.entries(SNAKE_TO_CAMEL)) {
    const value = nonEmptyString(source[snake]);
    if (!item[camel] && value) item[camel] = value;
    delete item[snake];
  }

  const expired = nonEmptyString(source.expired);
  if (!item.expiresAt && expired && Number.isFinite(Date.parse(expired))) {
    item.expiresAt = new Date(Date.parse(expired)).toISOString();
  }
  // Without an explicit expiry, use the access token's own `exp` (then the
  // ID token's) so an import does not look expired and refresh at once.
  if (!item.expiresAt && item.expiresIn === undefined) {
    const derived = jwtExpiryIso(item.accessToken) ?? jwtExpiryIso(item.idToken);
    if (derived) item.expiresAt = derived;
  }

  const accountId = nonEmptyString(source.account_id);
  if (accountId) {
    const psd = isObject(item.providerSpecificData) ? item.providerSpecificData : {};
    if (!psd.chatgptAccountId) {
      item.providerSpecificData = { ...psd, chatgptAccountId: accountId };
    }
  }

  for (const field of ENVELOPE_FIELDS) delete item[field];
  return item;
}
