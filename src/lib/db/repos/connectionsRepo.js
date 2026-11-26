import { encryptConnectionSecret, decryptConnectionSecret } from "../helpers/connectionSecrets.js";
import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";
import { mergeProviderConnection } from "../helpers/mergeProviderMetadata.js";
import { extractCookieValue } from "../../../shared/utils/cookieValue.js";
import { hasConflictingCodexAccountIds, resolveCodexAccountId } from "open-sse/shared/codexAccountId.js";
import { providerCredentialBytesMatch, providerRefreshContextMatches } from "@/shared/utils/providerCredentialContext";
import { QUOTA_WRITE_LOCK_SQL } from "./quotaSql.js";
import { modelUpstreamUpdate } from "@/shared/utils/modelLockUpstream.js";
import { ACCOUNT_ERROR_MESSAGE_MAX_CHARS } from "open-sse/config/runtimeConfig.js";
import {
  advanceAntigravityGeneration,
  deleteAntigravityRotationRows,
  seedAntigravityLease,
} from "../../antigravity/leaseSql.js";
import { assertNoActiveQuotaReservationsForTargetSync } from "./quotaReservationsRepo.js";
import { resolveFallbackModelScope } from "open-sse/services/fallbackScope.js";
import { ORCAROUTER_ID, credentialHint } from "open-sse/providers/orcarouterCatalog.js";
import { QUOTA_MAX_CLOCK_SKEW_MS } from "@/shared/constants/quota";
import {
  isEncryptedBlob } from
"@/lib/crypto/columnCrypto.js";
import {
  decryptProviderSpecificData,
  encryptProviderSpecificData } from
"../helpers/providerSpecificDataSecrets.js";

import { isBoolean, isFunction, isNumber, isObject, isString } from "../../../shared/utils/typeChecks.js";
import { SENSITIVE_CONNECTION_FIELDS } from "../sensitiveConnectionFields.js";
import {
  connectionCredentialKeyIds,
  connectionHasCredential,
  connectionHasMultipleCredentials,
  credentialKeyId
} from "../../../shared/utils/credentialFingerprint.js";
import { codexRotationMismatch } from "open-sse/services/usage/codexCredentialBinding.js";

export { SENSITIVE_CONNECTION_FIELDS };

const OPTIONAL_FIELDS = [
"displayName", "email", "globalPriority", "defaultModel",
"accessToken", "refreshToken", "expiresAt", "tokenType",
"scope", "projectId", "apiKey", "managementApiKey", "testStatus", "firecrawlHeaders",
"lastTested", "lastError", "lastErrorAt", "rateLimitedUntil", "expiresIn", "errorCode",
"consecutiveUseCount", "idToken", "lastRefreshAt", "sessionToken"];

const MODEL_LOCK_PREFIX = "modelLock_";

/**
 * Normalize an explicitly successful connection check into a fresh routing
 * lifecycle. Persist caller-supplied soft warnings, but clear stale failures,
 * rate limits and backoff. A model lock still in force survives a passed test or
 * a token refresh (upstream #4389); a replaced credential clears every lock,
 * because the old one's failures say nothing about it. MiMo session token
 * replacement is also a credential replacement. A lock value in the
 * patch itself always wins.
 */
function resetHealthStateOnActivation(existing, patch, replacesCredential) {
  if (patch?.testStatus !== "active") return patch;

  const normalized = {
    ...patch,
    testStatus: "active",
    lastError: Object.hasOwn(patch, "lastError") ? patch.lastError : null,
    lastErrorAt: Object.hasOwn(patch, "lastErrorAt") ? patch.lastErrorAt : null,
    errorCode: null,
    rateLimitedUntil: null,
    backoffLevel: 0,
    // A successful activation is a new, working credential — clear any pending
    // reauthentication flag left by a previously rejected one.
    needsReauth: false,
    reauthReason: null,
    reauthAt: null
  };

  const mimoToken = patch.providerSpecificData?.mimoPassToken;
  const replaced = replacesCredential || Boolean(patch.apiKey) && patch.apiKey !== existing?.apiKey ||
    existing?.provider === "xiaomi-mimo" && Boolean(mimoToken) && mimoToken !== existing.providerSpecificData?.mimoPassToken;
  const now = Date.now();
  for (const [key, expiry] of Object.entries(existing || {})) {
    if (!key.startsWith(MODEL_LOCK_PREFIX)) continue;
    if (replaced) normalized[key] = null;else
    if (!Object.hasOwn(patch, key) && !(new Date(expiry).getTime() > now)) normalized[key] = null;
  }

  return normalized;
}

function mergeProviderConnectionWithHealthReset(existing, patch, { replacesCredential = false } = {}) {
  const normalized = resetHealthStateOnActivation(existing, patch, replacesCredential);
  const merged = mergeProviderConnection(existing, normalized);
  if (existing.provider === "codex" && merged.providerSpecificData &&
      Object.hasOwn(merged.providerSpecificData, "codexRefreshAttempt")) {
    merged.providerSpecificData = { ...merged.providerSpecificData };
    const attempt = existing.providerSpecificData?.codexRefreshAttempt;
    if (merged.refreshToken === existing.refreshToken && attempt) {
      merged.providerSpecificData.codexRefreshAttempt = attempt;
    } else {
      delete merged.providerSpecificData.codexRefreshAttempt;
    }
  }
  if (normalized?.testStatus === "active") {
    merged.testStatus = "active";
    merged.lastError = normalized.lastError;
    merged.lastErrorAt = normalized.lastErrorAt;
  }
  return merged;
}

/**
 * Durable reauth outranks ordinary cooldowns. Either marker pins the account
 * until an explicit credential replacement writes testStatus:"active".
 */
function isDurableReauthPinned(connection) {
  return connection?.testStatus === "reauth_required" || connection?.errorCode === "REAUTH";
}


const AUTO_PING_SETTINGS_KEYS = {
  claude: "claudeAutoPing",
  codex: "codexAutoPing"
};

// `enabled`: undefined keeps the reactive flag. `schedule`: undefined keeps the
// stored schedule, null removes it, an object replaces it. Disabling a
// connection (enabled false, schedule null) clears both.
function updateAutoPingEntryInTx(db, provider, connectionId, enabled, schedule = undefined) {
  const settingsKey = AUTO_PING_SETTINGS_KEYS[provider];
  if (!settingsKey) return null;
  const row = db.get(`SELECT data FROM settings WHERE id = 1`);
  const current = row ? parseJson(row.data, {}) : {};
  const currentConfig = current[settingsKey] || {};
  const connections = { ...(currentConfig.connections || {}) };
  if (enabled === true) connections[connectionId] = true;else
  if (enabled === false) delete connections[connectionId];
  const schedules = { ...(currentConfig.schedules || {}) };
  if (schedule) schedules[connectionId] = schedule;else
  if (schedule === null) delete schedules[connectionId];
  const config = { ...currentConfig, connections, schedules };
  db.run(
    `INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
    [stringifyJson({ ...current, [settingsKey]: config })]
  );
  return { settingsKey, config };
}

function rowToConn(row) {
  if (!row) return null;
  const extra = parseJson(row.data, {});
  // Version 2 binds each secret to its connection and field. Legacy blobs
  // and pre-migration plaintext remain readable.
  for (const field of SENSITIVE_CONNECTION_FIELDS) {
    const value = extra[field];
    if (isEncryptedBlob(value)) {
      try { extra[field] = decryptConnectionSecret(value, row.id, field); } catch {
        console.warn(`Unable to decrypt connection credential ${field} for ${row.id}`);
        extra[field] = null;
        extra.testStatus = "error";
      }
    }
  }
  if (extra.providerSpecificData) {
    extra.providerSpecificData = decryptProviderSpecificData(extra.providerSpecificData, row.id);
  }
  return {
    ...extra,
    id: row.id,
    provider: row.provider,
    authType: row.authType,
    name: row.name,
    email: row.email,
    priority: row.priority,
    isActive: row.isActive === 1 || row.isActive === true,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function connToRow(c) {
  const { id, provider, authType, name, email, priority, isActive, createdAt, updatedAt, ...rest } = c;
  // Management credentials are top-level encrypted fields, never metadata.
  // Discard nested copies rather than silently promoting untrusted metadata.
  if (rest.providerSpecificData && Object.hasOwn(rest.providerSpecificData, "managementApiKey")) {
    rest.providerSpecificData = { ...rest.providerSpecificData };
    delete rest.providerSpecificData.managementApiKey;
  }
  // Derive (not inherit) the redacted handle on every write, so replacing a
  // connection's key can never leave a hint describing the previous secret.
  // Runs before encryption, which is the only point the plaintext is still here.
  if (provider === ORCAROUTER_ID) {
    const secret = rest.accessToken || rest.apiKey;
    // An already-encrypted blob is not the secret, so a hint derived from it
    // would be meaningless; leave whatever hint the row already carries.
    if (!isEncryptedBlob(secret)) {
      const hint = credentialHint(secret);
      if (hint) rest.keyHint = hint;
      else delete rest.keyHint;
    }
  }
  // Encrypt the four sensitive fields if present. Already-encrypted blobs
  // pass through so re-writes from rowToConn don't double-encrypt.
  for (const field of SENSITIVE_CONNECTION_FIELDS) {
    const value = rest[field];
    if (isString(value) && value.length > 0 && !isEncryptedBlob(value)) {
      rest[field] = encryptConnectionSecret(value, id, field);
    }
  }
  if (rest.providerSpecificData) {
    rest.providerSpecificData = encryptProviderSpecificData(rest.providerSpecificData, id);
  }
  return {
    id,
    provider,
    authType,
    name: name ?? null,
    email: email ?? null,
    priority: priority ?? null,
    isActive: isActive === false ? 0 : 1,
    data: stringifyJson(rest),
    createdAt,
    updatedAt
  };
}

function upsert(db, c) {
  const r = connToRow(c);
  db.run(
    `INSERT INTO providerConnections(id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       provider=excluded.provider, authType=excluded.authType, name=excluded.name,
       email=excluded.email, priority=excluded.priority, isActive=excluded.isActive,
       data=excluded.data, updatedAt=excluded.updatedAt`,
    [r.id, r.provider, r.authType, r.name, r.email, r.priority, r.isActive, r.data, r.createdAt, r.updatedAt]
  );
}

// Keep private ChatGPT plan sessions out of the enumerable provider connection inventory.
const CHATGPT_PLAN_SCOPE = "privateChatGptPlanAccounts";

async function getChatGptPlanAdapter() {
  const db = await getAdapter();
  // sql.js writes a private, asynchronously flushed snapshot in each process.
  if (db.driver === "sql.js") throw new Error("ChatGPT plan accounts require a shared transactional database");
  return db;
}

function readChatGptPlanAccount(db, id) {
  const row = db.get("SELECT value FROM kv WHERE scope = ? AND key = ?", [CHATGPT_PLAN_SCOPE, id]);
  return row ? rowToConn(JSON.parse(row.value)) : null;
}

export async function readPrivateChatGptPlanAccount(id) {
  return readChatGptPlanAccount(await getChatGptPlanAdapter(), id);
}

// Use the same pre-read writer lock as claimProviderConnectionPing. A revision
// also fences sign-out, reauthorization and session handoff with identical bytes.
export async function compareAndSwapPrivateChatGptPlanAccount(id, expected, next) {
  const db = await getChatGptPlanAdapter();
  let applied = false;
  db.transaction(() => {
    const lock = db.run(QUOTA_WRITE_LOCK_SQL);
    if ((lock.changes || 0) !== 1) throw new Error("ChatGPT plan accounts require an initialized schema");
    const current = readChatGptPlanAccount(db, id);
    if ((current?.revision ?? null) !== (expected?.revision ?? null) ||
        !providerCredentialBytesMatch(current, expected)) return;
    db.run(
      `INSERT INTO kv(scope, key, value) VALUES(?, ?, ?)
       ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value`,
      [CHATGPT_PLAN_SCOPE, id, stringifyJson(connToRow(next))]
    );
    applied = true;
  });
  return applied;
}

// The verified selection can only be installed by the private enrollment flow.
// Read and compare it under the same writer lock used by connection updates.
export async function compareAndSwapChatGptPlanSelection(id, expected, selection, shouldCommit = () => true) {
  const db = await getChatGptPlanAdapter();
  let applied = false;
  db.transaction(() => {
    const lock = db.run(QUOTA_WRITE_LOCK_SQL);
    if ((lock.changes || 0) !== 1) throw new Error("Connection binding requires an initialized schema");
    const current = rowToConn(db.get("SELECT * FROM providerConnections WHERE id = ?", [id]));
    if (!current || current.provider !== "chatgpt-plan" || current.authType !== "oauth" ||
        JSON.stringify(current) !== expected.snapshot ||
        JSON.stringify(current.providerSpecificData?.chatgptPlanAccount ?? null) !== JSON.stringify(expected.selection ?? null) ||
        !shouldCommit()) return;
    upsert(db, { ...current, updatedAt: new Date().toISOString(), providerSpecificData: {
      ...current.providerSpecificData, chatgptPlanAccount: selection, chatgptPlanBindingRevision: uuidv4(),
    } });
    applied = true;
  });
  return applied;
}

/**
 * Derive a human-readable connection name from provider identity data.
 *
 * For GitHub (Copilot) OAuth, prefer the stable account identity over a generic
 * "Account N" fallback so multiple accounts on the same machine stay
 * distinguishable: login → email → top-level email → display name → fallback.
 * Other providers keep the caller-supplied fallback unchanged.
 *
 * @param {object} data - Incoming connection payload (provider, email, providerSpecificData).
 * @param {string} fallbackName - Caller-provided default (e.g. `Account ${n}`).
 * @returns {string} Resolved connection name.
 */
function deriveConnectionName(data, fallbackName) {
  if (data.provider === "github") {
    return data.providerSpecificData?.githubLogin ||
    data.providerSpecificData?.githubEmail ||
    data.email ||
    data.providerSpecificData?.githubName ||
    fallbackName;
  }
  return fallbackName;
}

// A returning Codex OAuth identity starts the same fresh active lifecycle as
// every successful explicit validation. Null/empty tokens remain protected and
// providerSpecificData remains deep-merged by the shared merge helper.
function mergeCodexReauthorization(existing, data, now) {
  const merged = mergeProviderConnectionWithHealthReset(existing, {
    ...data,
    isActive: true,
    testStatus: "active"
  }, { replacesCredential: true });
  return { ...merged, updatedAt: now };
}

export async function getProviderConnections(filter = {}) {
  const db = await getAdapter();
  const where = [];
  const params = [];
  if (filter.provider) {where.push("provider = ?");params.push(filter.provider);}
  if (filter.isActive !== undefined) {where.push("isActive = ?");params.push(filter.isActive ? 1 : 0);}
  const sql = `SELECT * FROM providerConnections${where.length ? ` WHERE ${where.join(" AND ")}` : ""}`;
  const rows = db.all(sql, params);
  const list = rows.map(rowToConn);
  list.sort((a, b) => (a.priority || 999) - (b.priority || 999));
  return list;
}

export async function getProviderConnectionById(id) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM providerConnections WHERE id = ?`, [id]);
  return rowToConn(row);
}

/**
 * Claim a Codex grant before dispatch. The claim survives response loss and
 * process exit, and credential persistence clears it when the grant changes.
 */
export async function claimCodexRefreshAttempt(id, refreshToken, fingerprint) {
  const db = await getAdapter();
  let claimed = false;
  db.transaction(() => {
    const lock = db.run(QUOTA_WRITE_LOCK_SQL);
    if ((lock.changes || 0) !== 1) throw new Error("Codex refresh claim requires an initialized schema");
    const existing = rowToConn(db.get("SELECT * FROM providerConnections WHERE id = ?", [id]));
    if (existing?.provider !== "codex" || existing.refreshToken !== refreshToken ||
        existing.providerSpecificData?.codexRefreshAttempt === fingerprint) return;
    upsert(db, {
      ...existing,
      providerSpecificData: { ...existing.providerSpecificData, codexRefreshAttempt: fingerprint }
    });
    claimed = true;
  });
  return claimed;
}

// Internal sync reorder — must be called INSIDE a transaction
function reorderInTx(db, providerId) {
  const list = db.all(`SELECT * FROM providerConnections WHERE provider = ?`, [providerId]).map(rowToConn);
  list.sort((a, b) => {
    const pDiff = (a.priority || 0) - (b.priority || 0);
    if (pDiff !== 0) return pDiff;
    return new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0);
  });
  list.forEach((c, i) => {
    db.run(`UPDATE providerConnections SET priority = ? WHERE id = ?`, [i + 1, c.id]);
  });
}

/**
 * iFlow cookie reimports reuse the row for the same normalized BXAuth session,
 * not its display name or refreshed API key. Distinct sessions stay separate.
 */
export async function createProviderConnection(data, { shouldCommit, requireNewName, createOnly = false, requireNewCookieName = false } = {}) {
  const db = await getAdapter();
  // OAuth flows can be cancelled while an upstream exchange is in flight.
  // Check after the async adapter lookup and immediately before the synchronous
  // transaction so a superseded flow cannot persist a late credential.
  if (isFunction(shouldCommit) && !shouldCommit()) {
    throw new Error("OAuth flow was cancelled or superseded before commit");
  }
  const now = new Date().toISOString();
  let result;

  db.transaction(() => {
    if (requireNewCookieName && data.authType === "cookie" && data.name) {
      // Serialize the read and insert across database connections as well as
      // within this process, using the shared provider-connection write lock.
      const lock = db.run(QUOTA_WRITE_LOCK_SQL);
      if ((lock.changes || 0) !== 1) throw new Error("Cookie connection creation requires an initialized schema");
    }
    const all = db.all(`SELECT * FROM providerConnections WHERE provider = ?`, [data.provider]).map(rowToConn);

    // Cookie imports create a new named target; check within the same transaction
    // as the insert so concurrent pairings cannot create duplicate targets.
    if (requireNewCookieName && data.authType === "cookie" && data.name &&
        all.some((c) => c.authType === "cookie" && c.name === data.name)) {
      const error = new Error("A cookie connection with this name already exists for this provider");
      error.code = "PROVIDER_CONNECTION_ALREADY_EXISTS";
      throw error;
    }

    let existing = null;
    // Microsoft 365 sign-ins are the same account only for the same tenant/object identity: two
    // tenants can share an email, and a sign-in without an email claim must still merge.
    if (data.authType === "oauth" && data.provider === "copilot-m365-web" && data.providerSpecificData?.chathubPath) {
      existing = all.find((c) => c.authType === "oauth" &&
      c.providerSpecificData?.chathubPath === data.providerSpecificData.chathubPath) || null;
    }
    if (!existing && data.authType === "oauth" && data.email && data.provider !== "copilot-m365-web") {
      const incomingUsername = data.providerSpecificData?.username;
      const incomingWs = data.providerSpecificData?.chatgptAccountId;
      existing = all.find((c) => {
        if (c.authType !== "oauth" || c.email !== data.email) return false;
        // Codex/OpenAI can issue multiple OAuth grants for the same email.
        // Refresh tokens are rotated single-use; collapsing a new login onto an
        // existing bare-email row overwrites the first account's token pair and
        // makes it look "invalid" after adding a second account. Only update an
        // existing Codex row when both rows expose the same resolved account ID.
        if (data.provider === "codex") {
          if (hasConflictingCodexAccountIds(data.providerSpecificData) ||
          hasConflictingCodexAccountIds(c.providerSpecificData)) return false;
          const incomingId = resolveCodexAccountId(data.providerSpecificData);
          const existingId = resolveCodexAccountId(c.providerSpecificData);
          return !!incomingId && !!existingId && incomingId === existingId;
        }

        // Claude personal and Team accounts can share the same email (a user
        // can be a member of a Team org under the same login). Only collapse
        // them when both sides resolve to the same organization; missing
        // org uuid on either side falls through to the bare-email match below.
        if (data.provider === "claude") {
          const incomingOrgUuid = data.providerSpecificData?.claudeOrgUuid;
          const existingOrgUuid = c.providerSpecificData?.claudeOrgUuid;
          if (incomingOrgUuid && existingOrgUuid) return incomingOrgUuid === existingOrgUuid;
        }

        // Workspace providers use workspace ID when both sides have it
        const existingWs = c.providerSpecificData?.chatgptAccountId;
        if (incomingWs && existingWs) return incomingWs === existingWs;
        if (incomingWs && !existingWs) return false;
        if (!incomingWs && existingWs) return false;
        // Non-workspace providers: match on (email + username) so cross-IdP
        // accounts don't overwrite each other. Require username on both sides
        // — if only one side has it, treat as a distinct identity rather than
        // collapsing onto the bare-email fallback (which would re-introduce
        // the cross-IdP overwrite).
        const existingUsername = c.providerSpecificData?.username;
        if (incomingUsername && existingUsername) {
          return incomingUsername === existingUsername;
        }
        if (incomingUsername || existingUsername) return false;
        return true;
      });
    }
    if (!existing && data.provider === "iflow" && data.authType === "cookie") {
      const session = extractCookieValue(data.providerSpecificData?.cookie, "BXAuth");
      if (session) {
        existing = all.find((c) => c.authType === "cookie" &&
          extractCookieValue(c.providerSpecificData?.cookie, "BXAuth") === session);
      }
    }
    const isKeyLikeAuth = data.authType === "apikey" || data.authType === "auth_token";
    if (!existing && data.provider === "cursor" && data.providerSpecificData?.userId) {
      existing = all.find(
        (c) => c.providerSpecificData?.userId === data.providerSpecificData.userId
      );
    } else if (isKeyLikeAuth && data.name) {
      existing = all.find((c) => c.authType === data.authType && c.name === data.name);
    }
    // access_token: never dedup — user manages duplicates manually

    // Bulk add must never overwrite an existing key. When the caller flags a
    // create-only insert (requireNewName), a name collision is a hard error
    // instead of the default upsert — the UI planner assigns collision-free
    // names, and this guard catches any stale/concurrent state that slips past
    // it. Thrown inside the transaction so nothing is persisted.
    if (existing && requireNewName && isKeyLikeAuth) {
      const label = data.authType === "auth_token" ? "An auth token" : "An API key";
      const err = new Error(`${label} named "${data.name}" already exists for this provider`);
      err.code = "PROVIDER_CONNECTION_NAME_CONFLICT";
      throw err;
    }

    if (existing) {
      // #6499 — create-only (dashboard "add API key"): a duplicate (provider,
      // apikey|auth_token, name) must error, never silently upsert/overwrite. The explicit
      // update path is updateProviderConnection (PUT /api/providers/[id]).
      if (createOnly && isKeyLikeAuth) {
        const error = new Error(`A connection named "${data.name}" already exists for this provider`);
        error.code = "PROVIDER_CONNECTION_ALREADY_EXISTS";
        throw error;
      }
      const merged = data.provider === "codex" && data.authType === "oauth" && data.accessToken ?
      mergeCodexReauthorization(existing, data, now) :
      { ...mergeProviderConnectionWithHealthReset(existing, data, { replacesCredential: true }), updatedAt: now };
      upsert(db, merged);
      if ((merged.provider === "antigravity" || merged.provider === "agy") && isString(data.refreshToken) && data.refreshToken && data.refreshToken !== existing.refreshToken) {
        advanceAntigravityGeneration(db, merged.id, data.refreshToken, data.providerSpecificData?.antigravitySubject || null);
      }
      result = merged;
      return;
    }

    let connectionName = data.name || null;
    if (!connectionName && (data.authType === "oauth" || data.authType === "access_token")) {
      connectionName = deriveConnectionName(data, data.email || `Account ${all.length + 1}`);
    }
    let connectionPriority = data.priority;
    if (!connectionPriority) {
      connectionPriority = all.reduce((m, c) => Math.max(m, c.priority || 0), 0) + 1;
    }

    const conn = {
      id: uuidv4(),
      provider: data.provider,
      authType: data.authType || "oauth",
      name: connectionName,
      priority: connectionPriority,
      isActive: data.isActive !== undefined ? data.isActive : true,
      createdAt: now,
      updatedAt: now
    };
    for (const f of OPTIONAL_FIELDS) {
      if (data[f] !== undefined && data[f] !== null) conn[f] = data[f];
    }
    if (data.providerSpecificData && Object.keys(data.providerSpecificData).length > 0) {
      conn.providerSpecificData = data.providerSpecificData;
    }
    if (data.email !== undefined) conn.email = data.email;

    upsert(db, conn);
    if (conn.provider === "antigravity" || conn.provider === "agy") {
      seedAntigravityLease(db, conn.id, conn.refreshToken, conn.providerSpecificData?.antigravitySubject || null);
    }
    reorderInTx(db, data.provider);
    result = conn;
  });

  return result;
}

// Critical: OAuth refresh token race — atomic merge inside transaction
export function applyProviderConnectionPatchInTx(db, id, data, {
  expectedUpdatedAt = null,
  expectedRefreshContext = null,
  returnCommitResult = false,
  signal = null,
  shouldCommit = null,
  shouldCommitConnection = null,
  // Compatibility fallback writer (#1324/#1311): re-read under the write lock
  // and refuse demoting a concurrent durable reauth marker.
  refuseIfReauth = false,
  // The patch carries a new sign-in or import, not a refresh of the stored one.
  replacesCredential = false,
  // The patch carries rotated tokens from a refresh grant. Implied by
  // expectedRefreshContext.
  refreshRotation = false,
  antigravityLeaseCommit = false,
  advanceAntigravityGeneration: shouldAdvanceAntigravityGeneration = false
} = {}) {
  let result;
  db.transaction(() => {
    if (signal?.aborted) throw new DOMException("Provider connection update aborted", "AbortError");
    if (isFunction(shouldCommit) && !shouldCommit()) {
      const error = new Error("Provider connection update superseded");
      error.code = "PROVIDER_CONNECTION_UPDATE_SUPERSEDED";
      throw error;
    }
    // Acquire SQLite's writer lock before reading the compare-and-swap state.
    // In WAL mode a deferred read snapshot cannot otherwise be upgraded after
    // another process commits a competing token rotation.
    const lock = db.run(QUOTA_WRITE_LOCK_SQL);
    if ((lock.changes || 0) !== 1) throw new Error("Provider credential update requires an initialized schema");
    const row = db.get(`SELECT * FROM providerConnections WHERE id = ?`, [id]);
    if (!row) {result = null;return;}
    const existing = rowToConn(row);
    if (signal?.aborted) throw new DOMException("Provider connection update aborted", "AbortError");
    if (isFunction(shouldCommitConnection) && !shouldCommitConnection(existing)) {
      result = returnCommitResult ? { applied: false, connection: existing } : existing;
      return;
    }
    if (expectedUpdatedAt && existing.updatedAt !== expectedUpdatedAt) {
      const error = new Error("Provider connection changed during credential refresh");
      error.code = "PROVIDER_CONNECTION_REVISION_CONFLICT";
      throw error;
    }
    if (!providerRefreshContextMatches(existing, expectedRefreshContext)) {
      result = returnCommitResult ? { applied: false, connection: existing } : existing;
      return;
    }
    if (refuseIfReauth && isDurableReauthPinned(existing)) {
      result = returnCommitResult ? { applied: false, connection: existing } : existing;
      return;
    }
    // A refresh must never move a Codex connection to another ChatGPT identity.
    const identityMismatch = !replacesCredential && (refreshRotation || expectedRefreshContext) &&
      codexRotationMismatch(existing, data);
    if (identityMismatch) {
      console.warn(`[TOKEN_REFRESH] Rejected Codex OAuth identity change during token rotation: ${identityMismatch}`);
      result = returnCommitResult ? { applied: false, connection: existing } : existing;
      return;
    }
    if (Object.hasOwn(data, "provider") && data.provider !== existing.provider) {
      const error = new Error("A provider connection cannot change provider identity in place");
      error.code = "PROVIDER_IDENTITY_IMMUTABLE";
      throw error;
    }
    const merged = { ...mergeProviderConnectionWithHealthReset(existing, data, { replacesCredential }), updatedAt: new Date().toISOString() };
    const selectedWorkspace = existing.provider === "codex" && existing.providerSpecificData?.codexSelectedWorkspaceId;
    if (selectedWorkspace && (
      merged.providerSpecificData?.codexSelectedWorkspaceId !== selectedWorkspace ||
      hasConflictingCodexAccountIds(merged.providerSpecificData) ||
      resolveCodexAccountId(merged.providerSpecificData, merged.idToken) !== selectedWorkspace ||
      (data.idToken && resolveCodexAccountId({}, data.idToken) !== selectedWorkspace)
    )) {
      const error = new Error("Codex connection workspace cannot be changed");
      error.code = "PROVIDER_IDENTITY_IMMUTABLE";
      throw error;
    }
    upsert(db, merged);
    if (!antigravityLeaseCommit && (existing.provider === "antigravity" || existing.provider === "agy")) {
      const nextRefresh = isString(data.refreshToken) && data.refreshToken ? data.refreshToken : null;
      const subject = data.providerSpecificData?.antigravitySubject || existing.providerSpecificData?.antigravitySubject || null;
      if (shouldAdvanceAntigravityGeneration || (nextRefresh && nextRefresh !== existing.refreshToken)) {
        advanceAntigravityGeneration(db, id, nextRefresh || existing.refreshToken, subject);
      }
    }
    if (data.isActive === false) updateAutoPingEntryInTx(db, existing.provider, id, false, null);
    if (data.priority !== undefined) reorderInTx(db, existing.provider);
    result = returnCommitResult ? { applied: true, connection: merged } : merged;
  });
  return result;
}

export async function updateProviderConnection(id, data, options = {}) {
  const db = await getAdapter();
  return applyProviderConnectionPatchInTx(db, id, data, options);
}

// Atomic compare-and-set on ping markers so two processes cannot both send the
// same scheduled/reactive ping. Applies `next` only when every `expected` field
// still matches (missing counts as null). Returns true when claimed.
export async function claimProviderConnectionPing(id, expected, next) {
  const db = await getAdapter();
  let claimed = false;
  db.transaction(() => {
    const lock = db.run(QUOTA_WRITE_LOCK_SQL);
    if ((lock.changes || 0) !== 1) throw new Error("Provider ping claim requires an initialized schema");
    const row = db.get(`SELECT * FROM providerConnections WHERE id = ?`, [id]);
    if (!row) return;
    const existing = rowToConn(row);
    if (Object.entries(expected).some(([field, value]) => (existing[field] ?? null) !== (value ?? null))) return;
    upsert(db, { ...existing, ...next });
    claimed = true;
  });
  return claimed;
}

// Compare-and-swap on providerSpecificData fields (OmniRoute #20403). Under the
// writer lock, applies `next` (merged into providerSpecificData) only when every
// `expected` psd field still holds the given value (missing counts as null).
// Used for single-use rotating refresh tokens kept in providerSpecificData.
export async function compareAndSwapProviderSpecificData(id, expected, next) {
  const db = await getAdapter();
  let outcome = { applied: false, current: null };
  db.transaction(() => {
    const lock = db.run(QUOTA_WRITE_LOCK_SQL);
    if ((lock.changes || 0) !== 1) throw new Error("Provider data swap requires an initialized schema");
    const row = db.get(`SELECT * FROM providerConnections WHERE id = ?`, [id]);
    if (!row) return;
    const existing = rowToConn(row);
    const psd = isObject(existing.providerSpecificData) && existing.providerSpecificData !== null ? existing.providerSpecificData : {};
    outcome = { applied: false, current: existing };
    if (Object.entries(expected).some(([field, value]) => (psd[field] ?? null) !== (value ?? null))) return;
    const merged = { ...existing, providerSpecificData: { ...psd, ...next }, updatedAt: new Date().toISOString() };
    upsert(db, merged);
    outcome = { applied: true, current: merged };
  });
  return outcome;
}

const MODEL_STATE_VERSION_PREFIX = "modelStateObserved_";

function boundedModelScope(provider, model, options) {
  return resolveFallbackModelScope(provider, model, options) || "__all";
}

function eventTimestamp(value, now = Date.now()) {
  const parsed = isNumber(value) ? value : Date.parse(value || "");
  const clock = Number(now);
  if (
  !Number.isSafeInteger(parsed) ||
  parsed <= 0 ||
  !Number.isFinite(clock) ||
  parsed > clock + QUOTA_MAX_CLOCK_SKEW_MS)
  throw new TypeError("Provider fallback event timestamp is invalid");
  return parsed;
}

function activeTimestamp(value, now) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) && parsed > now ? parsed : null;
}

/**
 * Per-key health for multi-key connections (#20993). Applies one key's verdict
 * to the map read inside the write transaction, so concurrent outcomes for
 * different keys both survive. Entries for keys no longer stored are pruned.
 * A failure stamped in the same millisecond as a stored verdict wins; a
 * success needs a strictly newer stamp.
 */
function credentialHealthDelta(existing, fingerprint, { healthy, eventMs, status = null }) {
  const keyId = credentialKeyId(fingerprint);
  if (!keyId || !connectionHasMultipleCredentials(existing)) return null;
  const live = connectionCredentialKeyIds(existing);
  const current = isObject(existing.credentialHealth) ? existing.credentialHealth : {};
  const pruned = Object.fromEntries(Object.entries(current).filter(([id]) => live.has(id)));
  const previousAt = Date.parse(pruned[keyId]?.observedAt || "") || 0;
  if (healthy ? eventMs <= previousAt : eventMs < previousAt) return null;
  const observedAt = new Date(eventMs).toISOString();
  return {
    ...pruned,
    [keyId]: healthy ?
      { status: "healthy", observedAt } :
      { status: "unavailable", observedAt, statusCode: Number(status) || null }
  };
}

/**
 * Atomically extend one legacy model lock. The attempt-start watermark fences
 * late completions and the max-expiry merge prevents concurrent 429s from
 * shortening an already accepted cooldown.
 */
export async function recordProviderConnectionFallbackState(id, {
  model = null,
  status,
  reasonCode = "provider_error",
  reason = null,
  cooldownMs,
  backoffLevel = 0,
  observedAt,
  credentialFingerprint = null,
  webFetch = false,
  webSearch = false,
  videoPoll = false
} = {}, { signal = null, now = Date.now() } = {}) {
  const eventMs = eventTimestamp(observedAt, now);
  if (!Number.isSafeInteger(cooldownMs) || cooldownMs < 0 || cooldownMs > 7 * 24 * 60 * 60 * 1000) {
    throw new TypeError("Provider fallback cooldown is invalid");
  }
  const safeReasons = {
    rate_limited: "Rate limited",
    authentication_error: "Authentication failed",
    provider_error: "Provider unavailable",
    network_error: "Provider network error"
  };
  // Caller-supplied diagnostics must already be secret-safe; this persistence
  // boundary accepts only the bounded single-line shape produced by
  // describeProviderError and otherwise falls back to the fixed reason code.
  const validatedReason = isString(reason) && reason.trim() === reason && reason.length > 0 && reason.length <= ACCOUNT_ERROR_MESSAGE_MAX_CHARS && !/[\r\n]/.test(reason) ? reason : null;
  const storedReason = reasonCode === "rate_limited" ? safeReasons.rate_limited : validatedReason || safeReasons[reasonCode] || safeReasons.provider_error;
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    if (signal?.aborted) throw new DOMException("Provider fallback update aborted", "AbortError");
    const lock = db.run(QUOTA_WRITE_LOCK_SQL);
    if ((lock.changes || 0) !== 1) throw new Error("Provider fallback update requires an initialized schema");
    const row = db.get(`SELECT * FROM providerConnections WHERE id = ?`, [id]);
    if (!row) return;
    const existing = rowToConn(row);
    if (!connectionHasCredential(existing, credentialFingerprint)) {
      result = { applied: false, connection: existing };
      return;
    }
    // Auth may have read this account before a concurrent terminal failure.
    // Recheck under the write transaction: ordinary cooldowns cannot demote
    // durable reauth or erase the marker that guards later success clearing.
    if (isDurableReauthPinned(existing)) {
      result = { applied: false, connection: existing };
      return;
    }
    const scope = boundedModelScope(existing.provider, model, { webFetch, webSearch, videoPoll });
    const lockKey = `${MODEL_LOCK_PREFIX}${scope}`;
    const versionKey = `${MODEL_STATE_VERSION_PREFIX}${scope}`;
    const storedVersion = Date.parse(existing[versionKey] || "") || 0;
    const credentialHealth = credentialHealthDelta(existing, credentialFingerprint, { healthy: false, eventMs, status });
    // Connection scope keeps the R-02 contract (equal stamps lose); the
    // per-key verdict above lets a same-millisecond failure win.
    if (eventMs <= storedVersion) {
      if (credentialHealth) {
        const keyOnly = { ...existing, credentialHealth, updatedAt: existing.updatedAt };
        upsert(db, keyOnly);
        result = { applied: false, keyHealthApplied: true, connection: keyOnly };
        return;
      }
      result = { applied: false, connection: existing };
      return;
    }
    const proposedExpiry = eventMs + cooldownMs;
    const storedExpiry = Date.parse(existing[lockKey] || "") || 0;
    const expiry = Math.max(proposedExpiry, storedExpiry);
    const merged = {
      ...existing,
      [lockKey]: new Date(expiry).toISOString(),
      [versionKey]: new Date(eventMs).toISOString(),
      // Runtime health is not a credential revision. Keeping updatedAt stable
      // prevents successful/failing traffic from invalidating quota fetch
      // dedupe and OAuth compare-and-swap keys.
      updatedAt: existing.updatedAt
    };
    if (credentialHealth) merged.credentialHealth = credentialHealth;
    if (webSearch && scope.startsWith("websearch:")) {
      merged[`modelError_${scope}`] = Number(status) || 503;
    }
    if (!webFetch && !webSearch) {
      Object.assign(merged, modelUpstreamUpdate(scope, { status, message: storedReason, lockUntil: merged[lockKey] }));
      merged.testStatus = "unavailable";
      merged.lastError = storedReason;
      merged.errorCode = Number(status) || null;
      merged.lastErrorAt = new Date(eventMs).toISOString();
      merged.backoffLevel = Math.max(Number(existing.backoffLevel) || 0, Number(backoffLevel) || 0);
    }
    upsert(db, merged);
    result = { applied: true, connection: merged };
  });
  return result;
}

/**
 * Clear compatible legacy health state after a fully completed request. A
 * newer attempt watermark always wins, so a late old success cannot erase a
 * newer 429/auth failure.
 */
export async function clearProviderConnectionFallbackState(id, {
  model = null,
  observedAt,
  credentialFingerprint = null,
  webFetch = false,
  webSearch = false
} = {}, { signal = null, now = Date.now() } = {}) {
  const eventMs = eventTimestamp(observedAt, now);
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    if (signal?.aborted) throw new DOMException("Provider fallback clear aborted", "AbortError");
    const lock = db.run(QUOTA_WRITE_LOCK_SQL);
    if ((lock.changes || 0) !== 1) throw new Error("Provider fallback clear requires an initialized schema");
    const row = db.get(`SELECT * FROM providerConnections WHERE id = ?`, [id]);
    if (!row) return;
    const existing = rowToConn(row);
    if (!connectionHasCredential(existing, credentialFingerprint)) {
      result = { applied: false, connection: existing };
      return;
    }
    const scope = boundedModelScope(existing.provider, model, { webFetch, webSearch });
    const relevantScopes = webFetch || webSearch || scope === "__all" ? [scope] : [scope, "__all"];
    const primaryVersion = Date.parse(existing[`${MODEL_STATE_VERSION_PREFIX}${scope}`] || "") || 0;
    const credentialHealth = credentialHealthDelta(existing, credentialFingerprint, { healthy: true, eventMs });
    const rejectKeepingKeyHealth = () => {
      if (!credentialHealth) {
        result = { applied: false, connection: existing };
        return;
      }
      const keyOnly = { ...existing, credentialHealth, updatedAt: existing.updatedAt };
      upsert(db, keyOnly);
      result = { applied: false, keyHealthApplied: true, connection: keyOnly };
    };
    // A success stamped in the same millisecond as a failure never clears it.
    if (eventMs <= primaryVersion) return rejectKeepingKeyHealth();
    const scopes = relevantScopes;
    const acceptedScopes = scopes.filter((candidate) => {
      const version = Date.parse(existing[`${MODEL_STATE_VERSION_PREFIX}${candidate}`] || "") || 0;
      return eventMs > version;
    });
    if (acceptedScopes.length === 0) return rejectKeepingKeyHealth();

    const merged = { ...existing };
    if (credentialHealth) merged.credentialHealth = credentialHealth;
    for (const candidate of acceptedScopes) {
      merged[`${MODEL_LOCK_PREFIX}${candidate}`] = null;
      merged[`${MODEL_STATE_VERSION_PREFIX}${candidate}`] = new Date(eventMs).toISOString();
    }
    if (webSearch && scope.startsWith("websearch:") && acceptedScopes.includes(scope)) {
      merged[`modelError_${scope}`] = null;
    }
    if (!webFetch && !webSearch) {
      for (const [key, value] of Object.entries(existing)) {
        if (!key.startsWith(MODEL_LOCK_PREFIX) || key.startsWith(`${MODEL_LOCK_PREFIX}webfetch:`) || key.startsWith(`${MODEL_LOCK_PREFIX}websearch:`) || acceptedScopes.some((candidate) => key === `${MODEL_LOCK_PREFIX}${candidate}`)) continue;
        if (Date.parse(value || "") <= eventMs) merged[key] = null;
      }
    }
    const activeLocks = Object.entries(merged).some(
      ([key, value]) => key.startsWith(MODEL_LOCK_PREFIX) &&
      !key.startsWith(`${MODEL_LOCK_PREFIX}webfetch:`) &&
      !key.startsWith(`${MODEL_LOCK_PREFIX}websearch:`) &&
      activeTimestamp(value, eventMs)
    );
    // A durable reauth_required state means the OAuth refresh token is dead and
    // only a fresh OAuth reconnect can revive the account. Ordinary request
    // success must NOT silently clear it back to "active" — otherwise the row
    // looks healthy while every request 401s. Only a successful OAuth
    // replacement (updateProviderConnection with testStatus:"active") clears it.
    if (!webFetch && !webSearch && !isDurableReauthPinned(existing) && !activeLocks && (Date.parse(existing.lastErrorAt || "") || 0) <= eventMs) {
      Object.assign(merged, {
        testStatus: "active",
        lastError: null,
        lastErrorAt: null,
        errorCode: null,
        backoffLevel: 0
      });
    }
    merged.updatedAt = existing.updatedAt;
    upsert(db, merged);
    result = { applied: true, connection: merged };
  });
  return result;
}

/**
 * A scoped key with this as its last relation would become unrestricted after
 * FK cascade. Operators must clear the key restriction intentionally first.
 *
 * HAVING repeats the aggregates instead of naming SELECT aliases: SQLite allows
 * an alias there, PostgreSQL does not (`column "relationCount" does not exist`),
 * and that error aborted every provider-connection delete on the PG engine.
 */
function assertDeletionDoesNotBroadenScopedKeys(db, connectionIds) {
  if (!connectionIds.length) return;
  const placeholders = connectionIds.map(() => "?").join(", ");
  const rows = db.all(
    `SELECT apiKeyId
     FROM apiKeyProviderConnections
     GROUP BY apiKeyId
     HAVING COUNT(*) = SUM(CASE WHEN connectionId IN (${placeholders}) THEN 1 ELSE 0 END)`,
    connectionIds
  );
  if (rows.length) {
    const error = new Error("Cannot delete provider connection: it is the last scoped account for an API key. Clear that key's provider-account restriction first.");
    error.code = "API_KEY_SCOPE_WOULD_BROADEN";
    throw error;
  }
}

export async function deleteProviderConnection(id) {
  const db = await getAdapter();
  let ok = false;
  db.transaction(() => {
    assertNoActiveQuotaReservationsForTargetSync(db, { connectionIds: [id] });
    const row = db.get(`SELECT provider FROM providerConnections WHERE id = ?`, [id]);
    if (!row) return;
    assertDeletionDoesNotBroadenScopedKeys(db, [id]);
    updateAutoPingEntryInTx(db, row.provider, id, false, null);
    db.run(`DELETE FROM providerConnections WHERE id = ?`, [id]);
    deleteAntigravityRotationRows(db, [id]);
    reorderInTx(db, row.provider);
    ok = true;
  });
  return ok;
}
export async function setProviderConnectionAutoPing(id, enabled, schedule = undefined) {
  if (!isBoolean(enabled) && !(enabled === undefined && schedule !== undefined)) {
    throw new TypeError("enabled must be a boolean");
  }
  if (schedule !== undefined && schedule !== null && (!isObject(schedule) || schedule.enabled !== true)) {
    throw new TypeError("schedule must be an enabled schedule object or null");
  }
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(
      `SELECT id, provider, authType, isActive FROM providerConnections WHERE id = ?`,
      [id]
    );
    if (!row) return;
    const settingsKey = AUTO_PING_SETTINGS_KEYS[row.provider];
    const activating = enabled === true || Boolean(schedule);
    if (!settingsKey || row.authType !== "oauth" || activating && row.isActive !== 1) {
      const error = new Error("Auto-ping is available only for active Claude or Codex OAuth connections");
      error.code = "AUTO_PING_INELIGIBLE";
      throw error;
    }
    const updated = updateAutoPingEntryInTx(db, row.provider, id, enabled, schedule);
    result = {
      connectionId: id,
      provider: row.provider,
      enabled: updated.config.connections[id] === true,
      schedule: updated.config.schedules[id] || null,
      settingsKey,
      config: updated.config
    };
  });
  return result;
}

export function deleteProviderConnectionsByProviderInTx(db, providerId) {
    const rows = db.all(`SELECT id FROM providerConnections WHERE provider = ?`, [providerId]);
    for (let offset = 0; offset < rows.length; offset += 1024) {
      assertNoActiveQuotaReservationsForTargetSync(db, {
        connectionIds: rows.slice(offset, offset + 1024).map((row) => row.id)
      });
    }
    assertDeletionDoesNotBroadenScopedKeys(db, rows.map((row) => row.id));
    for (const row of rows) updateAutoPingEntryInTx(db, providerId, row.id, false, null);
    const ids = rows.map((row) => row.id);
    db.run(`DELETE FROM providerConnections WHERE provider = ?`, [providerId]);
    deleteAntigravityRotationRows(db, ids);
    return rows.length;
}

export async function deleteProviderConnectionsByProvider(providerId) {
  const db = await getAdapter();
  let count = 0;
  db.transaction(() => { count = deleteProviderConnectionsByProviderInTx(db, providerId); });
  return count;
}

export async function reorderProviderConnections(providerId) {
  const db = await getAdapter();
  db.transaction(() => reorderInTx(db, providerId));
}

/**
 * Atomically set the full priority order of a provider's connections.
 * `orderedIds` MUST be exactly the provider's connection ids (no dups, none
 * missing) — anything else throws inside the transaction and nothing persists.
 */
export async function reorderProviderConnectionsByIds(providerId, orderedIds) {
  const db = await getAdapter();
  db.transaction(() => {
    const rows = db.all(`SELECT id FROM providerConnections WHERE provider = ?`, [providerId]);
    const existing = new Set(rows.map((r) => r.id));
    const requested = new Set(orderedIds);
    if (requested.size !== orderedIds.length) throw new Error("duplicate connection ids");
    if (requested.size !== existing.size || [...requested].some((id) => !existing.has(id))) {
      throw new Error("orderedIds must match the provider's connection set exactly");
    }
    orderedIds.forEach((id, i) => {
      db.run(`UPDATE providerConnections SET priority = ? WHERE id = ?`, [i + 1, id]);
    });
  });
}

export async function cleanupProviderConnections() {
  const db = await getAdapter();
  const fieldsToCheck = [
  "displayName", "email", "globalPriority", "defaultModel",
  "accessToken", "refreshToken", "expiresAt", "tokenType",
  "scope", "projectId", "apiKey", "managementApiKey", "testStatus",
  "lastTested", "lastError", "lastErrorAt", "rateLimitedUntil", "expiresIn",
  "consecutiveUseCount"];

  let cleaned = 0;
  db.transaction(() => {
    const rows = db.all(`SELECT * FROM providerConnections`);
    for (const row of rows) {
      const conn = rowToConn(row);
      let dirty = false;
      for (const f of fieldsToCheck) {
        if (conn[f] === null || conn[f] === undefined) {
          if (f in conn) {delete conn[f];cleaned++;dirty = true;}
        }
      }
      if (conn.providerSpecificData && Object.keys(conn.providerSpecificData).length === 0) {
        delete conn.providerSpecificData;
        cleaned++;
        dirty = true;
      }
      if (dirty) upsert(db, conn);
    }
  });
  return cleaned;
}
