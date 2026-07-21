import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";
import { mergeProviderConnection } from "../helpers/mergeProviderMetadata.js";
import { hasConflictingCodexAccountIds, resolveCodexAccountId } from "open-sse/shared/codexAccountId.js";
import { providerRefreshContextMatches } from "@/shared/utils/providerCredentialContext";
import { QUOTA_WRITE_LOCK_SQL } from "./quotaSql.js";
import { assertNoActiveQuotaReservationsForTargetSync } from "./quotaReservationsRepo.js";
import { resolveFallbackModelScope } from "open-sse/services/fallbackScope.js";
import { QUOTA_MAX_CLOCK_SKEW_MS } from "@/shared/constants/quota";
import {
  encryptField,
  decryptField,
  isEncryptedBlob,
} from "@/lib/crypto/columnCrypto.js";

// SEC-B-02: credential fields that must be AES-256-GCM-encrypted at rest
// inside providerConnections.data. All other fields stay plaintext.
export const SENSITIVE_CONNECTION_FIELDS = Object.freeze([
  "accessToken",
  "refreshToken",
  "apiKey",
  "idToken",
  "firecrawlHeaders",
]);

const OPTIONAL_FIELDS = [
  "displayName", "email", "globalPriority", "defaultModel",
  "accessToken", "refreshToken", "expiresAt", "tokenType",
  "scope", "projectId", "apiKey", "testStatus", "firecrawlHeaders",
  "lastTested", "lastError", "lastErrorAt", "rateLimitedUntil", "expiresIn", "errorCode",
  "consecutiveUseCount", "idToken", "lastRefreshAt",
];

const AUTO_PING_SETTINGS_KEYS = {
  claude: "claudeAutoPing",
  codex: "codexAutoPing",
};

function updateAutoPingEntryInTx(db, provider, connectionId, enabled) {
  const settingsKey = AUTO_PING_SETTINGS_KEYS[provider];
  if (!settingsKey) return null;
  const row = db.get(`SELECT data FROM settings WHERE id = 1`);
  const current = row ? parseJson(row.data, {}) : {};
  const currentConfig = current[settingsKey] || {};
  const connections = { ...(currentConfig.connections || {}) };
  if (enabled === true) connections[connectionId] = true;
  else delete connections[connectionId];
  const config = { ...currentConfig, connections };
  db.run(
    `INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
    [stringifyJson({ ...current, [settingsKey]: config })],
  );
  return { settingsKey, config };
}

function rowToConn(row) {
  if (!row) return null;
  const extra = parseJson(row.data, {});
  // Decrypt the four sensitive fields. AAD is the row id so a ciphertext
  // cannot be replayed into a different row. Plaintext values (pre-migration
  // rows) pass through unchanged so a half-migrated DB still reads cleanly.
  for (const field of SENSITIVE_CONNECTION_FIELDS) {
    const value = extra[field];
    if (isEncryptedBlob(value)) {
      extra[field] = decryptField(value, row.id);
    }
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
    updatedAt: row.updatedAt,
  };
}

function connToRow(c) {
  const { id, provider, authType, name, email, priority, isActive, createdAt, updatedAt, ...rest } = c;
  // Encrypt the four sensitive fields if present. Already-encrypted blobs
  // pass through so re-writes from rowToConn don't double-encrypt.
  for (const field of SENSITIVE_CONNECTION_FIELDS) {
    const value = rest[field];
    if (typeof value === "string" && value.length > 0 && !isEncryptedBlob(value)) {
      rest[field] = encryptField(value, id);
    }
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
    updatedAt,
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
    return data.providerSpecificData?.githubLogin
      || data.providerSpecificData?.githubEmail
      || data.email
      || data.providerSpecificData?.githubName
      || fallbackName;
  }
  return fallbackName;
}

export async function getProviderConnections(filter = {}) {
  const db = await getAdapter();
  const where = [];
  const params = [];
  if (filter.provider) { where.push("provider = ?"); params.push(filter.provider); }
  if (filter.isActive !== undefined) { where.push("isActive = ?"); params.push(filter.isActive ? 1 : 0); }
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

export async function createProviderConnection(data, { shouldCommit, requireNewName, createOnly = false } = {}) {
  const db = await getAdapter();
  // OAuth flows can be cancelled while an upstream exchange is in flight.
  // Check after the async adapter lookup and immediately before the synchronous
  // transaction so a superseded flow cannot persist a late credential.
  if (typeof shouldCommit === "function" && !shouldCommit()) {
    throw new Error("OAuth flow was cancelled or superseded before commit");
  }
  const now = new Date().toISOString();
  let result;

  db.transaction(() => {
    const all = db.all(`SELECT * FROM providerConnections WHERE provider = ?`, [data.provider]).map(rowToConn);

    let existing = null;
    if (data.authType === "oauth" && data.email) {
      const incomingUsername = data.providerSpecificData?.username;
      const incomingWs = data.providerSpecificData?.chatgptAccountId;
      existing = all.find(c => {
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
    if (!existing && data.provider === "cursor" && data.providerSpecificData?.userId) {
      existing = all.find(
        (c) => c.providerSpecificData?.userId === data.providerSpecificData.userId,
      );
    } else if (data.authType === "apikey" && data.name) {
      existing = all.find(c => c.authType === "apikey" && c.name === data.name);
    }
    // access_token: never dedup — user manages duplicates manually

    // Bulk add must never overwrite an existing key. When the caller flags a
    // create-only insert (requireNewName), a name collision is a hard error
    // instead of the default upsert — the UI planner assigns collision-free
    // names, and this guard catches any stale/concurrent state that slips past
    // it. Thrown inside the transaction so nothing is persisted.
    if (existing && requireNewName && data.authType === "apikey") {
      const err = new Error(`An API key named "${data.name}" already exists for this provider`);
      err.code = "PROVIDER_CONNECTION_NAME_CONFLICT";
      throw err;
    }

    if (existing) {
      // #6499 — create-only (dashboard "add API key"): a duplicate (provider,
      // apikey, name) must error, never silently upsert/overwrite. The explicit
      // update path is updateProviderConnection (PUT /api/providers/[id]).
      if (createOnly && data.authType === "apikey") {
        const error = new Error(`A connection named "${data.name}" already exists for this provider`);
        error.code = "PROVIDER_CONNECTION_ALREADY_EXISTS";
        throw error;
      }
      const merged = { ...mergeProviderConnection(existing, data), updatedAt: now };
      upsert(db, merged);
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
      updatedAt: now,
    };
    for (const f of OPTIONAL_FIELDS) {
      if (data[f] !== undefined && data[f] !== null) conn[f] = data[f];
    }
    if (data.providerSpecificData && Object.keys(data.providerSpecificData).length > 0) {
      conn.providerSpecificData = data.providerSpecificData;
    }
    if (data.email !== undefined) conn.email = data.email;

    upsert(db, conn);
    reorderInTx(db, data.provider);
    result = conn;
  });

  return result;
}

// Critical: OAuth refresh token race — atomic merge inside transaction
export async function updateProviderConnection(id, data, {
  expectedUpdatedAt = null,
  expectedRefreshContext = null,
  returnCommitResult = false,
  signal = null,
  shouldCommit = null,
} = {}) {
  const db = await getAdapter();
  let result;
  db.transaction(() => {
    if (signal?.aborted) throw new DOMException("Provider connection update aborted", "AbortError");
    if (typeof shouldCommit === "function" && !shouldCommit()) {
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
    if (!row) { result = null; return; }
    const existing = rowToConn(row);
    if (expectedUpdatedAt && existing.updatedAt !== expectedUpdatedAt) {
      const error = new Error("Provider connection changed during credential refresh");
      error.code = "PROVIDER_CONNECTION_REVISION_CONFLICT";
      throw error;
    }
    if (!providerRefreshContextMatches(existing, expectedRefreshContext)) {
      result = returnCommitResult ? { applied: false, connection: existing } : existing;
      return;
    }
    if (Object.hasOwn(data, "provider") && data.provider !== existing.provider) {
      const error = new Error("A provider connection cannot change provider identity in place");
      error.code = "PROVIDER_IDENTITY_IMMUTABLE";
      throw error;
    }
    const merged = { ...mergeProviderConnection(existing, data), updatedAt: new Date().toISOString() };
    upsert(db, merged);
    if (data.isActive === false) updateAutoPingEntryInTx(db, existing.provider, id, false);
    if (data.priority !== undefined) reorderInTx(db, existing.provider);
    result = returnCommitResult ? { applied: true, connection: merged } : merged;
  });
  return result;
}

const MODEL_LOCK_PREFIX = "modelLock_";
const MODEL_STATE_VERSION_PREFIX = "modelStateObserved_";

function boundedModelScope(provider, model) {
  return resolveFallbackModelScope(provider, model) || "__all";
}

function eventTimestamp(value, now = Date.now()) {
  const parsed = typeof value === "number" ? value : Date.parse(value || "");
  const clock = Number(now);
  if (
    !Number.isSafeInteger(parsed)
    || parsed <= 0
    || !Number.isFinite(clock)
    || parsed > clock + QUOTA_MAX_CLOCK_SKEW_MS
  ) throw new TypeError("Provider fallback event timestamp is invalid");
  return parsed;
}

function activeTimestamp(value, now) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) && parsed > now ? parsed : null;
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
  cooldownMs,
  backoffLevel = 0,
  observedAt,
} = {}, { signal = null, now = Date.now() } = {}) {
  const eventMs = eventTimestamp(observedAt, now);
  if (!Number.isSafeInteger(cooldownMs) || cooldownMs < 0 || cooldownMs > 7 * 24 * 60 * 60 * 1000) {
    throw new TypeError("Provider fallback cooldown is invalid");
  }
  const safeReasons = {
    rate_limited: "Rate limited",
    authentication_error: "Authentication failed",
    provider_error: "Provider unavailable",
    network_error: "Provider network error",
  };
  const reason = safeReasons[reasonCode] || safeReasons.provider_error;
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    if (signal?.aborted) throw new DOMException("Provider fallback update aborted", "AbortError");
    const lock = db.run(QUOTA_WRITE_LOCK_SQL);
    if ((lock.changes || 0) !== 1) throw new Error("Provider fallback update requires an initialized schema");
    const row = db.get(`SELECT * FROM providerConnections WHERE id = ?`, [id]);
    if (!row) return;
    const existing = rowToConn(row);
    const scope = boundedModelScope(existing.provider, model);
    const lockKey = `${MODEL_LOCK_PREFIX}${scope}`;
    const versionKey = `${MODEL_STATE_VERSION_PREFIX}${scope}`;
    const storedVersion = Date.parse(existing[versionKey] || "") || 0;
    if (eventMs <= storedVersion) {
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
      testStatus: "unavailable",
      lastError: reason,
      errorCode: Number(status) || null,
      lastErrorAt: new Date(eventMs).toISOString(),
      backoffLevel: Math.max(Number(existing.backoffLevel) || 0, Number(backoffLevel) || 0),
      // Runtime health is not a credential revision. Keeping updatedAt stable
      // prevents successful/failing traffic from invalidating quota fetch
      // dedupe and OAuth compare-and-swap keys.
      updatedAt: existing.updatedAt,
    };
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
    const scope = boundedModelScope(existing.provider, model);
    const relevantScopes = scope === "__all" ? [scope] : [scope, "__all"];
    const primaryVersion = Date.parse(existing[`${MODEL_STATE_VERSION_PREFIX}${scope}`] || "") || 0;
    if (eventMs <= primaryVersion) {
      result = { applied: false, connection: existing };
      return;
    }
    const scopes = relevantScopes;
    const acceptedScopes = scopes.filter((candidate) => {
      const version = Date.parse(existing[`${MODEL_STATE_VERSION_PREFIX}${candidate}`] || "") || 0;
      return eventMs > version;
    });
    if (acceptedScopes.length === 0) {
      result = { applied: false, connection: existing };
      return;
    }

    const merged = { ...existing };
    for (const candidate of acceptedScopes) {
      merged[`${MODEL_LOCK_PREFIX}${candidate}`] = null;
      merged[`${MODEL_STATE_VERSION_PREFIX}${candidate}`] = new Date(eventMs).toISOString();
    }
    for (const [key, value] of Object.entries(existing)) {
      if (!key.startsWith(MODEL_LOCK_PREFIX) || acceptedScopes.some((candidate) => key === `${MODEL_LOCK_PREFIX}${candidate}`)) continue;
      if (Date.parse(value || "") <= eventMs) merged[key] = null;
    }
    const activeLocks = Object.entries(merged).some(
      ([key, value]) => key.startsWith(MODEL_LOCK_PREFIX) && activeTimestamp(value, eventMs),
    );
    // A durable reauth_required state means the OAuth refresh token is dead and
    // only a fresh OAuth reconnect can revive the account. Ordinary request
    // success must NOT silently clear it back to "active" — otherwise the row
    // looks healthy while every request 401s. Only a successful OAuth
    // replacement (updateProviderConnection with testStatus:"active") clears it.
    const reauthPinned = existing.testStatus === "reauth_required" || existing.errorCode === "REAUTH";
    if (!reauthPinned && !activeLocks && (Date.parse(existing.lastErrorAt || "") || 0) <= eventMs) {
      Object.assign(merged, {
        testStatus: "active",
        lastError: null,
        lastErrorAt: null,
        errorCode: null,
        backoffLevel: 0,
      });
    }
    merged.updatedAt = existing.updatedAt;
    upsert(db, merged);
    result = { applied: true, connection: merged };
  });
  return result;
}

export async function deleteProviderConnection(id) {
  const db = await getAdapter();
  let ok = false;
  db.transaction(() => {
    assertNoActiveQuotaReservationsForTargetSync(db, { connectionIds: [id] });
    const row = db.get(`SELECT provider FROM providerConnections WHERE id = ?`, [id]);
    if (!row) return;
    updateAutoPingEntryInTx(db, row.provider, id, false);
    db.run(`DELETE FROM providerConnections WHERE id = ?`, [id]);
    reorderInTx(db, row.provider);
    ok = true;
  });
  return ok;
}

export async function setProviderConnectionAutoPing(id, enabled) {
  if (typeof enabled !== "boolean") throw new TypeError("enabled must be a boolean");
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(
      `SELECT id, provider, authType, isActive FROM providerConnections WHERE id = ?`,
      [id],
    );
    if (!row) return;
    const settingsKey = AUTO_PING_SETTINGS_KEYS[row.provider];
    if (!settingsKey || row.authType !== "oauth" || (enabled === true && row.isActive !== 1)) {
      const error = new Error("Auto-ping is available only for active Claude or Codex OAuth connections");
      error.code = "AUTO_PING_INELIGIBLE";
      throw error;
    }
    const updated = updateAutoPingEntryInTx(db, row.provider, id, enabled);
    result = {
      connectionId: id,
      provider: row.provider,
      enabled,
      settingsKey,
      config: updated.config,
    };
  });
  return result;
}

export async function deleteProviderConnectionsByProvider(providerId) {
  const db = await getAdapter();
  let count = 0;
  db.transaction(() => {
    assertNoActiveQuotaReservationsForTargetSync(db, { provider: providerId });
    const rows = db.all(`SELECT id FROM providerConnections WHERE provider = ?`, [providerId]);
    for (const row of rows) updateAutoPingEntryInTx(db, providerId, row.id, false);
    db.run(`DELETE FROM providerConnections WHERE provider = ?`, [providerId]);
    count = rows.length;
  });
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
    "scope", "projectId", "apiKey", "testStatus",
    "lastTested", "lastError", "lastErrorAt", "rateLimitedUntil", "expiresIn",
    "consecutiveUseCount",
  ];
  let cleaned = 0;
  db.transaction(() => {
    const rows = db.all(`SELECT * FROM providerConnections`);
    for (const row of rows) {
      const conn = rowToConn(row);
      let dirty = false;
      for (const f of fieldsToCheck) {
        if (conn[f] === null || conn[f] === undefined) {
          if (f in conn) { delete conn[f]; cleaned++; dirty = true; }
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
