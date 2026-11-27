/**
 * Staged Cursor import helpers (#2034). Not registered with any route yet.
 *
 * Source: OmniRoute b15b2ee6ac0f57af254be4a3cc60ba8a6cc9a523 (MIT),
 * src/lib/cursor/tokenExtractor.ts (REFRESH_TOKEN_KEYS),
 * src/app/api/oauth/cursor/import/route.ts (optional refresh token) and
 * src/lib/oauth/services/persistCursorConnection.ts (account-ID match).
 *
 * Web-safe: no Node built-ins, no network, no storage. Callers pass an open
 * state.vscdb handle and the connection list they already hold.
 */
import { isString } from "../../../../shared/utils/typeChecks.js";

export const CURSOR_REFRESH_TOKEN_KEYS = Object.freeze(["cursorAuth/refreshToken"]);
const MAX_REFRESH_TOKEN_LENGTH = 16 * 1024;

/** Accept a pasted or stored refresh token, or return null. */
export function normalizeCursorImportRefreshToken(value) {
  if (!isString(value)) return null;
  let token = value.trim();
  try {
    const parsed = JSON.parse(token);
    if (isString(parsed)) token = parsed.trim();
  } catch { /* plain value */ }
  if (!token || token.length > MAX_REFRESH_TOKEN_LENGTH || /\s/.test(token)) return null;
  return token;
}

/** Exact-key read only: a renamed key is never guessed for a refresh credential. */
export function readCursorRefreshTokenFromDb(db) {
  const placeholders = CURSOR_REFRESH_TOKEN_KEYS.map(() => "?").join(",");
  try {
    const rows = db.prepare(`SELECT key, value FROM itemTable WHERE key IN (${placeholders})`).all(...CURSOR_REFRESH_TOKEN_KEYS);
    for (const key of CURSOR_REFRESH_TOKEN_KEYS) {
      const token = normalizeCursorImportRefreshToken(rows.find((row) => row?.key === key)?.value);
      if (token) return token;
    }
  } catch { /* unreadable or encrypted store */ }
  return null;
}

/** The existing Cursor connection for this account, matched by JWT subject. */
export function findCursorAccountConnection(connections, accountId) {
  if (!isString(accountId) || !accountId) return null;
  return (Array.isArray(connections) ? connections : []).find((connection) =>
    connection?.provider === "cursor" && connection.authType === "oauth" &&
    (connection.providerSpecificData?.accountId || connection.providerSpecificData?.userId) === accountId
  ) || null;
}

/**
 * Connection values for an import. `tokenData` comes from
 * CursorService.validateImportToken, `identity` from resolveIdentity.
 */
export function cursorImportConnectionValues({ tokenData, identity, refreshToken = null, now = Date.now() }) {
  const refresh = normalizeCursorImportRefreshToken(refreshToken);
  const userId = identity?.userId || null;
  return {
    accessToken: tokenData.accessToken,
    refreshToken: refresh,
    expiresAt: new Date(now + tokenData.expiresIn * 1000).toISOString(),
    email: identity?.email || null,
    name: identity?.name || null,
    providerSpecificData: {
      machineId: tokenData.machineId,
      authMethod: "imported",
      provider: "Imported",
      userId,
      accountId: userId,
      ...(identity?.email ? { cachedEmail: identity.email } : null)
    },
    testStatus: "active"
  };
}

export const CURSOR_IMPORT_REFRESH_FIELD = Object.freeze({
  name: "refreshToken",
  label: "Refresh Token (optional)",
  description: "From cursorAuth/refreshToken in state.vscdb; enables automatic refresh",
  type: "textarea",
  optional: true
});
