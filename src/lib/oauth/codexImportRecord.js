// Normalize one Codex bulk-import record to the camelCase connection shape.
//
// Besides DurinDoor's own camelCase export ({ accessToken, refreshToken, ... })
// this accepts the Codex CLI `~/.codex/auth.json` file, which nests snake_case
// OAuth fields under `tokens` ({ auth_mode, OPENAI_API_KEY, tokens: {
// id_token, access_token, refresh_token, account_id }, last_refresh }), and
// flat snake_case token exports that carry `expired` / `account_id`.
// Pure: no I/O. Returns a new object; the input is never mutated.
import { isObject, isString } from "../../shared/utils/typeChecks.js";

const SNAKE_TO_CAMEL = {
  access_token: "accessToken",
  refresh_token: "refreshToken",
  id_token: "idToken",
};

// Codex CLI envelope fields that are not connection data. OPENAI_API_KEY is a
// separate secret and must never be persisted as part of an OAuth connection.
const ENVELOPE_FIELDS = ["tokens", "auth_mode", "OPENAI_API_KEY", "last_refresh", "expired", "account_id"];

function nonEmptyString(value) {
  return isString(value) && value.trim() ? value.trim() : undefined;
}

export function normalizeCodexImportRecord(raw) {
  if (!raw || !isObject(raw) || Array.isArray(raw)) return raw;

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
